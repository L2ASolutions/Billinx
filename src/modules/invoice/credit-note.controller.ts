import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtGuard } from '../identity/guards/jwt.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CreditNoteService } from './credit-note.service';

@ApiTags('Invoices')
@Controller('v1/invoices')
export class CreditNoteController {
  constructor(private readonly creditNoteService: CreditNoteService) {}

  private getCtx(req: Request): any {
    return (req as any)._billinxContext;
  }

  @Post(':id/credit-notes')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Issue a credit note against an accepted invoice (VAT Schedule B)',
  })
  @ApiResponse({
    status: 201,
    description:
      'Issue a credit note against an accepted invoice (VAT Schedule B)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description: 'Caller role is not permitted to perform this action',
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async createCreditNote(
    @Param('id') invoiceId: string,
    @Body()
    body: {
      adjustmentReason: string;
      adjustedAmount: number;
      transactionDate: string;
    },
    @Req() req: Request,
  ) {
    if (!body.adjustmentReason?.trim()) {
      throw new BadRequestException('adjustmentReason is required');
    }
    if (body.adjustedAmount == null || isNaN(Number(body.adjustedAmount))) {
      throw new BadRequestException('adjustedAmount must be a number');
    }
    if (!body.transactionDate) {
      throw new BadRequestException('transactionDate is required');
    }

    const ctx = this.getCtx(req);
    return this.creditNoteService.create(ctx.tenantId, ctx.actor, invoiceId, {
      adjustmentReason: body.adjustmentReason.trim(),
      adjustedAmount: Number(body.adjustedAmount),
      transactionDate: new Date(body.transactionDate),
    });
  }

  @Get('credit-notes')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List credit notes by date range for VAT return Schedule B',
  })
  @ApiQuery({ name: 'startDate', required: true, example: '2026-01-01' })
  @ApiQuery({ name: 'endDate', required: true, example: '2026-03-31' })
  @ApiResponse({
    status: 200,
    description: 'List credit notes by date range for VAT return Schedule B',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({
    status: 403,
    description: 'Caller role is not permitted to perform this action',
  })
  async listCreditNotes(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Req() req: Request,
  ) {
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }
    const ctx = this.getCtx(req);
    return this.creditNoteService.findByPeriod(
      ctx.tenantId,
      new Date(startDate),
      new Date(endDate),
    );
  }
}
