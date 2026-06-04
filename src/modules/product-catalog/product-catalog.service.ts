import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ActivityService } from '../activity/services/activity.service';
import { getRequestContext } from '../../shared/context/request-context';

@Injectable()
export class ProductCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
  ) {}

  async createProduct(tenantId: string, data: Record<string, any>) {
    const product = await (this.prisma as any).productCatalog.create({
      data: {
        tenantId,
        name: data.name,
        description: data.description ?? null,
        hsnCode: data.hsnCode ?? null,
        productCategory: data.productCategory ?? null,
        unitPrice: data.unitPrice,
        currency: data.currency ?? 'NGN',
        taxCategoryId: data.taxCategoryId ?? 'STANDARD_VAT',
        isActive: data.isActive !== undefined ? data.isActive : true,
        stockQuantity: data.stockQuantity !== undefined ? data.stockQuantity : 0,
        reorderPoint: data.reorderPoint !== undefined ? data.reorderPoint : 0,
        reorderQuantity: data.reorderQuantity !== undefined ? data.reorderQuantity : 0,
        stockUnit: data.stockUnit ?? null,
        supplierName: data.supplierName ?? null,
        supplierEmail: data.supplierEmail ?? null,
      },
    });

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'PRODUCT_CREATED',
      actor: ctx.actor,
      entityType: 'ProductCatalog',
      entityId: product.id,
      payload: { name: data.name, hsnCode: data.hsnCode, unitPrice: data.unitPrice },
    });

    return this.mapProduct(product);
  }

  async getProduct(id: string, tenantId: string) {
    const product = await (this.prisma as any).productCatalog.findFirst({
      where: { id, tenantId },
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return this.mapProduct(product);
  }

  async listProducts(
    tenantId: string,
    filters: { search?: string; category?: string; isActive?: string },
  ) {
    const where: any = { tenantId };
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive === 'true';
    }
    if (filters.category) {
      where.productCategory = {
        contains: filters.category,
        mode: 'insensitive',
      };
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { hsnCode: { contains: filters.search } },
      ];
    }

    const products = await (this.prisma as any).productCatalog.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return {
      data: products.map((p: any) => this.mapProduct(p)),
      total: products.length,
    };
  }

  async updateProduct(id: string, tenantId: string, data: Record<string, any>) {
    const existing = await (this.prisma as any).productCatalog.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Product ${id} not found`);

    const updated = await (this.prisma as any).productCatalog.update({
      where: { id },
      data: {
        name: data.name ?? existing.name,
        description:
          data.description !== undefined
            ? data.description
            : existing.description,
        hsnCode: data.hsnCode !== undefined ? data.hsnCode : existing.hsnCode,
        productCategory:
          data.productCategory !== undefined
            ? data.productCategory
            : existing.productCategory,
        unitPrice:
          data.unitPrice !== undefined ? data.unitPrice : existing.unitPrice,
        currency: data.currency ?? existing.currency,
        taxCategoryId: data.taxCategoryId ?? existing.taxCategoryId,
        isActive:
          data.isActive !== undefined ? data.isActive : existing.isActive,
        stockQuantity: data.stockQuantity !== undefined ? data.stockQuantity : existing.stockQuantity,
        reorderPoint: data.reorderPoint !== undefined ? data.reorderPoint : existing.reorderPoint,
        reorderQuantity: data.reorderQuantity !== undefined ? data.reorderQuantity : existing.reorderQuantity,
        stockUnit: data.stockUnit !== undefined ? data.stockUnit : existing.stockUnit,
        supplierName: data.supplierName !== undefined ? data.supplierName : existing.supplierName,
        supplierEmail: data.supplierEmail !== undefined ? data.supplierEmail : existing.supplierEmail,
      },
    });

    const ctx = getRequestContext();
    this.activityService.track({
      tenantId,
      eventType: 'PRODUCT_UPDATED',
      actor: ctx.actor,
      entityType: 'ProductCatalog',
      entityId: id,
      payload: { name: updated.name },
    });

    return this.mapProduct(updated);
  }

  async deleteProduct(id: string, tenantId: string) {
    const existing = await (this.prisma as any).productCatalog.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Product ${id} not found`);

    await (this.prisma as any).productCatalog.delete({ where: { id } });
    return { deleted: true, id };
  }

  async getProductAsLineItem(id: string, tenantId: string) {
    const product = await this.getProduct(id, tenantId);

    return {
      lineId: '1',
      description: product.name,
      quantity: 1,
      unitPrice: product.unitPrice,
      lineExtensionAmount: product.unitPrice,
      hsnCode: product.hsnCode ?? undefined,
      taxCategory: product.taxCategoryId,
      taxRate: product.taxCategoryId === 'STANDARD_VAT' ? 7.5 : 0,
    };
  }

  private mapProduct(p: any) {
    return {
      id: p.id,
      tenantId: p.tenantId,
      name: p.name,
      description: p.description ?? undefined,
      hsnCode: p.hsnCode ?? undefined,
      productCategory: p.productCategory ?? undefined,
      unitPrice: Number(p.unitPrice),
      currency: p.currency,
      taxCategoryId: p.taxCategoryId,
      isActive: p.isActive,
      stockQuantity: Number(p.stockQuantity ?? 0),
      reorderPoint: Number(p.reorderPoint ?? 0),
      reorderQuantity: Number(p.reorderQuantity ?? 0),
      stockUnit: p.stockUnit ?? undefined,
      supplierName: p.supplierName ?? undefined,
      supplierEmail: p.supplierEmail ?? undefined,
      lastRestockedAt: p.lastRestockedAt?.toISOString() ?? undefined,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
