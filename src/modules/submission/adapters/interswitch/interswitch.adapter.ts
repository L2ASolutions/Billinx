import { Injectable, Logger } from '@nestjs/common';
import { AppAdapter } from '../app-adapter.interface';
import {
  SubmissionRequest,
  SubmissionResult,
} from '../../../../../packages/types/submission';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { CredentialService } from '../../../tenant/services/credential.service';
import { SecretsService } from '../../../../infrastructure/secrets/secrets.service';

const INVOICE_TYPE_CODES: Record<string, string> = {
  STANDARD: '381',
  CREDIT_NOTE: '380',
  DEBIT_NOTE: '384',
  PROFORMA: '325',
};

const PAYMENT_MEANS_CODES: Record<string, string> = {
  BANK_TRANSFER: '30',
  PAYSTACK: '48',
  FLUTTERWAVE: '48',
  MANUAL: '10',
  CASH: '10',
  CHEQUE: '20',
  CARD: '48',
  DIRECT_DEBIT: '49',
};

interface NrsSuccessResponse {
  code: number;
  message: string;
  data: {
    IRN: string;
    PostingDateTime: string;
    QRCodeData: string;
  };
}

interface NrsErrorResponse {
  code?: number | string;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
  details?: string;
}

@Injectable()
export class InterswitchAdapter implements AppAdapter {
  readonly adapterKey = 'interswitch';
  readonly adapterName = 'Interswitch NRS E-Invoicing Adapter';

  private readonly logger = new Logger(InterswitchAdapter.name);

  private readonly sandboxBaseUrl =
    process.env.INTERSWITCH_SANDBOX_URL ?? 'https://qa.interswitchgroup.com';
  private readonly productionBaseUrl =
    process.env.INTERSWITCH_PROD_URL ?? 'https://api.interswitchgroup.com';

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: CredentialService,
    private readonly secretsService: SecretsService,
  ) {}

  async submit(request: SubmissionRequest): Promise<SubmissionResult> {
    const tenant = await this.loadTenant(request.tenantId);

    if (
      !tenant.nrsApiKey ||
      !tenant.nrsApiKeyIv ||
      !tenant.nrsApiSecret ||
      !tenant.nrsApiSecretIv
    ) {
      return {
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        errorMessage: 'NRS API credentials not configured for this tenant',
        retryable: false,
      };
    }

    const masterKey = await this.secretsService.getMasterEncryptionKey();
    const apiKey = this.credentialService.decrypt(
      Buffer.from(tenant.nrsApiKey),
      Buffer.from(tenant.nrsApiKeyIv),
      masterKey,
      request.tenantId,
    );
    const apiSecret = this.credentialService.decrypt(
      Buffer.from(tenant.nrsApiSecret),
      Buffer.from(tenant.nrsApiSecretIv),
      masterKey,
      request.tenantId,
    );

    const baseUrl =
      tenant.environment === 'PRODUCTION'
        ? this.productionBaseUrl
        : this.sandboxBaseUrl;
    const invoice = (request.payload as any).invoice;
    const payload = this.buildPayload(invoice, tenant);
    const startMs = Date.now();

    try {
      const result = await this.postInvoice(
        baseUrl,
        apiKey,
        apiSecret,
        payload,
      );
      this.logger.log(
        `Invoice ${request.platformIrn} accepted by NRS. IRN: ${result.data.IRN}`,
      );
      return {
        success: true,
        firsConfirmedIrn: result.data.IRN,
        qrCodeBase64: result.data.QRCodeData,
        rawResponse: {
          irn: result.data.IRN,
          postingDateTime: result.data.PostingDateTime,
          qrCodeData: result.data.QRCodeData,
          durationMs: Date.now() - startMs,
        },
      };
    } catch (err: any) {
      return this.mapError(err);
    }
  }

  async checkStatus(
    platformIrn: string,
    tenantCredential: Record<string, unknown>,
  ): Promise<SubmissionResult> {
    const tenantId = tenantCredential.tenantId as string | undefined;
    if (!tenantId) {
      return {
        success: false,
        errorCode: 'MISSING_TENANT_ID',
        errorMessage: 'tenantId required for status check',
        retryable: false,
      };
    }

    const tenant = await this.loadTenant(tenantId);
    if (
      !tenant.nrsApiKey ||
      !tenant.nrsApiKeyIv ||
      !tenant.nrsApiSecret ||
      !tenant.nrsApiSecretIv
    ) {
      return {
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        errorMessage: 'NRS credentials not configured for this tenant',
        retryable: false,
      };
    }

    const masterKey = await this.secretsService.getMasterEncryptionKey();
    const apiKey = this.credentialService.decrypt(
      Buffer.from(tenant.nrsApiKey),
      Buffer.from(tenant.nrsApiKeyIv),
      masterKey,
      tenantId,
    );
    const apiSecret = this.credentialService.decrypt(
      Buffer.from(tenant.nrsApiSecret),
      Buffer.from(tenant.nrsApiSecretIv),
      masterKey,
      tenantId,
    );

    const baseUrl =
      tenant.environment === 'PRODUCTION'
        ? this.productionBaseUrl
        : this.sandboxBaseUrl;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(
        `${baseUrl}/Api/SwitchTax/transmit/${encodeURIComponent(platformIrn)}`,
        {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'x-api-secret': apiSecret,
          },
          signal: controller.signal,
        },
      );

      const body = await response.text();
      let parsed: any = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        /* raw text */
      }

      if (
        (response.status === 200 || response.status === 201) &&
        parsed.data?.IRN
      ) {
        return {
          success: true,
          firsConfirmedIrn: parsed.data.IRN,
          qrCodeBase64: parsed.data.QRCodeData ?? undefined,
          rawResponse: parsed.data,
        };
      }

      return {
        success: false,
        errorCode: 'STATUS_CHECK_FAILED',
        errorMessage: `FIRS status check returned ${response.status}`,
        retryable: response.status >= 500,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return {
          success: false,
          errorCode: 'TIMEOUT',
          errorMessage: 'Status check timed out',
          retryable: true,
        };
      }
      return {
        success: false,
        errorCode: 'STATUS_CHECK_ERROR',
        errorMessage: err.message,
        retryable: false,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async updatePaymentStatus(
    irn: string,
    tenantId: string,
    status: string,
  ): Promise<void> {
    const tenant = await this.loadTenant(tenantId);
    if (
      !tenant.nrsApiKey ||
      !tenant.nrsApiKeyIv ||
      !tenant.nrsApiSecret ||
      !tenant.nrsApiSecretIv
    ) {
      this.logger.warn(
        `Cannot update payment status for IRN ${irn}: NRS credentials not configured`,
      );
      return;
    }

    const masterKey = await this.secretsService.getMasterEncryptionKey();
    const apiKey = this.credentialService.decrypt(
      Buffer.from(tenant.nrsApiKey),
      Buffer.from(tenant.nrsApiKeyIv),
      masterKey,
      tenantId,
    );
    const apiSecret = this.credentialService.decrypt(
      Buffer.from(tenant.nrsApiSecret),
      Buffer.from(tenant.nrsApiSecretIv),
      masterKey,
      tenantId,
    );

    const baseUrl =
      tenant.environment === 'PRODUCTION'
        ? this.productionBaseUrl
        : this.sandboxBaseUrl;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(`${baseUrl}/Api/SwitchTax/UpdateStatus`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-api-secret': apiSecret,
        },
        body: JSON.stringify({ irn, payment_status: status }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.warn(
          `UpdateStatus for IRN ${irn} returned ${response.status}: ${body.slice(0, 200)}`,
        );
      } else {
        this.logger.log(
          `Payment status updated on NRS for IRN ${irn}: ${status}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `UpdateStatus call failed for IRN ${irn}: ${err.message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async ping(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(
        `${this.sandboxBaseUrl}/Api/SwitchTax/postInvoice`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: controller.signal,
        },
      );
      return resp.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Invoice submission ───────────────────────────────────────────────────

  private async postInvoice(
    baseUrl: string,
    apiKey: string,
    apiSecret: string,
    payload: Record<string, unknown>,
  ): Promise<NrsSuccessResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/Api/SwitchTax/postInvoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-api-secret': apiSecret,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const body = await response.text();

    if (response.status === 201 || response.status === 200) {
      return JSON.parse(body) as NrsSuccessResponse;
    }

    let parsed: NrsErrorResponse = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* raw body */
    }

    throw Object.assign(new Error(this.extractErrorMessage(parsed, body)), {
      statusCode: response.status,
      body: parsed,
    });
  }

  // ─── Payload builder ──────────────────────────────────────────────────────

  private buildPayload(invoice: any, tenant: any): Record<string, unknown> {
    const serviceId = tenant.interswitchServiceId ?? 'BILLINX';
    const invoiceNo =
      invoice.sourceReference ?? invoice.id.substring(0, 8).toUpperCase();
    const dateStr = this.toYYYYMMDD(invoice.issueDate);
    const unixTimestamp = Math.floor(Date.now() / 1000);
    const irn = `${invoiceNo}-${serviceId}-${dateStr}.${unixTimestamp}`;

    const sellerParty = invoice.metadata?.sellerParty ?? {};
    const tenantAddress = tenant.registeredAddress ?? {};

    const payload: Record<string, unknown> = {
      business_id: tenant.interswitchBusinessId,
      irn,
      invoice_kind: invoice.invoiceKind ?? 'B2B',
      issue_date: this.toISODate(invoice.issueDate),
      due_date: invoice.dueDate
        ? this.toISODate(invoice.dueDate)
        : this.toISODate(invoice.issueDate),
      issue_time: invoice.issueTime ?? this.currentTime(),
      invoice_type_code:
        INVOICE_TYPE_CODES[invoice.invoiceTypeCode] ??
        invoice.invoiceTypeCode ??
        '381',
      payment_status: invoice.paymentStatus ?? 'PENDING',
      tax_point_date: invoice.taxPointDate
        ? this.toISODate(invoice.taxPointDate)
        : this.toISODate(invoice.issueDate),
      document_currency_code: invoice.currency ?? 'NGN',
      tax_currency_code: invoice.taxCurrencyCode ?? invoice.currency ?? 'NGN',
      accounting_supplier_party: {
        party_name: invoice.sellerName,
        tin: invoice.sellerTin,
        email:
          sellerParty.email ??
          `invoicing@${this.tinToSlug(invoice.sellerTin)}.ng`,
        telephone: sellerParty.telephone ?? '+2340000000000',
        business_description: sellerParty.businessDescription ?? undefined,
        postal_address: {
          street_name:
            sellerParty.postalAddress?.streetName ??
            tenantAddress.streetName ??
            '',
          city_name:
            sellerParty.postalAddress?.cityName ??
            tenantAddress.cityName ??
            'Lagos',
          postal_zone:
            sellerParty.postalAddress?.postalZone ??
            tenantAddress.postalZone ??
            undefined,
          lga: sellerParty.postalAddress?.lga ?? tenantAddress.lga ?? undefined,
          state:
            sellerParty.postalAddress?.state ??
            tenantAddress.state ??
            undefined,
          country:
            sellerParty.postalAddress?.country ??
            tenantAddress.countryCode ??
            'NG',
        },
      },
      invoice_line: this.mapLineItems(invoice.lineItems ?? []),
      tax_total: this.mapTaxTotal(invoice.taxTotal ?? []),
      legal_monetary_total: this.mapLegalMonetaryTotal(
        invoice.legalMonetaryTotal,
      ),
    };

    // Optional scalar fields
    if (invoice.note) (payload as any).note = invoice.note;
    if (invoice.accountingCost)
      (payload as any).accounting_cost = invoice.accountingCost;
    if (invoice.buyerReference)
      (payload as any).buyer_reference = invoice.buyerReference;
    if (invoice.orderReference)
      (payload as any).order_reference = invoice.orderReference;
    if (invoice.actualDeliveryDate)
      (payload as any).actual_delivery_date = this.toISODate(
        invoice.actualDeliveryDate,
      );
    if (invoice.paymentTermsNote)
      (payload as any).payment_terms_note = invoice.paymentTermsNote;

    // Payment means — use stored if present, otherwise build a default from provider
    if (invoice.paymentMeans && Array.isArray(invoice.paymentMeans) && invoice.paymentMeans.length > 0) {
      (payload as any).payment_means = invoice.paymentMeans;
    } else {
      const providerCode = PAYMENT_MEANS_CODES[invoice.paymentProvider ?? ''] ?? '30';
      (payload as any).payment_means = [
        {
          payment_means_code: providerCode,
          payment_due_date: invoice.dueDate
            ? this.toISODate(invoice.dueDate)
            : this.toISODate(invoice.issueDate),
        },
      ];
    }
    if (invoice.allowanceCharges)
      (payload as any).allowance_charge = invoice.allowanceCharges;
    if (invoice.invoiceDeliveryPeriod)
      (payload as any).invoice_delivery_period = invoice.invoiceDeliveryPeriod;
    if (invoice.billingReference)
      (payload as any).billing_reference = invoice.billingReference;

    // Buyer (accounting_customer_party)
    if (invoice.buyerTin) {
      const buyerParty = invoice.metadata?.buyerParty ?? {};
      (payload as any).accounting_customer_party = {
        party_name: invoice.buyerName,
        tin: invoice.buyerTin,
        email:
          buyerParty.email ?? `buyer@${this.tinToSlug(invoice.buyerTin)}.ng`,
        telephone: buyerParty.telephone ?? '+2340000000000',
        business_description: buyerParty.businessDescription ?? undefined,
        postal_address: {
          street_name: buyerParty.postalAddress?.streetName ?? '',
          city_name: buyerParty.postalAddress?.cityName ?? 'Lagos',
          postal_zone: buyerParty.postalAddress?.postalZone ?? undefined,
          lga: buyerParty.postalAddress?.lga ?? undefined,
          state: buyerParty.postalAddress?.state ?? undefined,
          country: buyerParty.postalAddress?.country ?? 'NG',
        },
      };
    }

    return payload;
  }

  private mapLineItems(lineItems: any[]): unknown[] {
    return lineItems.map((item) => ({
      hsn_code: item.hsnCode ?? item.hsn_code,
      product_category:
        item.productCategory ?? item.product_category ?? item.item?.name,
      invoiced_quantity: item.invoicedQuantity ?? item.invoiced_quantity,
      line_extension_amount:
        item.lineExtensionAmount ?? item.line_extension_amount,
      discount_rate: item.discountRate ?? item.discount_rate ?? 0,
      discount_amount: item.discountAmount ?? item.discount_amount ?? 0,
      fee_rate: item.feeRate ?? item.fee_rate ?? 0,
      fee_amount: item.feeAmount ?? item.fee_amount ?? 0,
      item: {
        name: item.item?.name ?? item.itemName,
        description: item.item?.description ?? undefined,
        sellers_item_identification:
          item.item?.sellersItemIdentification ??
          item.item?.sellers_item_identification ??
          item.hsnCode ??
          item.hsn_code,
      },
      price: {
        price_amount: item.price?.priceAmount ?? item.price?.price_amount,
        base_quantity:
          item.price?.baseQuantity ?? item.price?.base_quantity ?? 1,
        price_unit:
          item.price?.priceUnit ?? item.price?.price_unit ?? 'NGN per 1',
      },
    }));
  }

  private mapTaxTotal(taxTotal: any[]): unknown[] {
    return taxTotal.map((tt) => ({
      tax_amount: tt.taxAmount ?? tt.tax_amount,
      tax_subtotal: (tt.taxSubtotal ?? tt.tax_subtotal ?? []).map(
        (sub: any) => ({
          taxable_amount: sub.taxableAmount ?? sub.taxable_amount,
          tax_amount: sub.taxAmount ?? sub.tax_amount,
          tax_category: {
            id: this.normaliseTaxCategoryId(
              sub.taxCategory?.id ?? sub.tax_category?.id,
            ),
            percent: sub.taxCategory?.percent ?? sub.tax_category?.percent,
          },
        }),
      ),
    }));
  }

  private mapLegalMonetaryTotal(lmt: any): Record<string, unknown> {
    if (!lmt) return {};
    return {
      line_extension_amount:
        lmt.lineExtensionAmount ?? lmt.line_extension_amount,
      tax_exclusive_amount: lmt.taxExclusiveAmount ?? lmt.tax_exclusive_amount,
      tax_inclusive_amount: lmt.taxInclusiveAmount ?? lmt.tax_inclusive_amount,
      payable_amount: lmt.payableAmount ?? lmt.payable_amount,
    };
  }

  private normaliseTaxCategoryId(id: string): string {
    if (!id) return 'STANDARD_VAT';
    const upper = id.toUpperCase();
    // Legacy aliases
    if (upper === 'VAT' || upper === 'S') return 'STANDARD_VAT';
    if (upper === 'Z' || upper === 'ZERO' || upper === 'ZERO_RATED')
      return 'ZERO_VAT';
    if (upper === 'WHT') return 'WITHHOLDING_TAX';
    if (upper === 'EXEMPT' || upper === 'NOT_APPLICABLE') return 'EXEMPTED';
    return upper;
  }

  // ─── Error mapping ────────────────────────────────────────────────────────

  private mapError(err: any): SubmissionResult {
    const status: number = err.statusCode ?? 0;
    const body: NrsErrorResponse = err.body ?? {};
    const message = err.message ?? 'Unknown error';
    const details = (body.details ?? '').toLowerCase();

    // Abort/timeout
    if (err.name === 'AbortError') {
      return {
        success: false,
        errorCode: 'TIMEOUT',
        errorMessage: 'Request timed out',
        retryable: true,
      };
    }

    // 401 — invalid static credentials (not retryable — credentials don't expire)
    if (status === 401) {
      return {
        success: false,
        errorCode: 'INVALID_CREDENTIALS',
        errorMessage: message,
        retryable: false,
      };
    }

    // 429 — rate limited
    if (status === 429) {
      return {
        success: false,
        errorCode: 'RATE_LIMITED',
        errorMessage: message,
        retryable: true,
      };
    }

    // 500 / 503 — server / NRS offline
    if (status >= 500) {
      return {
        success: false,
        errorCode: 'SERVER_ERROR',
        errorMessage: message,
        retryable: true,
      };
    }

    // 422 — schema validation failure
    if (status === 422) {
      return {
        success: false,
        errorCode: 'SCHEMA_VALIDATION',
        errorMessage: message,
        retryable: false,
      };
    }

    // 400 — classify by error details
    if (status === 400) {
      if (details.includes('duplicate') || details.includes('irn')) {
        return {
          success: false,
          errorCode: 'IRN_DUPLICATE',
          errorMessage: message,
          retryable: false,
        };
      }
      if (details.includes('invalid uuid') || details.includes('business')) {
        return {
          success: false,
          errorCode: 'INVALID_BUSINESS_ID',
          errorMessage: message,
          retryable: false,
        };
      }
      if (details.includes('taxcategory') || details.includes('tax category')) {
        return {
          success: false,
          errorCode: 'INVALID_TAX_CATEGORY',
          errorMessage: message,
          retryable: false,
        };
      }
      if (details.includes('taxpointdate') || details.includes('tax point')) {
        return {
          success: false,
          errorCode: 'INVALID_TAX_POINT_DATE',
          errorMessage: message,
          retryable: false,
        };
      }
      if (details.includes('country')) {
        return {
          success: false,
          errorCode: 'INVALID_COUNTRY_CODE',
          errorMessage: message,
          retryable: false,
        };
      }
      if (details.includes('.tin') || details.includes('tin is required')) {
        return {
          success: false,
          errorCode: 'INVALID_TIN',
          errorMessage: message,
          retryable: false,
        };
      }
      return {
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: message,
        retryable: false,
      };
    }

    return {
      success: false,
      errorCode: 'UNKNOWN_ERROR',
      errorMessage: message,
      retryable: false,
    };
  }

  private extractErrorMessage(parsed: NrsErrorResponse, raw: string): string {
    return (
      parsed.errorMessage ??
      parsed.message ??
      parsed.details ??
      raw.slice(0, 300)
    );
  }

  // ─── Data helpers ─────────────────────────────────────────────────────────

  private async loadTenant(tenantId: string) {
    return this.prisma.asAdmin(async (tx) => {
      return tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    });
  }

  private toISODate(d: Date | string): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toISOString().split('T')[0];
  }

  private toYYYYMMDD(d: Date | string): string {
    return this.toISODate(d).replace(/-/g, '');
  }

  private currentTime(): string {
    return new Date().toTimeString().split(' ')[0]; // HH:mm:ss
  }

  private tinToSlug(tin: string): string {
    return tin
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 12);
  }
}
