import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { VatService } from './vat.service';
import { VatEntryFilterDto } from './dto/vat-entry.dto';
import { JwtGuard } from '../identity/guards/jwt.guard';

@ApiTags('VAT Reconciliation')
@Controller('v1/vat')
@UseGuards(JwtGuard)
@ApiBearerAuth()
export class VatController {
  constructor(private readonly vatService: VatService) {}

  private tenantId(req: Request): string {
    return (req as any)._billinxContext.tenantId;
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get VAT summary for a period' })
  @ApiQuery({ name: 'period', required: false, description: 'YYYY-MM' })
  async summary(@Req() req: Request, @Query('period') period?: string) {
    const p = period ?? this.currentPeriod();
    return this.vatService.getSummary(this.tenantId(req), p);
  }

  @Get('summary/annual')
  @ApiOperation({ summary: 'Get VAT summary for all months of a year' })
  @ApiQuery({ name: 'year', required: false, type: Number })
  async annualSummary(@Req() req: Request, @Query('year') year?: string) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.vatService.getAnnualSummary(this.tenantId(req), y);
  }

  @Get('entries')
  @ApiOperation({ summary: 'List VAT entries with filters' })
  async entries(@Req() req: Request, @Query() query: VatEntryFilterDto) {
    return this.vatService.getEntries(this.tenantId(req), {
      type: query.type,
      period: query.period,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Patch('entries/:id/reconcile')
  @ApiOperation({ summary: 'Mark a VAT entry as reconciled' })
  async reconcile(@Param('id') id: string, @Req() req: Request) {
    return this.vatService.reconcileEntry(id, this.tenantId(req));
  }

  @Get('mismatches')
  @ApiOperation({ summary: 'Get VAT mismatch report' })
  @ApiQuery({ name: 'period', required: false, description: 'YYYY-MM' })
  async mismatches(@Req() req: Request, @Query('period') period?: string) {
    return this.vatService.getMismatchReport(this.tenantId(req), period);
  }

  private currentPeriod(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}
