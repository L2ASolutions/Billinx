/// <reference types="jest" />

import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { AdjustmentType } from './dto/adjust-stock.dto';

const TENANT_ID = 'tenant-001';

jest.mock('../../shared/context/request-context', () => ({
  getRequestContext: jest.fn().mockReturnValue({ tenantId: 'tenant-001' }),
}));

describe('InventoryController', () => {
  let controller: InventoryController;
  let service: jest.Mocked<
    Pick<
      InventoryService,
      | 'getStockList'
      | 'getAlerts'
      | 'getMovements'
      | 'adjustStock'
      | 'triggerReorder'
    >
  >;

  beforeEach(() => {
    service = {
      getStockList: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getAlerts: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getMovements: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      adjustStock: jest.fn().mockResolvedValue({ id: 'movement-1' }),
      triggerReorder: jest.fn().mockResolvedValue({ sent: true }),
    };
    controller = new InventoryController(service as any);
  });

  describe('getStockList', () => {
    it('parses lowStock/page/limit query strings', async () => {
      await controller.getStockList('true', '2', '10');
      expect(service.getStockList).toHaveBeenCalledWith(TENANT_ID, {
        lowStock: true,
        page: 2,
        limit: 10,
      });
    });

    it('defaults lowStock to false and page/limit to 1/20 when omitted', async () => {
      await controller.getStockList(undefined, undefined, undefined);
      expect(service.getStockList).toHaveBeenCalledWith(TENANT_ID, {
        lowStock: false,
        page: 1,
        limit: 20,
      });
    });
  });

  it('getAlerts scopes to the caller tenant', async () => {
    await controller.getAlerts();
    expect(service.getAlerts).toHaveBeenCalledWith(TENANT_ID);
  });

  describe('getMovements', () => {
    it('parses page/limit and forwards the productId', async () => {
      await controller.getMovements('product-1', '3', '5');
      expect(service.getMovements).toHaveBeenCalledWith(
        TENANT_ID,
        'product-1',
        3,
        5,
      );
    });

    it('defaults page/limit to 1/20 when omitted', async () => {
      await controller.getMovements('product-1', undefined, undefined);
      expect(service.getMovements).toHaveBeenCalledWith(
        TENANT_ID,
        'product-1',
        1,
        20,
      );
    });
  });

  it('adjustStock forwards productId and the adjustment DTO', async () => {
    const dto = { quantity: 5, type: AdjustmentType.PURCHASE };
    await controller.adjustStock('product-1', dto);
    expect(service.adjustStock).toHaveBeenCalledWith(
      TENANT_ID,
      'product-1',
      dto,
    );
  });

  it('triggerReorder forwards the productId', async () => {
    await controller.triggerReorder('product-1');
    expect(service.triggerReorder).toHaveBeenCalledWith(TENANT_ID, 'product-1');
  });
});
