import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { ExportService } from '../export/export.service';
import { JwtGuard } from '../identity/guards/jwt.guard';

@ApiTags('Invoices')
@Controller('v1/invoices/export')
export class InvoiceExportController {
  constructor(private readonly exportService: ExportService) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Get('csv')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export invoices as CSV for compliance reporting' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async exportCSV(
    @Req() req: Request,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const ctx = this.getCtx(req);
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }
    const csv = await this.exportService.exportInvoicesCSV(
      ctx.tenantId,
      startDate,
      endDate,
    );
    return csv;
  }

  @Get('json')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export invoices as JSON in NRS canonical format' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async exportJSON(
    @Req() req: Request,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const ctx = this.getCtx(req);
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }
    return this.exportService.exportInvoicesJSON(
      ctx.tenantId,
      startDate,
      endDate,
    );
  }

  @Get('monthly')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get monthly invoice summary report' })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: true, type: Number })
  async exportMonthly(
    @Req() req: Request,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const ctx = this.getCtx(req);
    if (!year || !month) {
      throw new BadRequestException('year and month are required');
    }
    return this.exportService.exportMonthlyReport(
      ctx.tenantId,
      Number(year),
      Number(month),
    );
  }
}
