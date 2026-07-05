/// <reference types="jest" />

import { ReminderController } from './reminder.controller';
import { ReminderService } from './services/reminder.service';

const TENANT_ID = 'tenant-001';

function makeRequest(): any {
  return { _billinxContext: { tenantId: TENANT_ID } };
}

describe('ReminderController', () => {
  let controller: ReminderController;
  let service: jest.Mocked<
    Pick<
      ReminderService,
      'listRules' | 'createRule' | 'updateRule' | 'deleteRule'
    >
  >;

  beforeEach(() => {
    service = {
      listRules: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      createRule: jest.fn().mockResolvedValue({ id: 'rule-1' }),
      updateRule: jest.fn().mockResolvedValue({ id: 'rule-1' }),
      deleteRule: jest.fn().mockResolvedValue(undefined),
    };
    controller = new ReminderController(service as any);
  });

  it('listRules scopes to the caller tenant', async () => {
    await controller.listRules(makeRequest());
    expect(service.listRules).toHaveBeenCalledWith(TENANT_ID);
  });

  it('createRule scopes the request body to the caller tenant', async () => {
    const body = {
      name: 'Custom',
      triggerType: 'DAYS_AFTER_DUE',
      triggerDays: 5,
    };
    await controller.createRule(makeRequest(), body);
    expect(service.createRule).toHaveBeenCalledWith(TENANT_ID, body);
  });

  it('updateRule scopes the patch to the caller tenant and rule id', async () => {
    const body = { isActive: false };
    await controller.updateRule(makeRequest(), 'rule-1', body);
    expect(service.updateRule).toHaveBeenCalledWith(TENANT_ID, 'rule-1', body);
  });

  it('deleteRule scopes the deletion to the caller tenant and rule id', async () => {
    await controller.deleteRule(makeRequest(), 'rule-1');
    expect(service.deleteRule).toHaveBeenCalledWith(TENANT_ID, 'rule-1');
  });
});
