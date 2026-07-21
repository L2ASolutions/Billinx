/// <reference types="jest" />

import { RecurringInvoiceController } from './recurring-invoice.controller';
import { RecurringInvoiceService } from './services/recurring-invoice.service';

const TENANT_ID = 'tenant-001';

function makeRequest(): any {
  return { _billinxContext: { tenantId: TENANT_ID } };
}

describe('RecurringInvoiceController', () => {
  let controller: RecurringInvoiceController;
  let service: jest.Mocked<
    Pick<
      RecurringInvoiceService,
      | 'createSchedule'
      | 'listSchedules'
      | 'getSchedule'
      | 'updateSchedule'
      | 'pauseSchedule'
      | 'resumeSchedule'
      | 'cancelSchedule'
    >
  >;

  beforeEach(() => {
    service = {
      createSchedule: jest.fn().mockResolvedValue({ id: 'sched-1' }),
      listSchedules: jest.fn().mockResolvedValue([{ id: 'sched-1' }]),
      getSchedule: jest.fn().mockResolvedValue({ id: 'sched-1' }),
      updateSchedule: jest.fn().mockResolvedValue({ id: 'sched-1' }),
      pauseSchedule: jest
        .fn()
        .mockResolvedValue({ id: 'sched-1', status: 'PAUSED' }),
      resumeSchedule: jest
        .fn()
        .mockResolvedValue({ id: 'sched-1', status: 'ACTIVE' }),
      cancelSchedule: jest
        .fn()
        .mockResolvedValue({ id: 'sched-1', status: 'CANCELLED' }),
    };
    controller = new RecurringInvoiceController(service as any);
  });

  it('createSchedule scopes the request body to the caller tenant', async () => {
    const body = { name: 'Monthly retainer' } as any;
    await controller.createSchedule(makeRequest(), body);
    expect(service.createSchedule).toHaveBeenCalledWith(TENANT_ID, body);
  });

  it('listSchedules scopes to the caller tenant', async () => {
    await controller.listSchedules(makeRequest());
    expect(service.listSchedules).toHaveBeenCalledWith(TENANT_ID);
  });

  it('getSchedule scopes to the caller tenant and requested id', async () => {
    await controller.getSchedule(makeRequest(), 'sched-1');
    expect(service.getSchedule).toHaveBeenCalledWith(TENANT_ID, 'sched-1');
  });

  it('updateSchedule scopes the request body to the caller tenant and requested id', async () => {
    const body = { name: 'Renamed' } as any;
    await controller.updateSchedule(makeRequest(), 'sched-1', body);
    expect(service.updateSchedule).toHaveBeenCalledWith(
      TENANT_ID,
      'sched-1',
      body,
    );
  });

  it('pauseSchedule delegates to the service', async () => {
    await controller.pauseSchedule(makeRequest(), 'sched-1');
    expect(service.pauseSchedule).toHaveBeenCalledWith(TENANT_ID, 'sched-1');
  });

  it('resumeSchedule delegates to the service', async () => {
    await controller.resumeSchedule(makeRequest(), 'sched-1');
    expect(service.resumeSchedule).toHaveBeenCalledWith(TENANT_ID, 'sched-1');
  });

  it('cancelSchedule delegates to the service', async () => {
    await controller.cancelSchedule(makeRequest(), 'sched-1');
    expect(service.cancelSchedule).toHaveBeenCalledWith(TENANT_ID, 'sched-1');
  });
});
