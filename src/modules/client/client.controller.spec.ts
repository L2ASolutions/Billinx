/// <reference types="jest" />

import { ClientController } from './client.controller';
import { ClientService } from './client.service';

const TENANT_ID = 'tenant-001';

function makeRequest(): any {
  return { _billinxContext: { tenantId: TENANT_ID } };
}

describe('ClientController', () => {
  let controller: ClientController;
  let service: jest.Mocked<
    Pick<
      ClientService,
      'getFrequent' | 'findAll' | 'findOne' | 'create' | 'update' | 'delete'
    >
  >;

  beforeEach(() => {
    service = {
      getFrequent: jest.fn().mockResolvedValue([]),
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      findOne: jest.fn().mockResolvedValue({ id: 'client-1' }),
      create: jest.fn().mockResolvedValue({ id: 'client-1' }),
      update: jest.fn().mockResolvedValue({ id: 'client-1' }),
      delete: jest.fn().mockResolvedValue({ deleted: true, id: 'client-1' }),
    };
    controller = new ClientController(service as any);
  });

  it('getFrequent scopes to the caller tenant', async () => {
    await controller.getFrequent(makeRequest());
    expect(service.getFrequent).toHaveBeenCalledWith(TENANT_ID);
  });

  describe('findAll', () => {
    it('parses page/limit query strings and forwards the search term', async () => {
      await controller.findAll(makeRequest(), 'acme', '3', '10');
      expect(service.findAll).toHaveBeenCalledWith(TENANT_ID, 'acme', 3, 10);
    });

    it('defaults to page 1 / limit 20 when omitted', async () => {
      await controller.findAll(makeRequest(), undefined, undefined, undefined);
      expect(service.findAll).toHaveBeenCalledWith(TENANT_ID, undefined, 1, 20);
    });
  });

  it('findOne scopes the lookup to the caller tenant', async () => {
    await controller.findOne('client-1', makeRequest());
    expect(service.findOne).toHaveBeenCalledWith(TENANT_ID, 'client-1');
  });

  it('create scopes the request body to the caller tenant', async () => {
    const body = { companyName: 'Acme Ltd' };
    await controller.create(body, makeRequest());
    expect(service.create).toHaveBeenCalledWith(TENANT_ID, body);
  });

  it('update scopes the patch to the caller tenant', async () => {
    const body = { companyName: 'New Name' };
    await controller.update('client-1', body, makeRequest());
    expect(service.update).toHaveBeenCalledWith(TENANT_ID, 'client-1', body);
  });

  it('delete scopes the deletion to the caller tenant', async () => {
    await controller.delete('client-1', makeRequest());
    expect(service.delete).toHaveBeenCalledWith(TENANT_ID, 'client-1');
  });
});
