import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailService } from './email.service';

@Injectable()
export class InvoiceEmailListener {
  private readonly logger = new Logger(InvoiceEmailListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @OnEvent('invoice.accepted')
  async handleInvoiceAccepted(event: {
    tenantId: string;
    invoiceId: string;
    platformIrn: string;
    data: { firsConfirmedIrn?: string; [key: string]: any };
  }): Promise<void> {
    try {
      const { ownerEmail, tenantName, invoice } = await this.loadContext(
        event.tenantId,
        event.invoiceId,
      );
      if (!ownerEmail) return;

      this.emailService.sendInvoiceAccepted({
        to: ownerEmail,
        tenantName,
        invoiceId: event.invoiceId,
        platformIrn: event.platformIrn,
        firsConfirmedIrn: event.data?.firsConfirmedIrn,
        buyerName: invoice?.buyerName ?? undefined,
        totalAmount: invoice?.totalAmount
          ? `NGN ${Number(invoice.totalAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
          : undefined,
      });
    } catch (err: any) {
      this.logger.error(`invoice.accepted email failed: ${err.message}`);
    }
  }

  @OnEvent('invoice.rejected')
  async handleInvoiceRejected(event: {
    tenantId: string;
    invoiceId: string;
    platformIrn: string;
    data: { errorCode?: string; errorMessage?: string; [key: string]: any };
  }): Promise<void> {
    try {
      const { ownerEmail, tenantName, invoice } = await this.loadContext(
        event.tenantId,
        event.invoiceId,
      );
      if (!ownerEmail) return;

      this.emailService.sendInvoiceRejected({
        to: ownerEmail,
        tenantName,
        invoiceId: event.invoiceId,
        platformIrn: event.platformIrn,
        errorCode: event.data?.errorCode,
        errorMessage: event.data?.errorMessage,
        buyerName: invoice?.buyerName ?? undefined,
      });
    } catch (err: any) {
      this.logger.error(`invoice.rejected email failed: ${err.message}`);
    }
  }

  private async loadContext(tenantId: string, invoiceId: string) {
    const [tenant, invoice] = await this.prisma.asAdmin(async (tx) => {
      return Promise.all([
        tx.tenant.findUnique({
          where: { id: tenantId },
          select: {
            name: true,
            users: {
              where: { isActive: true, roles: { some: { role: 'OWNER' } } },
              select: { email: true },
              take: 1,
            },
          },
        }),
        tx.invoice.findUnique({
          where: { id: invoiceId },
          select: { buyerName: true, totalAmount: true },
        }),
      ]);
    });

    const ownerEmail = (tenant as any)?.users?.[0]?.email ?? null;
    const tenantName = (tenant as any)?.name ?? 'your organisation';

    return { ownerEmail, tenantName, invoice };
  }
}
