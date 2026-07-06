/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { InvoiceApiController } from './invoice-api.controller';
import { InvoiceService } from './services/invoice.service';
import { PaymentService } from './services/payment.service';

function makeReq(ctx: Record<string, any> = {}): any {
  return {
    _billinxContext: {
      tenantId: 'tenant-1',
      environment: 'SANDBOX',
      actor: 'api-key:key-1',
      ...ctx,
    },
  };
}

function makeRes(): any {
  return { status: jest.fn(), setHeader: jest.fn() };
}

describe('InvoiceApiController', () => {
  let controller: InvoiceApiController;
  let invoiceService: jest.Mocked<
    Pick<
      InvoiceService,
      | 'createInvoice'
      | 'validateInvoice'
      | 'createInvoiceFromXml'
      | 'listInvoices'
      | 'getInvoiceStats'
      | 'checkBySourceReference'
      | 'getInvoice'
      | 'exportAsXml'
      | 'getInvoiceStatus'
      | 'cancelInvoice'
    >
  >;
  let paymentService: jest.Mocked<
    Pick<PaymentService, 'recordPayment' | 'listPayments'>
  >;

  beforeEach(() => {
    invoiceService = {
      createInvoice: jest
        .fn()
        .mockResolvedValue({ invoice: { id: 'inv-1' }, isDuplicate: false }),
      validateInvoice: jest
        .fn()
        .mockResolvedValue({ valid: true, errors: [], warnings: [] }),
      createInvoiceFromXml: jest
        .fn()
        .mockResolvedValue({ invoice: { id: 'inv-1' }, isDuplicate: false }),
      listInvoices: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getInvoiceStats: jest.fn().mockResolvedValue({ total: 0 }),
      checkBySourceReference: jest.fn().mockResolvedValue(null),
      getInvoice: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      exportAsXml: jest.fn().mockResolvedValue('<Invoice/>'),
      getInvoiceStatus: jest.fn().mockResolvedValue({ status: 'ACCEPTED' }),
      cancelInvoice: jest
        .fn()
        .mockResolvedValue({ id: 'inv-1', status: 'CANCELLED' }),
    };
    paymentService = {
      recordPayment: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      listPayments: jest.fn().mockResolvedValue([]),
    };
    controller = new InvoiceApiController(
      invoiceService as unknown as InvoiceService,
      paymentService as unknown as PaymentService,
    );
  });

  it('createInvoice delegates to the service and returns 201 when not a duplicate', async () => {
    const req = makeReq();
    const res = makeRes();
    const result = await controller.createInvoice({ seller: {} }, req, res);
    expect(invoiceService.createInvoice).toHaveBeenCalledWith(
      'tenant-1',
      'SANDBOX',
      'api-key:key-1',
      { seller: {} },
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(result).toEqual({ id: 'inv-1' });
  });

  it('createInvoice sets the X-Duplicate header and 200 status on a duplicate result', async () => {
    invoiceService.createInvoice.mockResolvedValue({
      invoice: { id: 'inv-1' } as any,
      isDuplicate: true,
      message: 'Invoice already accepted by FIRS',
    });
    const res = makeRes();
    await controller.createInvoice({}, makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('X-Duplicate', 'true');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Duplicate-Message',
      'Invoice already accepted by FIRS',
    );
  });

  it('validateInvoice delegates the body to the service', async () => {
    await controller.validateInvoice({ seller: {} });
    expect(invoiceService.validateInvoice).toHaveBeenCalledWith({ seller: {} });
  });

  it('createInvoiceFromXml throws BadRequestException for a non-string body', async () => {
    await expect(
      controller.createInvoiceFromXml({} as any, makeReq(), makeRes()),
    ).rejects.toThrow(BadRequestException);
    expect(invoiceService.createInvoiceFromXml).not.toHaveBeenCalled();
  });

  it('createInvoiceFromXml throws BadRequestException for an empty/whitespace body', async () => {
    await expect(
      controller.createInvoiceFromXml('   ', makeReq(), makeRes()),
    ).rejects.toThrow('Request body must be a non-empty XML string');
  });

  it('createInvoiceFromXml delegates a valid XML string to the service', async () => {
    const res = makeRes();
    await controller.createInvoiceFromXml('<Invoice/>', makeReq(), res);
    expect(invoiceService.createInvoiceFromXml).toHaveBeenCalledWith(
      'tenant-1',
      'SANDBOX',
      'api-key:key-1',
      '<Invoice/>',
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('listInvoices defaults page/limit and passes filters through', async () => {
    await controller.listInvoices(makeReq(), 'ACCEPTED');
    expect(invoiceService.listInvoices).toHaveBeenCalledWith('tenant-1', {
      status: 'ACCEPTED',
      invoiceTypeCode: undefined,
      sellerTin: undefined,
      buyerTin: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      limit: 20,
    });
  });

  it('getInvoiceStats delegates the tenant from context', async () => {
    await controller.getInvoiceStats(makeReq());
    expect(invoiceService.getInvoiceStats).toHaveBeenCalledWith('tenant-1');
  });

  it('checkBySourceReference throws BadRequestException when sourceReference is missing', async () => {
    await expect(
      controller.checkBySourceReference(makeReq(), ''),
    ).rejects.toThrow(BadRequestException);
    expect(invoiceService.checkBySourceReference).not.toHaveBeenCalled();
  });

  it('checkBySourceReference delegates a provided sourceReference', async () => {
    await controller.checkBySourceReference(makeReq(), 'src-ref-1');
    expect(invoiceService.checkBySourceReference).toHaveBeenCalledWith(
      'tenant-1',
      'src-ref-1',
    );
  });

  it('getInvoice returns XML and sets the content type when Accept requests XML', async () => {
    const res = makeRes();
    const result = await controller.getInvoice(
      'inv-1',
      makeReq(),
      res,
      'application/xml',
    );
    expect(invoiceService.exportAsXml).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/xml',
    );
    expect(result).toBe('<Invoice/>');
  });

  it('getInvoice returns JSON by default', async () => {
    const result = await controller.getInvoice('inv-1', makeReq(), makeRes());
    expect(invoiceService.getInvoice).toHaveBeenCalledWith('inv-1', 'tenant-1');
    expect(result).toEqual({ id: 'inv-1' });
  });

  it('getInvoiceXml delegates to exportAsXml', async () => {
    await controller.getInvoiceXml('inv-1', makeReq());
    expect(invoiceService.exportAsXml).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
    );
  });

  it('getInvoiceStatus delegates to the service', async () => {
    await controller.getInvoiceStatus('inv-1', makeReq());
    expect(invoiceService.getInvoiceStatus).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
    );
  });

  it('cancelInvoice delegates id, tenant, actor, and body', async () => {
    await controller.cancelInvoice(
      'inv-1',
      { reason: 'buyer request' },
      makeReq(),
    );
    expect(invoiceService.cancelInvoice).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
      'api-key:key-1',
      { reason: 'buyer request' },
    );
  });

  it('recordPayment maps the body fields and delegates to PaymentService', async () => {
    await controller.recordPayment(
      'inv-1',
      {
        amount: 500,
        reference: 'ref-1',
        provider: 'PAYSTACK',
        paidAt: '2026-01-01',
        notes: 'n',
        metadata: { x: 1 },
      },
      makeReq(),
    );
    expect(paymentService.recordPayment).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
      'api-key:key-1',
      {
        amount: 500,
        reference: 'ref-1',
        provider: 'PAYSTACK',
        paidAt: '2026-01-01',
        notes: 'n',
        metadata: { x: 1 },
      },
    );
  });

  it('listPayments delegates to PaymentService', async () => {
    await controller.listPayments('inv-1', makeReq());
    expect(paymentService.listPayments).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
    );
  });
});
