import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InvoiceService } from './services/invoice.service';

@ApiTags('Invoices')
@Controller('v1/invoices')
export class InvoicePublicController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get('pay/:invoiceId')
  @ApiOperation({ summary: 'Get public invoice data for the payment page' })
  @ApiResponse({
    status: 200,
    description: 'Get public invoice data for the payment page',
  })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async getPublicInvoice(@Param('invoiceId') id: string) {
    return this.invoiceService.getPublicInvoice(id);
  }
}
