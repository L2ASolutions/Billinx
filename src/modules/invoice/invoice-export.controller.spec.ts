/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { InvoiceExportController } from './invoice-export.controller';
import { ExportService } from '../export/export.service';

function makeReq(): any {
  return { _billinxContext: { tenantId: 'tenant-1' } };
}

describe('InvoiceExportController', () => {
  let controller: InvoiceExportController;
  let exportService: jest.Mocked<
    Pick<
      ExportService,
      'exportInvoicesCSV' | 'exportInvoicesJSON' | 'exportMonthlyReport'
    >
  >;

  beforeEach(() => {
    exportService = {
      exportInvoicesCSV: jest.fn().mockResolvedValue('csv-data'),
      exportInvoicesJSON: jest.fn().mockResolvedValue([{ id: 'inv-1' }]),
      exportMonthlyReport: jest.fn().mockResolvedValue({ total: 0 }),
    };
    controller = new InvoiceExportController(
      exportService as unknown as ExportService,
    );
  });

  it('exportCSV throws BadRequestException when startDate or endDate is missing', async () => {
    await expect(
      controller.exportCSV(makeReq(), '', '2026-01-31'),
    ).rejects.toThrow(BadRequestException);
    expect(exportService.exportInvoicesCSV).not.toHaveBeenCalled();
  });

  it('exportCSV delegates to the service with the tenant from context', async () => {
    const result = await controller.exportCSV(
      makeReq(),
      '2026-01-01',
      '2026-01-31',
    );
    expect(exportService.exportInvoicesCSV).toHaveBeenCalledWith(
      'tenant-1',
      '2026-01-01',
      '2026-01-31',
    );
    expect(result).toBe('csv-data');
  });

  it('exportJSON throws BadRequestException when startDate or endDate is missing', async () => {
    await expect(
      controller.exportJSON(makeReq(), '2026-01-01', ''),
    ).rejects.toThrow(BadRequestException);
    expect(exportService.exportInvoicesJSON).not.toHaveBeenCalled();
  });

  it('exportJSON delegates to the service', async () => {
    const result = await controller.exportJSON(
      makeReq(),
      '2026-01-01',
      '2026-01-31',
    );
    expect(exportService.exportInvoicesJSON).toHaveBeenCalledWith(
      'tenant-1',
      '2026-01-01',
      '2026-01-31',
    );
    expect(result).toEqual([{ id: 'inv-1' }]);
  });

  it('exportMonthly throws BadRequestException when year or month is missing', async () => {
    await expect(controller.exportMonthly(makeReq(), '', '6')).rejects.toThrow(
      BadRequestException,
    );
    expect(exportService.exportMonthlyReport).not.toHaveBeenCalled();
  });

  it('exportMonthly delegates numeric year/month to the service', async () => {
    await controller.exportMonthly(makeReq(), '2026', '6');
    expect(exportService.exportMonthlyReport).toHaveBeenCalledWith(
      'tenant-1',
      2026,
      6,
    );
  });
});
