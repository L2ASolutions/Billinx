import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InvoiceService } from './services/invoice.service';

@ApiTags('Invoices')
@Controller('v1/invoices')
export class InvoicePublicController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get('pay/:invoiceId')
  @ApiOperation({ summary: 'Get public invoice data for the payment page' })
  async getPublicInvoice(@Param('invoiceId') id: string) {
    return this.invoiceService.getPublicInvoice(id);
  }
}
