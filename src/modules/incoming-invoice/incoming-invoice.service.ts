import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ActivityService } from '../activity/services/activity.service';
import { getRequestContext } from '../../shared/context/request-context';
import {
  CreateIncomingInvoiceDto,
  RejectIncomingInvoiceDto,
  MarkPaidIncomingInvoiceDto,
} from './dto/create-incoming-invoice.dto';
import type {
  IncomingInvoiceResponse,
  IncomingInvoiceListResponse,
  IncomingInvoiceItemResponse,
} from './dto/incoming-invoice-response.dto';

@Injectable()
export class IncomingInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    tenantId: string,
    dto: CreateIncomingInvoiceDto,
  ): Promise<IncomingInvoiceResponse> {
    const existing = await (this.prisma as any).incomingInvoice.findUnique({
      where: {
        tenantId_invoiceNumber_supplierTin: {
          tenantId,
          invoiceNumber: dto.invoiceNumber,
          supplierTin: dto.supplierTin,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Invoice ${dto.invoiceNumber} from supplier TIN ${dto.supplierTin} already exists`,
      );
    }

    const invoice = await (this.prisma as any).incomingInvoice.create({
      data: {
        tenantId,
        supplierName: dto.supplierName,
        supplierTin: dto.supplierTin,
        invoiceNumber: dto.invoiceNumber,
        invoiceAmount: dto.invoiceAmount,
        vatAmount: dto.vatAmount,
        currency: dto.currency ?? 'NGN',
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        description: dto.description ?? null,
        sourceReference: dto.sourceReference ?? null,
        status: 'RECEIVED',
        items: dto.items?.length
          ? {
              create: dto.items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineAmount: item.lineAmount,
                vatAmount: item.vatAmount ?? 0,
                hsnCode: item.hsnCode ?? null,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'INCOMING_INVOICE_RECEIVED',
      actor: ctx.actor,
      entityType: 'IncomingInvoice',
      entityId: invoice.id,
      payload: {
        invoiceNumber: dto.invoiceNumber,
        supplierName: dto.supplierName,
        supplierTin: dto.supplierTin,
        invoiceAmount: dto.invoiceAmount,
        currency: dto.currency ?? 'NGN',
      },
    });

    return this.map(invoice);
  }

  async list(
    tenantId: string,
    filters: {
      status?: string;
      supplierTin?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<IncomingInvoiceListResponse> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.supplierTin) where.supplierTin = filters.supplierTin;

    const [data, total] = await Promise.all([
      (this.prisma as any).incomingInvoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { items: true },
      }),
      (this.prisma as any).incomingInvoice.count({ where }),
    ]);

    return { data: data.map((i: any) => this.map(i)), total, page, limit };
  }

  async findById(
    id: string,
    tenantId: string,
  ): Promise<IncomingInvoiceResponse> {
    const invoice = await (this.prisma as any).incomingInvoice.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!invoice) throw new NotFoundException(`Incoming invoice ${id} not found`);
    return this.map(invoice);
  }

  async validate(id: string, tenantId: string): Promise<IncomingInvoiceResponse> {
    const invoice = await this.requireInvoice(id, tenantId);

    if (!['RECEIVED'].includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot validate invoice with status ${invoice.status}`,
      );
    }

    if (!invoice.supplierTin) {
      throw new BadRequestException('Supplier TIN is required');
    }
    if (Number(invoice.invoiceAmount) <= 0) {
      throw new BadRequestException('Invoice amount must be greater than 0');
    }
    if (Number(invoice.vatAmount) < 0) {
      throw new BadRequestException('VAT amount must be 0 or greater');
    }
    if (!invoice.invoiceDate || isNaN(new Date(invoice.invoiceDate).getTime())) {
      throw new BadRequestException('Invoice date is invalid');
    }

    const updated = await (this.prisma as any).incomingInvoice.update({
      where: { id },
      data: { status: 'VALIDATED' },
      include: { items: true },
    });

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'INCOMING_INVOICE_VALIDATED',
      actor: ctx.actor,
      entityType: 'IncomingInvoice',
      entityId: id,
      payload: { invoiceNumber: invoice.invoiceNumber, supplierTin: invoice.supplierTin },
    });

    this.eventEmitter.emit('incoming-invoice.validated', { incomingInvoiceId: id, tenantId });

    return this.map(updated);
  }

  async approve(id: string, tenantId: string): Promise<IncomingInvoiceResponse> {
    const invoice = await this.requireInvoice(id, tenantId);

    if (!['VALIDATED'].includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot approve invoice with status ${invoice.status}. Invoice must be VALIDATED first.`,
      );
    }

    const ctx = getRequestContext();
    await this.assertAdminOrOwner(ctx.actor, tenantId);

    const updated = await (this.prisma as any).incomingInvoice.update({
      where: { id },
      data: { status: 'APPROVED' },
      include: { items: true },
    });

    this.activityService.track({
      tenantId,
      eventType: 'INCOMING_INVOICE_APPROVED',
      actor: ctx.actor,
      entityType: 'IncomingInvoice',
      entityId: id,
      payload: { invoiceNumber: invoice.invoiceNumber, supplierTin: invoice.supplierTin },
    });

    return this.map(updated);
  }

  async reject(
    id: string,
    tenantId: string,
    dto: RejectIncomingInvoiceDto,
  ): Promise<IncomingInvoiceResponse> {
    const invoice = await this.requireInvoice(id, tenantId);

    if (['PAID', 'REJECTED'].includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot reject invoice with status ${invoice.status}`,
      );
    }

    const updated = await (this.prisma as any).incomingInvoice.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: dto.reason },
      include: { items: true },
    });

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'INCOMING_INVOICE_REJECTED',
      actor: ctx.actor,
      entityType: 'IncomingInvoice',
      entityId: id,
      payload: {
        invoiceNumber: invoice.invoiceNumber,
        reason: dto.reason,
      },
    });

    return this.map(updated);
  }

  async markPaid(
    id: string,
    tenantId: string,
    dto: MarkPaidIncomingInvoiceDto,
  ): Promise<IncomingInvoiceResponse> {
    const invoice = await this.requireInvoice(id, tenantId);

    if (invoice.status !== 'APPROVED') {
      throw new BadRequestException(
        `Only APPROVED invoices can be marked as paid. Current status: ${invoice.status}`,
      );
    }

    const updated = await (this.prisma as any).incomingInvoice.update({
      where: { id },
      data: { status: 'PAID' },
      include: { items: true },
    });

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'INCOMING_INVOICE_PAID',
      actor: ctx.actor,
      entityType: 'IncomingInvoice',
      entityId: id,
      payload: {
        invoiceNumber: invoice.invoiceNumber,
        amount: dto.amount,
        reference: dto.reference,
        provider: dto.provider,
        paidAt: dto.paidAt,
      },
    });

    return this.map(updated);
  }

  private async requireInvoice(id: string, tenantId: string): Promise<any> {
    const invoice = await (this.prisma as any).incomingInvoice.findFirst({
      where: { id, tenantId },
    });
    if (!invoice) throw new NotFoundException(`Incoming invoice ${id} not found`);
    return invoice;
  }

  private async assertAdminOrOwner(actor: string, tenantId: string): Promise<void> {
    if (!actor.startsWith('user:')) {
      throw new ForbiddenException('This action requires OWNER or ADMIN role');
    }
    const userId = actor.replace('user:', '');
    const roles = await this.prisma.asAdmin((tx) =>
      tx.userRole.findMany({
        where: { userId, tenantId },
        select: { role: true },
      }),
    );
    const roleNames = roles.map((r: any) => r.role as string);
    if (!roleNames.includes('OWNER') && !roleNames.includes('ADMIN')) {
      throw new ForbiddenException('This action requires OWNER or ADMIN role');
    }
  }

  private map(invoice: any): IncomingInvoiceResponse {
    return {
      id: invoice.id,
      tenantId: invoice.tenantId,
      supplierName: invoice.supplierName,
      supplierTin: invoice.supplierTin,
      invoiceNumber: invoice.invoiceNumber,
      invoiceAmount: Number(invoice.invoiceAmount),
      vatAmount: Number(invoice.vatAmount),
      currency: invoice.currency,
      invoiceDate: invoice.invoiceDate.toISOString(),
      dueDate: invoice.dueDate?.toISOString() ?? undefined,
      status: invoice.status,
      description: invoice.description ?? undefined,
      sourceReference: invoice.sourceReference ?? undefined,
      rejectionReason: invoice.rejectionReason ?? undefined,
      items: (invoice.items ?? []).map(
        (item: any): IncomingInvoiceItemResponse => ({
          id: item.id,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          lineAmount: Number(item.lineAmount),
          vatAmount: Number(item.vatAmount),
          hsnCode: item.hsnCode ?? undefined,
        }),
      ),
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    };
  }

  async getStats(tenantId: string) {
    return this.prisma.asAdmin(async (tx) => {
      const total = await (tx as any).incomingInvoice.count({ where: { tenantId } });
      const received = await (tx as any).incomingInvoice.count({ where: { tenantId, status: 'RECEIVED' } });
      const validated = await (tx as any).incomingInvoice.count({ where: { tenantId, status: 'VALIDATED' } });
      const approved = await (tx as any).incomingInvoice.count({ where: { tenantId, status: 'APPROVED' } });
      const paid = await (tx as any).incomingInvoice.count({ where: { tenantId, status: 'PAID' } });

      const outstandingAgg = await (tx as any).incomingInvoice.aggregate({
        where: { tenantId, status: { in: ['VALIDATED', 'APPROVED'] } },
        _sum: { invoiceAmount: true },
        _count: { id: true },
      });

      const vatAgg = await (tx as any).incomingInvoice.aggregate({
        where: { tenantId, status: { in: ['VALIDATED', 'APPROVED'] } },
        _sum: { vatAmount: true },
      });

      return {
        total,
        received,
        validated,
        approved,
        paid,
        totalOutstanding: Number(outstandingAgg._sum.invoiceAmount ?? 0),
        outstandingCount: outstandingAgg._count.id,
        totalVatOutstanding: Number(vatAgg._sum.vatAmount ?? 0),
      };
    });
  }
}
