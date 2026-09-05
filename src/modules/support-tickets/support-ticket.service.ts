import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { S3Service } from '../../infrastructure/storage/s3.service';
import { EmailService } from '../../shared/email/email.service';
import { getOptionalRequestContext } from '../../shared/context/request-context';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import {
  SupportTicketDetail,
  SupportTicketListItem,
  SupportTicketStatus,
} from '../../../packages/types/support-tickets';

const ALLOWED_SCREENSHOT_MIMES = new Set(['image/png', 'image/jpeg']);

@Injectable()
export class SupportTicketService {
  private readonly logger = new Logger(SupportTicketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    private readonly emailService: EmailService,
  ) {}

  async createTicket(
    dto: CreateSupportTicketDto,
    screenshot: Express.Multer.File,
  ): Promise<{ id: string }> {
    const detected = await fileTypeFromBuffer(screenshot.buffer);
    if (!detected || !ALLOWED_SCREENSHOT_MIMES.has(detected.mime)) {
      throw new BadRequestException(
        'Unsupported screenshot type. Only PNG and JPEG are accepted.',
      );
    }

    const ctx = getOptionalRequestContext();
    // Never trust a client-supplied tenant/user id — derive both from the
    // verified JWT context (OptionalJwtGuard) when one exists, and leave
    // both null for a genuinely unauthenticated (pre-auth crash) submission.
    const tenantId = ctx?.tenantId ?? null;
    const userId =
      ctx?.actorType === 'user' ? ctx.actor.replace('user:', '') : null;

    const id = crypto.randomUUID();
    const screenshotKey = `support-tickets/${tenantId ?? 'anonymous'}/${id}.${detected.ext}`;

    await this.s3Service.uploadPrivateObject(
      screenshotKey,
      screenshot.buffer,
      detected.mime,
    );

    const data = {
      id,
      tenantId,
      userId,
      screenshotKey,
      errorMessage: dto.errorMessage,
      stackTrace: dto.stackTrace ?? null,
      pageUrl: dto.pageUrl,
      browserInfo: dto.browserInfo,
      userDescription: dto.userDescription ?? null,
    };

    // No tenant context (pre-auth crash) means RLS has nothing to scope the
    // write to — go through the admin connection, same as every other
    // pre-tenant-context write in this codebase (e.g. UserService creating
    // the first Tenant row during registration).
    const ticket = tenantId
      ? await this.prisma.supportTicket.create({ data })
      : await this.prisma.asAdmin((tx) => tx.supportTicket.create({ data }));

    this.notifyInternalTeam(ticket).catch((err) =>
      this.logger.error(
        `Failed to send support ticket notification email: ${err.message}`,
      ),
    );

    return { id: ticket.id };
  }

  async listTickets(filters: {
    status?: SupportTicketStatus;
    tenantId?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: SupportTicketListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 100);
    const skip = (page - 1) * limit;
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.tenantId) where.tenantId = filters.tenantId;

    const [tickets, total] = await this.prisma.asAdmin(async (tx) => {
      return Promise.all([
        tx.supportTicket.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        tx.supportTicket.count({ where }),
      ]);
    });

    const tenantIds = [
      ...new Set(
        tickets.map((t) => t.tenantId).filter((v): v is string => !!v),
      ),
    ];
    const tenantNames = tenantIds.length
      ? await this.prisma.asAdmin(async (tx) =>
          tx.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
          }),
        )
      : [];
    const nameById = new Map(tenantNames.map((t) => [t.id, t.name]));

    return {
      data: tickets.map((t) => ({
        id: t.id,
        tenantId: t.tenantId,
        tenantName: t.tenantId ? (nameById.get(t.tenantId) ?? null) : null,
        userId: t.userId,
        errorMessage: t.errorMessage,
        pageUrl: t.pageUrl,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async getTicket(id: string): Promise<SupportTicketDetail> {
    const ticket = await this.prisma.asAdmin((tx) =>
      tx.supportTicket.findUnique({ where: { id } }),
    );
    if (!ticket) throw new NotFoundException(`Support ticket ${id} not found`);
    const tenantName = ticket.tenantId
      ? await this.prisma
          .asAdmin((tx) =>
            tx.tenant.findUnique({
              where: { id: ticket.tenantId! },
              select: { name: true },
            }),
          )
          .then((t) => t?.name ?? null)
      : null;
    const screenshotUrl = await this.s3Service.getSignedViewUrl(
      ticket.screenshotKey,
    );

    return {
      id: ticket.id,
      tenantId: ticket.tenantId,
      tenantName,
      userId: ticket.userId,
      errorMessage: ticket.errorMessage,
      stackTrace: ticket.stackTrace,
      pageUrl: ticket.pageUrl,
      browserInfo: ticket.browserInfo,
      userDescription: ticket.userDescription,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      screenshotUrl,
    };
  }

  async updateStatus(
    id: string,
    status: SupportTicketStatus,
  ): Promise<{ id: string; status: SupportTicketStatus }> {
    const existing = await this.prisma.asAdmin((tx) =>
      tx.supportTicket.findUnique({ where: { id } }),
    );
    if (!existing)
      throw new NotFoundException(`Support ticket ${id} not found`);

    const ticket = await this.prisma.asAdmin((tx) =>
      tx.supportTicket.update({ where: { id }, data: { status } }),
    );
    return { id: ticket.id, status: ticket.status };
  }

  private async notifyInternalTeam(ticket: {
    id: string;
    tenantId: string | null;
    errorMessage: string;
    pageUrl: string;
    screenshotKey: string;
  }): Promise<void> {
    const signedUrl = await this.s3Service.getSignedViewUrl(
      ticket.screenshotKey,
    );
    this.emailService.sendSupportTicketNotification({
      ticketId: ticket.id,
      tenantId: ticket.tenantId,
      errorMessage: ticket.errorMessage,
      pageUrl: ticket.pageUrl,
      screenshotUrl: signedUrl,
    });
  }
}
