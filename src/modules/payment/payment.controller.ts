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
  Req,
  RawBodyRequest,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PaymentProviderService } from './payment.service';
import { PaymentRateLimitGuard } from '../../shared/guards/payment-rate-limit.guard';

@ApiTags('Payments')
@Controller('v1/payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentProviderService) {}

  // ── Paystack ──────────────────────────────────────────────────────────────

  @Post('paystack/initialize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PaymentRateLimitGuard)
  @ApiOperation({ summary: 'Initialize a Paystack payment for an invoice' })
  @ApiResponse({
    status: 200,
    description: 'Initialize a Paystack payment for an invoice',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async paystackInitialize(@Body() body: Record<string, any>) {
    return this.paymentService.paystackInitialize(body.invoiceId, body.email);
  }

  @Get('paystack/verify/:reference')
  @UseGuards(PaymentRateLimitGuard)
  @ApiOperation({ summary: 'Verify a Paystack payment by reference' })
  @ApiResponse({
    status: 200,
    description: 'Verify a Paystack payment by reference',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Resource not found' })
  async paystackVerify(@Param('reference') reference: string) {
    return this.paymentService.paystackVerify(reference);
  }

  @Post('paystack/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paystack webhook receiver' })
  @ApiResponse({ status: 200, description: 'Paystack webhook receiver' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async paystackWebhook(
    @Headers('x-paystack-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const paystackSecret = process.env.PAYSTACK_SECRET_KEY ?? '';
    if (paystackSecret && paystackSecret !== 'sk_test_placeholder') {
      const hash = crypto
        .createHmac('sha512', paystackSecret)
        .update(req.rawBody ?? Buffer.alloc(0))
        .digest('hex');
      if (hash !== signature) {
        throw new UnauthorizedException('Invalid Paystack signature');
      }
    }
    const event = req.rawBody ? JSON.parse(req.rawBody.toString()) : req.body;
    return this.paymentService.paystackWebhookEvent(event);
  }

  // ── Flutterwave ───────────────────────────────────────────────────────────

  @Post('flutterwave/initialize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PaymentRateLimitGuard)
  @ApiOperation({ summary: 'Initialize a Flutterwave payment for an invoice' })
  @ApiResponse({
    status: 200,
    description: 'Initialize a Flutterwave payment for an invoice',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async flutterwaveInitialize(@Body() body: Record<string, any>) {
    return this.paymentService.flutterwaveInitialize(
      body.invoiceId,
      body.email,
    );
  }

  @Post('flutterwave/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flutterwave webhook receiver' })
  @ApiResponse({ status: 200, description: 'Flutterwave webhook receiver' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  async flutterwaveWebhook(
    @Headers('verif-hash') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const secretHash = process.env.FLW_WEBHOOK_HASH ?? '';
    if (secretHash && signature !== secretHash) {
      throw new UnauthorizedException('Invalid Flutterwave signature');
    }
    const event = req.rawBody ? JSON.parse(req.rawBody.toString()) : req.body;
    return this.paymentService.flutterwaveWebhookEvent(event);
  }
}
