import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class IrnService {
  private readonly logger = new Logger(IrnService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateIrn(
    tenantId: string,
    issueDate: string,
    serviceId: string,
  ): Promise<string> {
    const datePart = issueDate.replace(/-/g, '').substring(0, 8);
    const year = datePart.substring(0, 4);
    const svcId = (serviceId || 'SVC00001').substring(0, 8).padEnd(8, '0');
    const seq = await this.getNextInvoiceSequence(tenantId, year);
    const invoiceNumber = `INV${year}${String(seq).padStart(4, '0')}`;
    const irn = `${invoiceNumber}-${svcId}-${datePart}`;
    this.logger.log(`Generated IRN: ${irn}`);
    return irn;
  }

  async isIrnUnique(irn: string): Promise<boolean> {
    const existing = await this.prisma.asAdmin(async (tx) => {
      return tx.invoice.findUnique({
        where: { platformIrn: irn },
        select: { id: true },
      });
    });
    return !existing;
  }

  async generateUniqueIrn(
    tenantId: string,
    issueDate: string,
    serviceId: string,
  ): Promise<string> {
    let irn = await this.generateIrn(tenantId, issueDate, serviceId);
    let attempts = 0;

    while (!(await this.isIrnUnique(irn)) && attempts < 5) {
      irn = await this.generateIrn(tenantId, issueDate, serviceId);
      attempts++;
    }

    if (attempts >= 5) {
      throw new Error('Failed to generate unique IRN after 5 attempts');
    }

    return irn;
  }

  private async getNextInvoiceSequence(
    tenantId: string,
    year: string,
  ): Promise<number> {
    const latest = await this.prisma.asAdmin((tx) =>
      tx.invoice.findFirst({
        where: {
          tenantId,
          platformIrn: { startsWith: `INV${year}` },
        },
        orderBy: { createdAt: 'desc' },
        select: { platformIrn: true },
      }),
    );

    if (!latest) return 1;

    const match = latest.platformIrn.match(/^INV\d{4}(\d{4})/);
    return match ? parseInt(match[1], 10) + 1 : 1;
  }
}
