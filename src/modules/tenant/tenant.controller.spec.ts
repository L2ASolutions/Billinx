/// <reference types="jest" />

import { TenantController } from './tenant.controller';
import { TenantService } from './services/tenant.service';

describe('TenantController', () => {
  let controller: TenantController;
  let tenantService: jest.Mocked<
    Pick<
      TenantService,
      | 'createTenant'
      | 'listTenants'
      | 'getTenant'
      | 'updateTenant'
      | 'deactivateTenant'
    >
  >;

  beforeEach(() => {
    tenantService = {
      createTenant: jest.fn().mockResolvedValue({ id: 'tenant-1' }),
      listTenants: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getTenant: jest.fn().mockResolvedValue({ id: 'tenant-1' }),
      updateTenant: jest.fn().mockResolvedValue({ id: 'tenant-1' }),
      deactivateTenant: jest.fn().mockResolvedValue({ id: 'tenant-1' }),
    };
    controller = new TenantController(tenantService as any);
  });

  it('createTenant delegates the request body to the service', async () => {
    const body = { name: 'Acme Ltd', tin: 'TIN123' };
    const result = await controller.createTenant(body as any);

    expect(tenantService.createTenant).toHaveBeenCalledWith(body);
    expect(result).toEqual({ id: 'tenant-1' });
  });

  describe('listTenants', () => {
    it('converts page/limit query params to numbers', async () => {
      await controller.listTenants(2, 50);
      expect(tenantService.listTenants).toHaveBeenCalledWith(2, 50);
    });

    it('defaults to page 1 / limit 20 when query params are omitted', async () => {
      await controller.listTenants(undefined, undefined);
      expect(tenantService.listTenants).toHaveBeenCalledWith(1, 20);
    });
  });

  it('getTenant delegates the id param to the service', async () => {
    const result = await controller.getTenant('tenant-1');
    expect(tenantService.getTenant).toHaveBeenCalledWith('tenant-1');
    expect(result).toEqual({ id: 'tenant-1' });
  });

  it('updateTenant delegates the id and body to the service', async () => {
    const body = { name: 'New Name' };
    await controller.updateTenant('tenant-1', body as any);
    expect(tenantService.updateTenant).toHaveBeenCalledWith('tenant-1', body);
  });

  it('deactivateTenant delegates the id to the service and returns no content', async () => {
    const result = await controller.deactivateTenant('tenant-1');
    expect(tenantService.deactivateTenant).toHaveBeenCalledWith('tenant-1');
    expect(result).toBeUndefined();
  });
});
