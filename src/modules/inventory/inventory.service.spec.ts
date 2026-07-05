/// <reference types="jest" />

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { AdjustmentType } from './dto/adjust-stock.dto';

const TENANT_ID = 'tenant-001';

function makeProductRow(overrides: Record<string, any> = {}) {
  return {
    id: 'product-1',
    tenantId: TENANT_ID,
    name: 'Widget',
    hsnCode: '1234',
    stockQuantity: 10,
    reorderPoint: 5,
    reorderQuantity: 20,
    stockUnit: 'pcs',
    supplierName: 'Acme Supplier',
    supplierEmail: 'supplier@acme.com',
    isActive: true,
    ...overrides,
  };
}

function makeTx(overrides: Record<string, any> = {}) {
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ inventoryEnabled: true }),
    },
    productCatalog: {
      findMany: jest.fn().mockResolvedValue([makeProductRow()]),
      findFirst: jest.fn().mockResolvedValue(makeProductRow()),
      update: jest.fn().mockResolvedValue({}),
    },
    stockMovement: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'movement-1' }),
    },
    invoice: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    incomingInvoiceItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe('InventoryService', () => {
  let tx: ReturnType<typeof makeTx>;
  let prisma: { asAdmin: jest.Mock };
  let emailService: { sendReorderRequest: jest.Mock };
  let service: InventoryService;

  beforeEach(() => {
    tx = makeTx();
    prisma = { asAdmin: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    emailService = { sendReorderRequest: jest.fn() };
    service = new InventoryService(prisma as any, emailService as any);
  });

  describe('checkEnabled', () => {
    it('throws ForbiddenException when inventory tracking is disabled for the tenant', async () => {
      tx.tenant.findUnique.mockResolvedValue({ inventoryEnabled: false });
      await expect(service.checkEnabled(TENANT_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('resolves silently when inventory tracking is enabled', async () => {
      await expect(service.checkEnabled(TENANT_ID)).resolves.toBeUndefined();
    });
  });

  describe('getStockList', () => {
    it('throws when inventory is disabled (gate reused across all read endpoints)', async () => {
      tx.tenant.findUnique.mockResolvedValue({ inventoryEnabled: false });
      await expect(service.getStockList(TENANT_ID, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('classifies each product status from stockQuantity vs reorderPoint', async () => {
      tx.productCatalog.findMany.mockResolvedValue([
        makeProductRow({ id: 'p1', stockQuantity: 0, reorderPoint: 5 }),
        makeProductRow({ id: 'p2', stockQuantity: 3, reorderPoint: 5 }),
        makeProductRow({ id: 'p3', stockQuantity: 10, reorderPoint: 5 }),
      ]);

      const result = await service.getStockList(TENANT_ID, {});
      expect(result.data.map((p: any) => p.status)).toEqual([
        'OUT_OF_STOCK',
        'LOW_STOCK',
        'IN_STOCK',
      ]);
    });

    it('filters to only low/out-of-stock products when lowStock=true', async () => {
      tx.productCatalog.findMany.mockResolvedValue([
        makeProductRow({ id: 'p1', stockQuantity: 0, reorderPoint: 5 }),
        makeProductRow({ id: 'p2', stockQuantity: 10, reorderPoint: 5 }),
      ]);

      const result = await service.getStockList(TENANT_ID, { lowStock: true });
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('p1');
    });

    it('paginates using page/limit against the filtered set', async () => {
      tx.productCatalog.findMany.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => makeProductRow({ id: `p${i}` })),
      );

      const result = await service.getStockList(TENANT_ID, {
        page: 2,
        limit: 10,
      });
      expect(result.data).toHaveLength(10);
      expect(result.data[0].id).toBe('p10');
      expect(result.total).toBe(25);
    });
  });

  describe('getAlerts', () => {
    it('returns only products at or below their reorder point', async () => {
      tx.productCatalog.findMany.mockResolvedValue([
        makeProductRow({ id: 'p1', stockQuantity: 2, reorderPoint: 5 }),
        makeProductRow({ id: 'p2', stockQuantity: 20, reorderPoint: 5 }),
      ]);

      const result = await service.getAlerts(TENANT_ID);
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('p1');
      expect(result.data[0].status).toBe('LOW_STOCK');
    });
  });

  describe('getMovements', () => {
    it('throws NotFoundException when the product does not exist for this tenant', async () => {
      tx.productCatalog.findFirst.mockResolvedValue(null);
      await expect(service.getMovements(TENANT_ID, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('paginates movement history most-recent-first', async () => {
      await service.getMovements(TENANT_ID, 'product-1', 2, 5);
      expect(tx.stockMovement.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, productId: 'product-1' },
        orderBy: { createdAt: 'desc' },
        skip: 5,
        take: 5,
      });
    });
  });

  describe('adjustStock', () => {
    it('throws NotFoundException when the product does not exist for this tenant', async () => {
      tx.productCatalog.findFirst.mockResolvedValue(null);
      await expect(
        service.adjustStock(TENANT_ID, 'missing', {
          quantity: 5,
          type: AdjustmentType.ADJUSTMENT,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a movement recording balanceBefore/balanceAfter and updates stockQuantity', async () => {
      await service.adjustStock(TENANT_ID, 'product-1', {
        quantity: 5,
        type: AdjustmentType.PURCHASE,
        notes: 'restock',
      });

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          productId: 'product-1',
          type: AdjustmentType.PURCHASE,
          quantity: 5,
          balanceBefore: 10,
          balanceAfter: 15,
          notes: 'restock',
        }),
      });
      expect(tx.productCatalog.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: { stockQuantity: 15 },
      });
    });

    it('supports negative adjustments (e.g. write-offs) reducing the balance', async () => {
      await service.adjustStock(TENANT_ID, 'product-1', {
        quantity: -3,
        type: AdjustmentType.WRITE_OFF,
      });

      expect(tx.productCatalog.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: { stockQuantity: 7 },
      });
    });
  });

  describe('deductStock', () => {
    it('does nothing when inventory tracking is disabled', async () => {
      tx.tenant.findUnique.mockResolvedValue({ inventoryEnabled: false });
      await service.deductStock(TENANT_ID, 'invoice-1');
      expect(tx.invoice.findUnique).not.toHaveBeenCalled();
    });

    it('does nothing when the invoice does not exist', async () => {
      tx.invoice.findUnique.mockResolvedValue(null);
      await service.deductStock(TENANT_ID, 'invoice-1');
      expect(tx.productCatalog.findFirst).not.toHaveBeenCalled();
    });

    it('skips line items with no HSN code', async () => {
      tx.invoice.findUnique.mockResolvedValue({
        lineItems: [{ quantity: 1 }],
      });
      await service.deductStock(TENANT_ID, 'invoice-1');
      expect(tx.productCatalog.findFirst).not.toHaveBeenCalled();
    });

    it('skips items whose HSN code matches no active product', async () => {
      tx.invoice.findUnique.mockResolvedValue({
        lineItems: [{ hsnCode: '9999', quantity: 1 }],
      });
      tx.productCatalog.findFirst.mockResolvedValue(null);

      await service.deductStock(TENANT_ID, 'invoice-1');
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('deducts matched quantity, floors at 0, and records a SALE movement', async () => {
      tx.invoice.findUnique.mockResolvedValue({
        lineItems: [{ hsnCode: '1234', quantity: 15 }],
      });
      tx.productCatalog.findFirst.mockResolvedValue(
        makeProductRow({ stockQuantity: 10, reorderPoint: 5 }),
      );

      await service.deductStock(TENANT_ID, 'invoice-1');

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'SALE',
          quantity: -15,
          balanceBefore: 10,
          balanceAfter: 0,
          referenceType: 'INVOICE',
          referenceId: 'invoice-1',
        }),
      });
      expect(tx.productCatalog.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: { stockQuantity: 0 },
      });
    });

    it('skips a matched product that is already at 0 stock', async () => {
      tx.invoice.findUnique.mockResolvedValue({
        lineItems: [{ hsnCode: '1234', quantity: 5 }],
      });
      tx.productCatalog.findFirst.mockResolvedValue(
        makeProductRow({ stockQuantity: 0 }),
      );

      await service.deductStock(TENANT_ID, 'invoice-1');
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('falls back to commodityClassification.hsn and invoicedQuantity when present', async () => {
      tx.invoice.findUnique.mockResolvedValue({
        lineItems: [
          { commodityClassification: { hsn: '1234' }, invoicedQuantity: 2 },
        ],
      });
      tx.productCatalog.findFirst.mockResolvedValue(makeProductRow());

      await service.deductStock(TENANT_ID, 'invoice-1');
      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: -2 }),
        }),
      );
    });
  });

  describe('addStock', () => {
    it('does nothing when inventory tracking is disabled', async () => {
      tx.tenant.findUnique.mockResolvedValue({ inventoryEnabled: false });
      await service.addStock(TENANT_ID, 'incoming-1');
      expect(tx.incomingInvoiceItem.findMany).not.toHaveBeenCalled();
    });

    it('matches items to products by case-insensitive name and increments stock', async () => {
      tx.incomingInvoiceItem.findMany.mockResolvedValue([
        { description: 'widget', quantity: 5 },
      ]);
      tx.productCatalog.findFirst.mockResolvedValue(
        makeProductRow({ stockQuantity: 10 }),
      );

      await service.addStock(TENANT_ID, 'incoming-1');

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'PURCHASE',
          quantity: 5,
          balanceBefore: 10,
          balanceAfter: 15,
          referenceType: 'INCOMING_INVOICE',
          referenceId: 'incoming-1',
        }),
      });
      expect(tx.productCatalog.update).toHaveBeenCalledWith({
        where: { id: 'product-1' },
        data: { stockQuantity: 15, lastRestockedAt: expect.any(Date) },
      });
    });

    it('skips items with no matching product', async () => {
      tx.incomingInvoiceItem.findMany.mockResolvedValue([
        { description: 'Nonexistent Item', quantity: 5 },
      ]);
      tx.productCatalog.findFirst.mockResolvedValue(null);

      await service.addStock(TENANT_ID, 'incoming-1');
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('skips items with a non-positive quantity', async () => {
      tx.incomingInvoiceItem.findMany.mockResolvedValue([
        { description: 'Widget', quantity: 0 },
      ]);

      await service.addStock(TENANT_ID, 'incoming-1');
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('getLowStockCount', () => {
    it('returns 0 when inventory tracking is disabled', async () => {
      tx.tenant.findUnique.mockResolvedValue({ inventoryEnabled: false });
      const result = await service.getLowStockCount(TENANT_ID);
      expect(result).toBe(0);
      expect(tx.productCatalog.findMany).not.toHaveBeenCalled();
    });

    it('counts only products at or below their reorder point', async () => {
      tx.productCatalog.findMany.mockResolvedValue([
        { stockQuantity: 2, reorderPoint: 5 },
        { stockQuantity: 20, reorderPoint: 5 },
        { stockQuantity: 5, reorderPoint: 5 },
      ]);

      const result = await service.getLowStockCount(TENANT_ID);
      expect(result).toBe(2);
    });
  });

  describe('triggerReorder', () => {
    it('throws NotFoundException when the product does not exist for this tenant', async () => {
      tx.productCatalog.findFirst.mockResolvedValue(null);
      await expect(
        service.triggerReorder(TENANT_ID, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the product has no supplier email set', async () => {
      tx.productCatalog.findFirst.mockResolvedValue(
        makeProductRow({ supplierEmail: null }),
      );
      await expect(
        service.triggerReorder(TENANT_ID, 'product-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('sends a reorder email with product/tenant details and returns confirmation', async () => {
      tx.tenant.findUnique.mockResolvedValue({
        inventoryEnabled: true,
        name: 'Acme Ltd',
      });

      const result = await service.triggerReorder(TENANT_ID, 'product-1');

      expect(emailService.sendReorderRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'supplier@acme.com',
          supplierName: 'Acme Supplier',
          tenantName: 'Acme Ltd',
          productName: 'Widget',
          currentStock: 10,
          reorderQuantity: 20,
        }),
      );
      expect(result).toEqual({ sent: true, to: 'supplier@acme.com' });
    });
  });
});
