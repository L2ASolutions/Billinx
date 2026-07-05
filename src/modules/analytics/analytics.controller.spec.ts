/// <reference types="jest" />

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

const TENANT_ID = 'tenant-001';

function makeRequest(): any {
  return { _billinxContext: { tenantId: TENANT_ID } };
}

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: jest.Mocked<
    Pick<
      AnalyticsService,
      | 'topItemsSold'
      | 'topPurchases'
      | 'topSuppliers'
      | 'topClients'
      | 'priceTrends'
      | 'revenueVsExpenses'
    >
  >;

  beforeEach(() => {
    service = {
      topItemsSold: jest.fn().mockResolvedValue([]),
      topPurchases: jest.fn().mockResolvedValue([]),
      topSuppliers: jest.fn().mockResolvedValue([]),
      topClients: jest.fn().mockResolvedValue([]),
      priceTrends: jest.fn().mockResolvedValue([]),
      revenueVsExpenses: jest.fn().mockResolvedValue([]),
    };
    controller = new AnalyticsController(service as any);
  });

  it('topItemsSold forwards the tenant and optional period', async () => {
    await controller.topItemsSold(makeRequest(), 'month');
    expect(service.topItemsSold).toHaveBeenCalledWith(TENANT_ID, 'month');
  });

  it('topPurchases forwards the tenant and optional period', async () => {
    await controller.topPurchases(makeRequest(), 'quarter');
    expect(service.topPurchases).toHaveBeenCalledWith(TENANT_ID, 'quarter');
  });

  it('topSuppliers scopes to the caller tenant', async () => {
    await controller.topSuppliers(makeRequest());
    expect(service.topSuppliers).toHaveBeenCalledWith(TENANT_ID);
  });

  it('topClients scopes to the caller tenant', async () => {
    await controller.topClients(makeRequest());
    expect(service.topClients).toHaveBeenCalledWith(TENANT_ID);
  });

  describe('priceTrends', () => {
    it('parses months to a number and forwards itemName', async () => {
      await controller.priceTrends(makeRequest(), 'widget', '3');
      expect(service.priceTrends).toHaveBeenCalledWith(TENANT_ID, 'widget', 3);
    });

    it('defaults months to 6 when omitted', async () => {
      await controller.priceTrends(makeRequest(), 'widget', undefined);
      expect(service.priceTrends).toHaveBeenCalledWith(TENANT_ID, 'widget', 6);
    });
  });

  describe('revenueVsExpenses', () => {
    it('parses months to a number', async () => {
      await controller.revenueVsExpenses(makeRequest(), '12');
      expect(service.revenueVsExpenses).toHaveBeenCalledWith(TENANT_ID, 12);
    });

    it('defaults months to 6 when omitted', async () => {
      await controller.revenueVsExpenses(makeRequest(), undefined);
      expect(service.revenueVsExpenses).toHaveBeenCalledWith(TENANT_ID, 6);
    });
  });
});
