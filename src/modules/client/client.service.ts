import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ActivityService } from '../activity/services/activity.service';
import { getRequestContext } from '../../shared/context/request-context';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class ClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
  ) {}

  async create(tenantId: string, data: Record<string, any>) {
    if (data.tin) {
      const existing = await (this.prisma as any).client.findUnique({
        where: { tenantId_tin: { tenantId, tin: data.tin } },
      });
      if (existing) {
        if (!existing.isActive) {
          // Reactivate the soft-deleted record
          const reactivated = await (this.prisma as any).client.update({
            where: { id: existing.id },
            data: {
              isActive: true,
              companyName: data.companyName ?? existing.companyName,
              email: data.email !== undefined ? data.email : existing.email,
              telephone:
                data.telephone !== undefined
                  ? data.telephone
                  : existing.telephone,
              businessDescription:
                data.businessDescription !== undefined
                  ? data.businessDescription
                  : existing.businessDescription,
              contactPerson:
                data.contactPerson !== undefined
                  ? data.contactPerson
                  : existing.contactPerson,
              notes: data.notes !== undefined ? data.notes : existing.notes,
              postalAddress:
                data.postalAddress !== undefined
                  ? data.postalAddress
                  : existing.postalAddress,
            },
          });
          return this.mapClient(reactivated);
        }
        throw new ConflictException(
          `A client with TIN ${data.tin} already exists`,
        );
      }
    }

    const client = await (this.prisma as any).client.create({
      data: {
        tenantId,
        companyName: data.companyName,
        tin: data.tin ?? null,
        email: data.email ?? null,
        telephone: data.telephone ?? null,
        businessDescription: data.businessDescription ?? null,
        contactPerson: data.contactPerson ?? null,
        notes: data.notes ?? null,
        postalAddress: data.postalAddress ?? null,
      },
    });

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'CLIENT_CREATED',
      actor: ctx.actor,
      entityType: 'Client',
      entityId: client.id,
      payload: { companyName: data.companyName, tin: data.tin },
    });

    return this.mapClient(client);
  }

  async findAll(tenantId: string, search?: string, page = 1, limit = 20) {
    const where: any = { tenantId, isActive: true };
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { tin: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, clients] = await Promise.all([
      (this.prisma as any).client.count({ where }),
      (this.prisma as any).client.findMany({
        where,
        orderBy: { totalInvoices: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: clients.map((c: any) => this.mapClient(c)),
      total,
      page,
      limit,
    };
  }

  async findOne(tenantId: string, id: string) {
    const client = await (this.prisma as any).client.findFirst({
      where: { id, tenantId },
    });
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return this.mapClient(client);
  }

  async update(tenantId: string, id: string, data: Record<string, any>) {
    const existing = await (this.prisma as any).client.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Client ${id} not found`);

    if (data.tin && data.tin !== existing.tin) {
      const conflict = await (this.prisma as any).client.findUnique({
        where: { tenantId_tin: { tenantId, tin: data.tin } },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException(
          `A client with TIN ${data.tin} already exists`,
        );
      }
    }

    const updated = await (this.prisma as any).client.update({
      where: { id },
      data: {
        companyName: data.companyName ?? existing.companyName,
        tin: data.tin !== undefined ? data.tin : existing.tin,
        email: data.email !== undefined ? data.email : existing.email,
        telephone:
          data.telephone !== undefined ? data.telephone : existing.telephone,
        businessDescription:
          data.businessDescription !== undefined
            ? data.businessDescription
            : existing.businessDescription,
        contactPerson:
          data.contactPerson !== undefined
            ? data.contactPerson
            : existing.contactPerson,
        notes: data.notes !== undefined ? data.notes : existing.notes,
        postalAddress:
          data.postalAddress !== undefined
            ? data.postalAddress
            : existing.postalAddress,
        isActive:
          data.isActive !== undefined ? data.isActive : existing.isActive,
      },
    });

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'CLIENT_UPDATED',
      actor: ctx.actor,
      entityType: 'Client',
      entityId: id,
      payload: { companyName: updated.companyName },
    });

    return this.mapClient(updated);
  }

  async delete(tenantId: string, id: string) {
    const existing = await (this.prisma as any).client.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Client ${id} not found`);

    await (this.prisma as any).client.update({
      where: { id },
      data: { isActive: false },
    });

    return { deleted: true, id };
  }

  async getFrequent(tenantId: string, limit = 5) {
    const clients = await (this.prisma as any).client.findMany({
      where: { tenantId, isActive: true },
      orderBy: { totalInvoices: 'desc' },
      take: limit,
    });
    return clients.map((c: any) => this.mapClient(c));
  }

  async syncFromInvoice(tenantId: string, invoice: any) {
    const buyerTin = invoice.buyerTin ?? invoice.buyerParty?.tin;
    const buyerName = invoice.buyerName ?? invoice.buyerParty?.partyName;

    if (!buyerName) return;

    const amount = Number(invoice.totalAmount ?? 0);
    const now = new Date();

    if (buyerTin) {
      const existing = await (this.prisma as any).client.findUnique({
        where: { tenantId_tin: { tenantId, tin: buyerTin } },
      });

      if (existing) {
        await (this.prisma as any).client.update({
          where: { id: existing.id },
          data: {
            totalInvoices: { increment: 1 },
            totalBilled: { increment: new Decimal(amount) },
            lastInvoiceAt: now,
          },
        });
        return;
      }
    }

    // Auto-create from invoice buyer details
    const postalAddress = invoice.buyerParty?.postalAddress ?? null;

    try {
      await (this.prisma as any).client.create({
        data: {
          tenantId,
          companyName: buyerName,
          tin: buyerTin ?? null,
          email: invoice.buyerParty?.email ?? null,
          telephone: invoice.buyerParty?.telephone ?? null,
          businessDescription: invoice.buyerParty?.businessDescription ?? null,
          postalAddress,
          totalInvoices: 1,
          totalBilled: new Decimal(amount),
          lastInvoiceAt: now,
        },
      });
    } catch {
      // Ignore unique constraint violations from concurrent requests
    }
  }

  private mapClient(c: any) {
    return {
      id: c.id,
      tenantId: c.tenantId,
      companyName: c.companyName,
      tin: c.tin ?? undefined,
      email: c.email ?? undefined,
      telephone: c.telephone ?? undefined,
      businessDescription: c.businessDescription ?? undefined,
      contactPerson: c.contactPerson ?? undefined,
      notes: c.notes ?? undefined,
      postalAddress: c.postalAddress ?? undefined,
      totalInvoices: c.totalInvoices,
      totalBilled: Number(c.totalBilled),
      lastInvoiceAt: c.lastInvoiceAt?.toISOString() ?? undefined,
      isActive: c.isActive,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
