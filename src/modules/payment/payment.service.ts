import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as https from 'https';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PaymentService as InvoicePaymentService } from '../invoice/services/payment.service';
import { EmailService } from '../../shared/email/email.service';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? '';
const FLW_SECRET = process.env.FLW_SECRET_KEY ?? '';
const BILLINX_URL = process.env.BILLINX_URL ?? 'http://localhost:3001';

const HTTPS_REQUEST_TIMEOUT_MS = 20_000;
const HTTPS_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function httpsRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: HTTPS_REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        let receivedBytes = 0;
        let aborted = false;
        res.on('data', (chunk: Buffer) => {
          if (aborted) return;
          receivedBytes += chunk.length;
          if (receivedBytes > HTTPS_MAX_RESPONSE_BYTES) {
            aborted = true;
            res.destroy();
            reject(
              new Error(
                `Response from ${parsed.hostname} exceeded maximum allowed size of ${HTTPS_MAX_RESPONSE_BYTES} bytes`,
              ),
            );
            return;
          }
          data += chunk.toString();
        });
        res.on('end', () => {
          if (aborted) return;
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(
        new Error(
          `Request to ${parsed.hostname} timed out after ${HTTPS_REQUEST_TIMEOUT_MS}ms`,
        ),
      );
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

@Injectable()
export class PaymentProviderService {
  private readonly logger = new Logger(PaymentProviderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicePaymentService: InvoicePaymentService,
    private readonly emailService: EmailService,
  ) {}

  // ── Paystack ──────────────────────────────────────────────────────────────

  async paystackInitialize(invoiceId: string, email: string) {
    const invoice = await this.getAcceptedInvoice(invoiceId);
    const amountOutstanding =
      Number(invoice.totalAmount) - Number(invoice.amountPaid ?? 0);

    if (amountOutstanding <= 0) {
      throw new BadRequestException('Invoice is already fully paid');
    }

    if (!PAYSTACK_SECRET || PAYSTACK_SECRET === 'sk_test_placeholder') {
      throw new BadRequestException(
        'Paystack is not configured. Set PAYSTACK_SECRET_KEY.',
      );
    }

    const reference = `BLX-${invoiceId}-${Date.now()}`;
    const body = {
      email,
      amount: Math.round(amountOutstanding * 100),
      reference,
      callback_url: `${BILLINX_URL}/pay/${invoiceId}/callback`,
      metadata: {
        invoiceId,
        invoiceNumber: invoice.platformIrn,
        custom_fields: [
          {
            display_name: 'Invoice',
            variable_name: 'invoice_number',
            value: invoice.platformIrn,
          },
        ],
      },
    };

    const result: any = await httpsRequest(
      'https://api.paystack.co/transaction/initialize',
      'POST',
      { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      body,
    );

    if (!result?.status) {
      throw new BadRequestException(
        result?.message ?? 'Paystack initialization failed',
      );
    }

    return {
      authorizationUrl: result.data.authorization_url,
      reference: result.data.reference,
    };
  }

  async paystackVerify(reference: string) {
    if (!PAYSTACK_SECRET || PAYSTACK_SECRET === 'sk_test_placeholder') {
      return { status: 'unknown', message: 'Paystack not configured' };
    }

    const result: any = await httpsRequest(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      'GET',
      { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    );

    return {
      status: result?.data?.status ?? 'unknown',
      amount: result?.data?.amount
        ? Number(result.data.amount) / 100
        : undefined,
      reference: result?.data?.reference,
      paidAt: result?.data?.paid_at,
      customerEmail: result?.data?.customer?.email,
      metadata: result?.data?.metadata,
    };
  }

  async paystackWebhookEvent(body: Record<string, any>) {
    if (body.event !== 'charge.success') {
      return { received: true };
    }

    const data = body.data ?? {};
    const invoiceId =
      data.metadata?.invoiceId ?? this.extractInvoiceId(data.reference);

    if (!invoiceId) {
      this.logger.warn(
        `Paystack webhook: could not extract invoiceId from ${data.reference}`,
      );
      return { received: true };
    }

    await this.recordWebhookPayment(invoiceId, {
      amount: Number(data.amount ?? 0) / 100,
      reference: data.reference,
      provider: 'PAYSTACK',
      notes: 'Paid via Paystack',
    });

    return { received: true };
  }

  // ── Flutterwave ───────────────────────────────────────────────────────────

  async flutterwaveInitialize(invoiceId: string, email: string) {
    const invoice = await this.getAcceptedInvoice(invoiceId);
    const amountOutstanding =
      Number(invoice.totalAmount) - Number(invoice.amountPaid ?? 0);

    if (amountOutstanding <= 0) {
      throw new BadRequestException('Invoice is already fully paid');
    }

    if (!FLW_SECRET || FLW_SECRET === 'FLWSECK_TEST_placeholder') {
      throw new BadRequestException(
        'Flutterwave is not configured. Set FLW_SECRET_KEY.',
      );
    }

    const txRef = `BLX-FLW-${invoiceId}-${Date.now()}`;
    const body = {
      tx_ref: txRef,
      amount: amountOutstanding,
      currency: invoice.currency ?? 'NGN',
      redirect_url: `${BILLINX_URL}/pay/${invoiceId}/callback`,
      customer: {
        email,
        name: invoice.buyerName,
      },
      customizations: {
        title: 'Invoice Payment',
        description: `Invoice ${invoice.platformIrn}`,
        logo: `${BILLINX_URL}/logo.png`,
      },
      meta: {
        invoiceId,
        invoiceNumber: invoice.platformIrn,
      },
    };

    const result: any = await httpsRequest(
      'https://api.flutterwave.com/v3/payments',
      'POST',
      { Authorization: `Bearer ${FLW_SECRET}` },
      body,
    );

    if (result?.status !== 'success') {
      throw new BadRequestException(
        result?.message ?? 'Flutterwave initialization failed',
      );
    }

    return { paymentLink: result.data.link };
  }

  async flutterwaveWebhookEvent(body: Record<string, any>) {
    if (body.event !== 'charge.completed') {
      return { received: true };
    }

    const data = body.data ?? {};
    if (data.status !== 'successful') {
      return { received: true };
    }

    const invoiceId =
      data.meta?.invoiceId ?? this.extractInvoiceId(data.tx_ref, 'FLW-');

    if (!invoiceId) {
      this.logger.warn(
        `Flutterwave webhook: could not extract invoiceId from ${data.tx_ref}`,
      );
      return { received: true };
    }

    await this.recordWebhookPayment(invoiceId, {
      amount: Number(data.amount ?? 0),
      reference: data.tx_ref,
      provider: 'FLUTTERWAVE',
      notes: 'Paid via Flutterwave',
    });

    return { received: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getAcceptedInvoice(invoiceId: string) {
    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          tenantId: true,
          platformIrn: true,
          status: true,
          currency: true,
          totalAmount: true,
          amountPaid: true,
          buyerName: true,
        },
      }),
    );

    if (!invoice) throw new NotFoundException('Invoice not found');

    if (invoice.status !== 'ACCEPTED') {
      throw new BadRequestException(
        'Payments can only be initiated for ACCEPTED invoices',
      );
    }

    return invoice;
  }

  private extractInvoiceId(ref: string | undefined, prefix = ''): string | null {
    if (!ref) return null;
    // Reference format: BLX-{prefix}{invoiceId}-{timestamp}
    // e.g. BLX-abc123-1234567890 or BLX-FLW-abc123-1234567890
    const pattern = new RegExp(`^BLX-${prefix}([^-]+-[^-]+-[^-]+-[^-]+-[^-]+)-\\d+$`);
    const m = ref.match(pattern);
    return m ? m[1] : null;
  }

  private async recordWebhookPayment(
    invoiceId: string,
    opts: {
      amount: number;
      reference: string;
      provider: string;
      notes: string;
    },
  ) {
    if (opts.amount <= 0) {
      this.logger.warn(
        `Webhook payment skipped — amount=${opts.amount} for invoice ${invoiceId}`,
      );
      return;
    }

    const existing = await this.prisma.asAdmin((tx) =>
      tx.paymentRecord.findFirst({
        where: { paymentReference: opts.reference },
        select: { id: true },
      }),
    );

    if (existing) {
      this.logger.log(
        `Webhook payment ${opts.reference} already recorded — skipping duplicate`,
      );
      return;
    }

    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          tenantId: true,
          platformIrn: true,
          firsConfirmedIrn: true,
          sellerName: true,
          buyerName: true,
          currency: true,
          paymentLink: true,
          metadata: true,
        },
      }),
    );

    if (!invoice) {
      this.logger.warn(`Webhook payment: invoice ${invoiceId} not found`);
      return;
    }

    try {
      await this.invoicePaymentService.recordPayment(
        invoiceId,
        invoice.tenantId,
        'webhook',
        {
          amount: opts.amount,
          reference: opts.reference,
          provider: opts.provider,
          paidAt: new Date().toISOString(),
          notes: opts.notes,
        },
      );
      this.logger.log(
        `Webhook payment recorded: ${opts.reference} (${opts.amount}) for invoice ${invoiceId}`,
      );

      const buyerEmail = (invoice.metadata as any)?.buyerParty?.email;
      if (buyerEmail) {
        this.emailService.sendBuyerPaymentReceipt({
          to: buyerEmail,
          buyerName: invoice.buyerName,
          sellerName: invoice.sellerName,
          invoiceNumber: invoice.platformIrn,
          irn: invoice.firsConfirmedIrn ?? invoice.platformIrn,
          amount: opts.amount,
          currency: invoice.currency,
          paidAt: new Date(),
          reference: opts.reference,
          provider: opts.provider,
          paymentLink: invoice.paymentLink ?? undefined,
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Webhook payment failed for invoice ${invoiceId}: ${err.message}`,
      );
    }
  }
}
