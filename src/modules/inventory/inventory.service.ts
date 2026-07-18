import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailService } from '../../shared/email/email.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async checkEnabled(tenantId: string): Promise<void> {
    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { inventoryEnabled: true },
      }),
    );
    if (!tenant?.inventoryEnabled) {
      throw new ForbiddenException(
        'Inventory tracking is not enabled. Enable it in Settings → Features.',
      );
    }
  }

  private computeStatus(product: {
    stockQuantity: any;
    reorderPoint: any;
  }): StockStatus {
    const qty = Number(product.stockQuantity);
    const reorder = Number(product.reorderPoint);
    if (qty === 0) return 'OUT_OF_STOCK';
    if (qty <= reorder) return 'LOW_STOCK';
    return 'IN_STOCK';
  }

  async getStockList(
    tenantId: string,
    filters: { lowStock?: boolean; page?: number; limit?: number },
  ) {
    await this.checkEnabled(tenantId);

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    const [products, total] = await this.prisma.asAdmin(async (tx) => {
      const where: any = { tenantId, isActive: true };
      const all = await tx.productCatalog.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      const filtered = filters.lowStock
        ? all.filter((p) => Number(p.stockQuantity) <= Number(p.reorderPoint))
        : all;

      return [filtered.slice(skip, skip + limit), filtered.length] as const;
    });

    return {
      data: products.map((p) => ({ ...p, status: this.computeStatus(p) })),
      total,
      page,
      limit,
    };
  }

  async getAlerts(tenantId: string) {
    await this.checkEnabled(tenantId);

    const products = await this.prisma.asAdmin((tx) =>
      tx.productCatalog.findMany({
        where: { tenantId, isActive: true },
        orderBy: { name: 'asc' },
      }),
    );

    const alerts = products.filter(
      (p) => Number(p.stockQuantity) <= Number(p.reorderPoint),
    );

    return {
      data: alerts.map((p) => ({ ...p, status: this.computeStatus(p) })),
      total: alerts.length,
    };
  }

  async getMovements(
    tenantId: string,
    productId: string,
    page = 1,
    limit = 20,
  ) {
    await this.checkEnabled(tenantId);

    const skip = (page - 1) * limit;
    const [data, total] = await this.prisma.asAdmin(async (tx) => {
      const product = await tx.productCatalog.findFirst({
        where: { id: productId, tenantId },
      });
      if (!product) throw new NotFoundException('Product not found');

      const [movements, count] = await Promise.all([
        (tx as any).stockMovement.findMany({
          where: { tenantId, productId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        (tx as any).stockMovement.count({ where: { tenantId, productId } }),
      ]);
      return [movements, count] as const;
    });

    return { data, total, page, limit };
  }

  async adjustStock(tenantId: string, productId: string, dto: AdjustStockDto) {
    await this.checkEnabled(tenantId);

    return this.prisma.asAdmin(async (tx) => {
      const product = await tx.productCatalog.findFirst({
        where: { id: productId, tenantId },
      });
      if (!product) throw new NotFoundException('Product not found');

      const balanceBefore = Number(product.stockQuantity);
      const balanceAfter = balanceBefore + dto.quantity;

      const movement = await (tx as any).stockMovement.create({
        data: {
          tenantId,
          productId,
          type: dto.type,
          quantity: dto.quantity,
          balanceBefore,
          balanceAfter,
          notes: dto.notes,
        },
      });

      await tx.productCatalog.update({
        where: { id: productId },
        data: { stockQuantity: balanceAfter },
      });

      const reorderPoint = Number(product.reorderPoint);
      if (balanceAfter <= reorderPoint && balanceBefore > reorderPoint) {
        this.logger.log(
          `Low stock alert: product ${productId} at ${balanceAfter} (reorder: ${reorderPoint})`,
        );
      }

      return movement;
    });
  }

  async deductStock(tenantId: string, invoiceId: string): Promise<void> {
    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { inventoryEnabled: true },
      }),
    );
    if (!tenant?.inventoryEnabled) return;

    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { lineItems: true },
      }),
    );
    if (!invoice) return;

    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];

    for (const item of lineItems as any[]) {
      const hsnCode = item.hsnCode || item.commodityClassification?.hsn;
      if (!hsnCode) continue;

      const product = await this.prisma.asAdmin((tx) =>
        tx.productCatalog.findFirst({
          where: { tenantId, hsnCode, isActive: true },
        }),
      );
      if (!product) continue;

      const qty = Number(item.quantity ?? item.invoicedQuantity ?? 0);
      if (qty <= 0) continue;

      const balanceBefore = Number(product.stockQuantity);
      if (balanceBefore <= 0) continue;

      const balanceAfter = Math.max(0, balanceBefore - qty);

      await this.prisma.asAdmin(async (tx) => {
        await (tx as any).stockMovement.create({
          data: {
            tenantId,
            productId: product.id,
            type: 'SALE',
            quantity: -qty,
            balanceBefore,
            balanceAfter,
            referenceType: 'INVOICE',
            referenceId: invoiceId,
          },
        });
        await tx.productCatalog.update({
          where: { id: product.id },
          data: { stockQuantity: balanceAfter },
        });
      });

      const reorderPoint = Number(product.reorderPoint);
      if (balanceAfter <= reorderPoint && balanceBefore > reorderPoint) {
        this.logger.log(
          `Stock depleted below reorder point: product ${product.id}`,
        );
      }
    }
  }

  async addStock(tenantId: string, incomingInvoiceId: string): Promise<void> {
    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { inventoryEnabled: true, name: true },
      }),
    );
    if (!tenant?.inventoryEnabled) return;

    const items = await this.prisma.asAdmin((tx) =>
      (tx as any).incomingInvoiceItem.findMany({
        where: { incomingInvoiceId },
      }),
    );

    for (const item of items as any[]) {
      const product = await this.prisma.asAdmin((tx) =>
        tx.productCatalog.findFirst({
          where: {
            tenantId,
            isActive: true,
            name: { contains: item.description, mode: 'insensitive' },
          },
        }),
      );
      if (!product) continue;

      const qty = Number(item.quantity ?? 0);
      if (qty <= 0) continue;

      const balanceBefore = Number(product.stockQuantity);
      const balanceAfter = balanceBefore + qty;

      await this.prisma.asAdmin(async (tx) => {
        await (tx as any).stockMovement.create({
          data: {
            tenantId,
            productId: product.id,
            type: 'PURCHASE',
            quantity: qty,
            balanceBefore,
            balanceAfter,
            referenceType: 'INCOMING_INVOICE',
            referenceId: incomingInvoiceId,
          },
        });
        await tx.productCatalog.update({
          where: { id: product.id },
          data: { stockQuantity: balanceAfter, lastRestockedAt: new Date() },
        });
      });
    }
  }

  async getLowStockCount(tenantId: string): Promise<number> {
    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { inventoryEnabled: true },
      }),
    );
    if (!tenant?.inventoryEnabled) return 0;

    const products = await this.prisma.asAdmin((tx) =>
      tx.productCatalog.findMany({
        where: { tenantId, isActive: true },
        select: { stockQuantity: true, reorderPoint: true },
      }),
    );

    return products.filter(
      (p) => Number(p.stockQuantity) <= Number(p.reorderPoint),
    ).length;
  }

  async triggerReorder(tenantId: string, productId: string) {
    await this.checkEnabled(tenantId);

    const [product, tenant] = await this.prisma.asAdmin(async (tx) => {
      const p = await tx.productCatalog.findFirst({
        where: { id: productId, tenantId },
      });
      const t = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      return [p, t] as const;
    });

    if (!product) throw new NotFoundException('Product not found');
    if (!product.supplierEmail) {
      throw new ForbiddenException('No supplier email set for this product');
    }

    this.emailService.sendReorderRequest({
      to: product.supplierEmail,
      supplierName: product.supplierName ?? 'Supplier',
      tenantName: tenant?.name ?? 'Our Company',
      productName: product.name,
      productCode: product.hsnCode ?? undefined,
      currentStock: Number(product.stockQuantity),
      reorderQuantity: Number(product.reorderQuantity),
      stockUnit: product.stockUnit ?? undefined,
    });

    this.logger.log(
      `Reorder request sent for product ${productId} to ${product.supplierEmail}`,
    );

    return { sent: true, to: product.supplierEmail };
  }
}
