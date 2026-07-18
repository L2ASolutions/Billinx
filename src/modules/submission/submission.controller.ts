import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';

@ApiTags('VAT & Compliance')
@Controller('v1/submissions')
export class SubmissionController {
  constructor(private readonly prisma: PrismaService) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Get('export')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER')
  @ApiBearerAuth()
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiOperation({
    summary: 'Export submission attempts as Excel (dashboard / JWT auth)',
  })
  @ApiResponse({
    status: 200,
    description: 'Export submission attempts as Excel (dashboard / JWT auth)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description: 'Caller role is not permitted to perform this action',
  })
  async exportSubmissions(
    @Req() req: Request,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const ctx = this.getCtx(req);
    const { tenantId } = ctx;

    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);

    const attempts = await this.prisma.submissionAttempt.findMany({
      where: {
        tenantId,
        createdAt: { gte: start, lte: end },
      },
      include: {
        invoice: {
          select: { platformIrn: true, firsConfirmedIrn: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Billinx';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Submissions');
    sheet.columns = [
      { header: 'Invoice #', key: 'invoiceIrn', width: 32 },
      { header: 'Submission Date', key: 'submittedAt', width: 22 },
      { header: 'Attempt #', key: 'attempt', width: 10 },
      { header: 'Adapter', key: 'adapter', width: 14 },
      { header: 'Success', key: 'success', width: 10 },
      { header: 'Response Code', key: 'responseCode', width: 16 },
      { header: 'IRN', key: 'irn', width: 32 },
      { header: 'Error Code', key: 'errorCode', width: 16 },
      { header: 'Error Message', key: 'errorMessage', width: 40 },
      { header: 'Duration (ms)', key: 'durationMs', width: 14 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    };

    const fmtDate = (d: Date | null | undefined) => {
      if (!d) return '';
      const pad = (n: number) => String(n).padStart(2, '0');
      return (
        `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      );
    };

    for (const a of attempts) {
      const succeeded = a.succeededAt != null;
      const failed = a.failedAt != null;
      sheet.addRow({
        invoiceIrn: (a.invoice as any)?.platformIrn ?? '',
        submittedAt: fmtDate(a.createdAt),
        attempt: a.attemptNumber,
        adapter: a.adapterKey,
        success: succeeded ? 'Yes' : 'No',
        responseCode: a.responseCode ?? '',
        irn: succeeded ? ((a.invoice as any)?.firsConfirmedIrn ?? '') : '',
        errorCode: failed ? (a.errorCode ?? '') : '',
        errorMessage: failed ? (a.errorMessage ?? '') : '',
        durationMs: a.durationMs ?? '',
      });
    }

    const today = new Date().toISOString().split('T')[0];
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Billinx_Submissions_${today}.xlsx"`,
    );
    await workbook.xlsx.write(res);
    res.end();
  }
}
