/// <reference types="jest" />

import { NotFoundException } from '@nestjs/common';
import { ProductCatalogService } from './product-catalog.service';

const TENANT_ID = 'tenant-001';

jest.mock('../../shared/context/request-context', () => ({
  getRequestContext: jest.fn().mockReturnValue({
    tenantId: 'tenant-001',
    actor: 'user:user-001',
    actorType: 'user',
  }),
}));

function makeProductRow(overrides: Record<string, any> = {}) {
  return {
    id: 'product-1',
    tenantId: TENANT_ID,
    name: 'Widget',
    description: 'A widget',
    itemType: 'PRODUCT',
    hsnCode: '1234',
    productCategory: 'hardware',
    isicCode: null,
    serviceCategory: null,
    unitPrice: 100,
    priceUnit: 'EA',
    currency: 'NGN',
    taxCategoryId: 'STANDARD_VAT',
    isActive: true,
    stockQuantity: 10,
    reorderPoint: 2,
    reorderQuantity: 5,
    stockUnit: 'pcs',
    supplierName: 'Acme Supplier',
    supplierEmail: 'supplier@acme.com',
    lastRestockedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ProductCatalogService', () => {
  let prisma: { productCatalog: Record<string, jest.Mock> };
  let activityService: { track: jest.Mock };
  let service: ProductCatalogService;

  beforeEach(() => {
    prisma = {
      productCatalog: {
        create: jest.fn().mockResolvedValue(makeProductRow()),
        findFirst: jest.fn().mockResolvedValue(makeProductRow()),
        findMany: jest.fn().mockResolvedValue([makeProductRow()]),
        update: jest.fn().mockResolvedValue(makeProductRow()),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    activityService = { track: jest.fn() };
    service = new ProductCatalogService(prisma as any, activityService as any);
  });

  describe('createProduct', () => {
    it('applies defaults for optional fields and maps the result', async () => {
      const result = await service.createProduct(TENANT_ID, {
        name: 'Widget',
        unitPrice: 100,
      });

      expect(prisma.productCatalog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          name: 'Widget',
          description: null,
          itemType: 'PRODUCT',
          hsnCode: null,
          productCategory: null,
          isicCode: null,
          serviceCategory: null,
          unitPrice: 100,
          priceUnit: 'EA',
          currency: 'NGN',
          taxCategoryId: 'STANDARD_VAT',
          isActive: true,
          stockQuantity: 0,
          reorderPoint: 0,
          reorderQuantity: 0,
        }),
      });
      expect(result.id).toBe('product-1');
      expect(result.unitPrice).toBe(100);
    });

    it('accepts SERVICE itemType with isicCode/serviceCategory and a non-default priceUnit', async () => {
      await service.createProduct(TENANT_ID, {
        name: 'Consulting',
        unitPrice: 500,
        itemType: 'SERVICE',
        isicCode: '6201',
        serviceCategory: 'Software Consulting',
        priceUnit: 'KGM',
      });

      expect(prisma.productCatalog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          itemType: 'SERVICE',
          isicCode: '6201',
          serviceCategory: 'Software Consulting',
          priceUnit: 'KGM',
        }),
      });
    });

    it('respects explicit isActive=false and stockQuantity=0 (not treated as missing)', async () => {
      await service.createProduct(TENANT_ID, {
        name: 'Widget',
        unitPrice: 100,
        isActive: false,
        stockQuantity: 0,
      });

      expect(prisma.productCatalog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isActive: false, stockQuantity: 0 }),
      });
    });

    it('tracks a PRODUCT_CREATED activity event with the actor from request context', async () => {
      await service.createProduct(TENANT_ID, {
        name: 'Widget',
        unitPrice: 100,
      });

      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          eventType: 'PRODUCT_CREATED',
          actor: 'user:user-001',
          entityId: 'product-1',
        }),
      );
    });
  });

  describe('getProduct', () => {
    it('throws NotFoundException when no product matches id+tenantId', async () => {
      prisma.productCatalog.findFirst.mockResolvedValue(null);
      await expect(service.getProduct('missing', TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('scopes the lookup to both id and tenantId (tenant isolation)', async () => {
      await service.getProduct('product-1', TENANT_ID);
      expect(prisma.productCatalog.findFirst).toHaveBeenCalledWith({
        where: { id: 'product-1', tenantId: TENANT_ID },
      });
    });

    it('converts Decimal-like unitPrice/stock fields to numbers', async () => {
      prisma.productCatalog.findFirst.mockResolvedValue(
        makeProductRow({ unitPrice: '250.50', stockQuantity: '3' }),
      );
      const result = await service.getProduct('product-1', TENANT_ID);
      expect(result.unitPrice).toBe(250.5);
      expect(result.stockQuantity).toBe(3);
    });
  });

  describe('listProducts', () => {
    it('applies no extra filters beyond tenantId when none are provided', async () => {
      await service.listProducts(TENANT_ID, {});
      expect(prisma.productCatalog.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        orderBy: { name: 'asc' },
      });
    });

    it('parses isActive query string into a boolean', async () => {
      await service.listProducts(TENANT_ID, { isActive: 'false' });
      expect(prisma.productCatalog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: false }),
        }),
      );
    });

    it('applies a case-insensitive category filter', async () => {
      await service.listProducts(TENANT_ID, { category: 'hardware' });
      expect(prisma.productCatalog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            productCategory: { contains: 'hardware', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('searches name/description/hsnCode with a search term', async () => {
      await service.listProducts(TENANT_ID, { search: 'widget' });
      const call = prisma.productCatalog.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { name: { contains: 'widget', mode: 'insensitive' } },
        { description: { contains: 'widget', mode: 'insensitive' } },
        { hsnCode: { contains: 'widget' } },
      ]);
    });

    it('returns data mapped alongside a total count', async () => {
      const result = await service.listProducts(TENANT_ID, {});
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('product-1');
    });
  });

  describe('updateProduct', () => {
    it('throws NotFoundException when the product does not exist for this tenant', async () => {
      prisma.productCatalog.findFirst.mockResolvedValue(null);
      await expect(
        service.updateProduct('missing', TENANT_ID, { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('falls back to existing values for fields not present in the patch', async () => {
      await service.updateProduct('product-1', TENANT_ID, { name: 'New Name' });

      expect(prisma.productCatalog.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: expect.objectContaining({
          name: 'New Name',
          description: 'A widget',
          hsnCode: '1234',
          unitPrice: 100,
          currency: 'NGN',
        }),
      });
    });

    it('overwrites with explicit falsy values (0, false, empty string) rather than falling back', async () => {
      await service.updateProduct('product-1', TENANT_ID, {
        stockQuantity: 0,
        isActive: false,
        description: '',
      });

      expect(prisma.productCatalog.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: expect.objectContaining({
          stockQuantity: 0,
          isActive: false,
          description: '',
        }),
      });
    });

    it('tracks a PRODUCT_UPDATED activity event', async () => {
      await service.updateProduct('product-1', TENANT_ID, { name: 'New Name' });
      expect(activityService.track).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'PRODUCT_UPDATED',
          entityId: 'product-1',
        }),
      );
    });

    it('falls back to existing itemType/isicCode/serviceCategory/priceUnit when omitted', async () => {
      prisma.productCatalog.findFirst.mockResolvedValue(
        makeProductRow({
          itemType: 'SERVICE',
          isicCode: '6201',
          serviceCategory: 'Software Consulting',
          priceUnit: 'KGM',
        }),
      );

      await service.updateProduct('product-1', TENANT_ID, { name: 'New Name' });

      expect(prisma.productCatalog.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: expect.objectContaining({
          itemType: 'SERVICE',
          isicCode: '6201',
          serviceCategory: 'Software Consulting',
          priceUnit: 'KGM',
        }),
      });
    });

    it('overwrites itemType/isicCode/serviceCategory/priceUnit when explicitly patched', async () => {
      await service.updateProduct('product-1', TENANT_ID, {
        itemType: 'SERVICE',
        isicCode: '4321',
        serviceCategory: 'Consulting',
        priceUnit: 'LTR',
      });

      expect(prisma.productCatalog.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: expect.objectContaining({
          itemType: 'SERVICE',
          isicCode: '4321',
          serviceCategory: 'Consulting',
          priceUnit: 'LTR',
        }),
      });
    });
  });

  describe('deleteProduct', () => {
    it('throws NotFoundException when the product does not exist for this tenant', async () => {
      prisma.productCatalog.findFirst.mockResolvedValue(null);
      await expect(service.deleteProduct('missing', TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.productCatalog.delete).not.toHaveBeenCalled();
    });

    it('deletes and returns a confirmation', async () => {
      const result = await service.deleteProduct('product-1', TENANT_ID);
      expect(prisma.productCatalog.delete).toHaveBeenCalledWith({
        where: { id: 'product-1' },
      });
      expect(result).toEqual({ deleted: true, id: 'product-1' });
    });
  });

  describe('getProductAsLineItem', () => {
    it('maps a STANDARD_VAT product to a 7.5% tax rate line item', async () => {
      const result = await service.getProductAsLineItem('product-1', TENANT_ID);
      expect(result).toMatchObject({
        description: 'Widget',
        quantity: 1,
        unitPrice: 100,
        lineExtensionAmount: 100,
        taxCategory: 'STANDARD_VAT',
        taxRate: 7.5,
        itemType: 'PRODUCT',
        hsnCode: '1234',
        priceUnit: 'EA',
      });
    });

    it('surfaces isicCode/serviceCategory for a SERVICE product', async () => {
      prisma.productCatalog.findFirst.mockResolvedValue(
        makeProductRow({
          itemType: 'SERVICE',
          isicCode: '6201',
          serviceCategory: 'Software Consulting',
          hsnCode: null,
          productCategory: null,
        }),
      );
      const result = await service.getProductAsLineItem('product-1', TENANT_ID);
      expect(result).toMatchObject({
        itemType: 'SERVICE',
        isicCode: '6201',
        serviceCategory: 'Software Consulting',
      });
    });

    it('maps a non-STANDARD_VAT product to a 0% tax rate line item', async () => {
      prisma.productCatalog.findFirst.mockResolvedValue(
        makeProductRow({ taxCategoryId: 'ZERO_RATED' }),
      );
      const result = await service.getProductAsLineItem('product-1', TENANT_ID);
      expect(result.taxRate).toBe(0);
    });

    it('throws NotFoundException when the underlying product does not exist', async () => {
      prisma.productCatalog.findFirst.mockResolvedValue(null);
      await expect(
        service.getProductAsLineItem('missing', TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
