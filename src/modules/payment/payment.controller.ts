import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PaymentProviderService } from './payment.service';

@ApiTags('Payments')
@Controller('v1/payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentProviderService) {}

  // ── Paystack ──────────────────────────────────────────────────────────────

  @Post('paystack/initialize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initialize a Paystack payment for an invoice' })
  async paystackInitialize(@Body() body: Record<string, any>) {
    return this.paymentService.paystackInitialize(
      body.invoiceId,
      body.email,
    );
  }

  @Get('paystack/verify/:reference')
  @ApiOperation({ summary: 'Verify a Paystack payment by reference' })
  async paystackVerify(@Param('reference') reference: string) {
    return this.paymentService.paystackVerify(reference);
  }

  @Post('paystack/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paystack webhook receiver' })
  async paystackWebhook(
    @Body() body: Record<string, any>,
    @Headers('x-paystack-signature') signature: string,
  ) {
    return this.paymentService.paystackWebhook(body, signature ?? '');
  }

  // ── Flutterwave ───────────────────────────────────────────────────────────

  @Post('flutterwave/initialize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initialize a Flutterwave payment for an invoice' })
  async flutterwaveInitialize(@Body() body: Record<string, any>) {
    return this.paymentService.flutterwaveInitialize(
      body.invoiceId,
      body.email,
    );
  }

  @Post('flutterwave/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flutterwave webhook receiver' })
  async flutterwaveWebhook(
    @Body() body: Record<string, any>,
    @Headers('verif-hash') signature: string,
  ) {
    return this.paymentService.flutterwaveWebhook(body, signature ?? '');
  }
}
