/// <reference types="jest" />

jest.mock('exceljs', () => {
  const sheet = { columns: undefined as any, addRow: jest.fn() };
  const workbook = {
    creator: '',
    created: undefined as any,
    addWorksheet: jest.fn().mockReturnValue(sheet),
    xlsx: { write: jest.fn().mockResolvedValue(undefined) },
  };
  return { Workbook: jest.fn().mockImplementation(() => workbook) };
});

import { InvoiceDashboardController } from './invoice-dashboard.controller';
import { PaymentService } from './services/payment.service';
import { InvoicePdfService } from './services/invoice-pdf.service';

function makeReq(ctx: Record<string, any> = {}): any {
  return {
    _billinxContext: {
      tenantId: 'tenant-1',
      environment: 'SANDBOX',
      actor: 'user:user-1',
      actorType: 'user',
      ...ctx,
    },
  };
}

function makeRes(): any {
  return {
    status: jest.fn(),
    setHeader: jest.fn(),
    end: jest.fn(),
    send: jest.fn(),
  };
}

describe('InvoiceDashboardController', () => {
  let controller: InvoiceDashboardController;
  let invoiceService: jest.Mocked<any>;
  let paymentService: jest.Mocked<
    Pick<PaymentService, 'recordPayment' | 'listPayments'>
  >;
  let invoicePdfService: jest.Mocked<Pick<InvoicePdfService, 'generatePdf'>>;

  beforeEach(() => {
    invoiceService = {
      saveDraftInvoice: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      updateDraftFields: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      createInvoice: jest
        .fn()
        .mockResolvedValue({ invoice: { id: 'inv-1' }, isDuplicate: false }),
      listInvoices: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getSampleInvoice: jest.fn().mockReturnValue({ id: 'sample' }),
      getDashboardStats: jest.fn().mockResolvedValue({ total: 0 }),
      getDashboardCharts: jest.fn().mockResolvedValue({ chart: [] }),
      getDashboardRejections: jest.fn().mockResolvedValue({ rejections: [] }),
      getPaymentStats: jest.fn().mockResolvedValue({ collected: 0 }),
      getPaymentCharts: jest.fn().mockResolvedValue({ chart: [] }),
      getInvoice: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      exportAsXml: jest.fn().mockResolvedValue('<Invoice/>'),
      getInvoiceStatus: jest.fn().mockResolvedValue({ status: 'ACCEPTED' }),
      cancelInvoice: jest
        .fn()
        .mockResolvedValue({ id: 'inv-1', status: 'CANCELLED' }),
      duplicateInvoice: jest.fn().mockResolvedValue({ id: 'inv-2' }),
      submitDraft: jest
        .fn()
        .mockResolvedValue({ id: 'inv-1', status: 'QUEUED' }),
      sendManualReminder: jest.fn().mockResolvedValue({ sent: true }),
      sendToBuyer: jest.fn().mockResolvedValue({ sent: true }),
    };
    paymentService = {
      recordPayment: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      listPayments: jest.fn().mockResolvedValue([]),
    };
    invoicePdfService = {
      generatePdf: jest.fn().mockResolvedValue({
        buffer: Buffer.from('%PDF-fake'),
        filename: 'invoice-inv-1.pdf',
      }),
    };
    controller = new InvoiceDashboardController(
      invoiceService,
      paymentService as unknown as PaymentService,
      invoicePdfService as unknown as InvoicePdfService,
    );
  });

  it('saveDraftDashboard delegates tenant/environment/actor and body', async () => {
    await controller.saveDraftDashboard({ seller: {} }, makeReq());
    expect(invoiceService.saveDraftInvoice).toHaveBeenCalledWith(
      'tenant-1',
      'SANDBOX',
      'user:user-1',
      { seller: {} },
    );
  });

  it('updateDraftDashboard delegates id/tenant/actor and body', async () => {
    await controller.updateDraftDashboard('inv-1', { note: 'x' }, makeReq());
    expect(invoiceService.updateDraftFields).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
      'user:user-1',
      { note: 'x' },
    );
  });

  it('createInvoiceDashboard returns 201 when not a duplicate', async () => {
    const res = makeRes();
    const result = await controller.createInvoiceDashboard({}, makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(result).toEqual({ id: 'inv-1' });
  });

  it('createInvoiceDashboard sets X-Duplicate header and 200 status on a duplicate result', async () => {
    invoiceService.createInvoice.mockResolvedValue({
      invoice: { id: 'inv-1' },
      isDuplicate: true,
      message: 'Invoice already processing',
    });
    const res = makeRes();
    await controller.createInvoiceDashboard({}, makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('X-Duplicate', 'true');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Duplicate-Message',
      'Invoice already processing',
    );
  });

  it('listInvoicesDashboard maps the filter DTO and defaults page/limit', async () => {
    await controller.listInvoicesDashboard(makeReq(), {
      status: 'ACCEPTED',
      search: 'acme',
    });
    expect(invoiceService.listInvoices).toHaveBeenCalledWith('tenant-1', {
      status: 'ACCEPTED',
      search: 'acme',
      paymentStatus: undefined,
      isOverdue: undefined,
      forPayments: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      limit: 20,
    });
  });

  it('getSampleInvoice delegates to the service synchronously', () => {
    const result = controller.getSampleInvoice();
    expect(invoiceService.getSampleInvoice).toHaveBeenCalled();
    expect(result).toEqual({ id: 'sample' });
  });

  it('getDashboardStats strips the user: prefix from actor when actorType is user', async () => {
    await controller.getDashboardStats(makeReq());
    expect(invoiceService.getDashboardStats).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
    );
  });

  it('getDashboardStats passes undefined userId when actorType is not user', async () => {
    await controller.getDashboardStats(
      makeReq({ actor: 'api-key:key-1', actorType: 'apiKey' }),
    );
    expect(invoiceService.getDashboardStats).toHaveBeenCalledWith(
      'tenant-1',
      undefined,
    );
  });

  it('getDashboardCharts delegates to the service', async () => {
    await controller.getDashboardCharts(makeReq());
    expect(invoiceService.getDashboardCharts).toHaveBeenCalledWith('tenant-1');
  });

  it('getDashboardRejections delegates to the service', async () => {
    await controller.getDashboardRejections(makeReq());
    expect(invoiceService.getDashboardRejections).toHaveBeenCalledWith(
      'tenant-1',
    );
  });

  it('getPaymentStats delegates to the service', async () => {
    await controller.getPaymentStats(makeReq());
    expect(invoiceService.getPaymentStats).toHaveBeenCalledWith('tenant-1');
  });

  it('getPaymentCharts delegates to the service', async () => {
    await controller.getPaymentCharts(makeReq());
    expect(invoiceService.getPaymentCharts).toHaveBeenCalledWith('tenant-1');
  });

  it('exportInvoicesDashboard lists invoices, writes the workbook, and sets Excel headers', async () => {
    invoiceService.listInvoices.mockResolvedValue({
      data: [
        {
          firsConfirmedIrn: 'FIRS-1',
          platformIrn: 'IRN-1',
          buyerName: 'Acme',
          issueDate: '2026-01-01',
          dueDate: '2026-01-31',
          subtotal: 100,
          vatAmount: 7.5,
          totalAmount: 107.5,
          currency: 'NGN',
          status: 'ACCEPTED',
          paymentStatus: 'PAID',
        },
      ],
      total: 1,
    });
    const res = makeRes();
    await controller.exportInvoicesDashboard(makeReq(), res, 'ACCEPTED');
    expect(invoiceService.listInvoices).toHaveBeenCalledWith('tenant-1', {
      status: 'ACCEPTED',
      search: undefined,
      from: undefined,
      to: undefined,
      page: 1,
      limit: 1000,
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('getDashboardInvoice delegates to the service', async () => {
    await controller.getDashboardInvoice('inv-1', makeReq());
    expect(invoiceService.getInvoice).toHaveBeenCalledWith('inv-1', 'tenant-1');
  });

  it('getDashboardInvoiceXml delegates to exportAsXml', async () => {
    await controller.getDashboardInvoiceXml('inv-1', makeReq());
    expect(invoiceService.exportAsXml).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
    );
  });

  it('getDashboardInvoicePdf delegates to InvoicePdfService and streams the buffer', async () => {
    const res = makeRes();
    await controller.getDashboardInvoicePdf('inv-1', makeReq(), res);

    expect(invoicePdfService.generatePdf).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="invoice-inv-1.pdf"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-fake'));
  });

  it('getDashboardInvoiceStatus delegates to the service', async () => {
    await controller.getDashboardInvoiceStatus('inv-1', makeReq());
    expect(invoiceService.getInvoiceStatus).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
    );
  });

  it('cancelInvoiceDashboard delegates id/tenant/actor/body', async () => {
    await controller.cancelInvoiceDashboard(
      'inv-1',
      { reason: 'x' },
      makeReq(),
    );
    expect(invoiceService.cancelInvoice).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
      'user:user-1',
      { reason: 'x' },
    );
  });

  it('recordPaymentDashboard maps body fields and delegates to PaymentService', async () => {
    await controller.recordPaymentDashboard(
      'inv-1',
      {
        amount: 500,
        reference: 'ref-1',
        provider: 'PAYSTACK',
        paidAt: '2026-01-01',
        notes: 'n',
        metadata: {},
      },
      makeReq(),
    );
    expect(paymentService.recordPayment).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
      'user:user-1',
      {
        amount: 500,
        reference: 'ref-1',
        provider: 'PAYSTACK',
        paidAt: '2026-01-01',
        notes: 'n',
        metadata: {},
      },
    );
  });

  it('listPaymentsDashboard delegates to PaymentService', async () => {
    await controller.listPaymentsDashboard('inv-1', makeReq());
    expect(paymentService.listPayments).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
    );
  });

  it('duplicateInvoiceDashboard delegates tenant/id/actor/environment', async () => {
    await controller.duplicateInvoiceDashboard('inv-1', makeReq());
    expect(invoiceService.duplicateInvoice).toHaveBeenCalledWith(
      'tenant-1',
      'inv-1',
      'user:user-1',
      'SANDBOX',
    );
  });

  it('submitDraftDashboard delegates id/tenant/actor/body', async () => {
    await controller.submitDraftDashboard('inv-1', { seller: {} }, makeReq());
    expect(invoiceService.submitDraft).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
      'user:user-1',
      { seller: {} },
    );
  });

  it('sendReminderDashboard delegates id/tenant/actor', async () => {
    await controller.sendReminderDashboard('inv-1', makeReq());
    expect(invoiceService.sendManualReminder).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
      'user:user-1',
    );
  });

  it('sendToBuyerDashboard delegates id/tenant', async () => {
    await controller.sendToBuyerDashboard('inv-1', makeReq());
    expect(invoiceService.sendToBuyer).toHaveBeenCalledWith(
      'inv-1',
      'tenant-1',
    );
  });
});
