/// <reference types="jest" />

import { InvoicePublicController } from './invoice-public.controller';
import { InvoiceService } from './services/invoice.service';

describe('InvoicePublicController', () => {
  it('getPublicInvoice delegates the invoiceId to the service', async () => {
    const invoiceService = {
      getPublicInvoice: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    };
    const controller = new InvoicePublicController(
      invoiceService as unknown as InvoiceService,
    );

    const result = await controller.getPublicInvoice('inv-1');

    expect(invoiceService.getPublicInvoice).toHaveBeenCalledWith('inv-1');
    expect(result).toEqual({ id: 'inv-1' });
  });
});
