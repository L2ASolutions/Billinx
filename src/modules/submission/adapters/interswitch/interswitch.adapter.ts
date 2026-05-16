import { Injectable, Logger } from '@nestjs/common';
import { AppAdapter } from '../app-adapter.interface';
import { SubmissionRequest, SubmissionResult } from '../../../../../packages/types/submission';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { CredentialService } from '../../../tenant/services/credential.service';
import { SecretsService } from '../../../../infrastructure/secrets/secrets.service';

const INVOICE_TYPE_CODES: Record<string, string> = {
  STANDARD: '381',
  CREDIT_NOTE: '380',
  DEBIT_NOTE: '384',
  PROFORMA: '325',
};

interface TokenEntry {
  token: string;
  expiresAt: number;
}

interface InterswitchSuccessResponse {
  code: number;
  message: string;
  data: {
    IRN: string;
    PostingDateTime: string;
    QRCodeData: string;
  };
}

interface InterswitchErrorResponse {
  code?: number | string;
  message?: string;
  error?: {
    id?: string;
    handler?: string;
    details?: string;
    public_message?: string;
  };
  errorCode?: string;
  errorMessage?: string;
  details?: string;
  error_description?: string;
}

@Injectable()
export class InterswitchAdapter implements AppAdapter {
  readonly adapterKey = 'interswitch';
  readonly adapterName = 'Interswitch NRS E-Invoicing Adapter';

  private readonly logger = new Logger(InterswitchAdapter.name);
  private readonly tokenCache = new Map<string, TokenEntry>();

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
    if (!tenant.interswitchClientId || !tenant.interswitchClientSecret || !tenant.interswitchSecretIv) {
      return {
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        errorMessage: 'Interswitch credentials not configured for this tenant',
        retryable: false,
      };
    }

    const baseUrl = tenant.environment === 'PRODUCTION' ? this.productionBaseUrl : this.sandboxBaseUrl;
    const invoice = (request.payload as any).invoice;

    let token: string;
    try {
      token = await this.getAccessToken(request.tenantId, tenant, baseUrl);
    } catch (err: any) {
      return {
        success: false,
        errorCode: 'AUTH_ERROR',
        errorMessage: `Failed to obtain Interswitch token: ${err.message}`,
        retryable: true,
      };
    }

    const payload = this.buildPayload(invoice, tenant);
    const startMs = Date.now();

    try {
      const result = await this.postInvoice(baseUrl, token, payload);
      this.logger.log(
        `Invoice ${request.platformIrn} accepted by Interswitch. IRN: ${result.data.IRN}`,
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
      // Token expired: clear cache and make one retry
      if (err.statusCode === 401) {
        this.tokenCache.delete(request.tenantId);
        try {
          token = await this.getAccessToken(request.tenantId, tenant, baseUrl);
          const result = await this.postInvoice(baseUrl, token, payload);
          return {
            success: true,
            firsConfirmedIrn: result.data.IRN,
            qrCodeBase64: result.data.QRCodeData,
            rawResponse: { irn: result.data.IRN, postingDateTime: result.data.PostingDateTime },
          };
        } catch (retryErr: any) {
          return this.mapError(retryErr);
        }
      }
      return this.mapError(err);
    }
  }

  async checkStatus(
    platformIrn: string,
    _tenantCredential: Record<string, unknown>,
  ): Promise<SubmissionResult> {
    return {
      success: false,
      errorCode: 'NOT_IMPLEMENTED',
      errorMessage: 'Status check not supported by Interswitch adapter',
      retryable: false,
    };
  }

  async ping(): Promise<boolean> {
    try {
      const resp = await fetch(
        `${this.sandboxBaseUrl}/Api/SwitchTax/Token`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      return resp.status < 500;
    } catch {
      return false;
    }
  }

  // ─── Token management ─────────────────────────────────────────────────────

  private async getAccessToken(tenantId: string, tenant: any, baseUrl: string): Promise<string> {
    const cached = this.tokenCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const masterKey = await this.secretsService.getMasterEncryptionKey();
    const clientSecret = this.credentialService.decrypt(
      Buffer.from(tenant.interswitchClientSecret),
      Buffer.from(tenant.interswitchSecretIv),
      masterKey,
      tenantId,
    );

    const response = await fetch(`${baseUrl}/Api/SwitchTax/Token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ClientId: tenant.interswitchClientId,
        ClientSecret: clientSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw Object.assign(
        new Error(`Token request failed (${response.status}): ${body}`),
        { statusCode: response.status },
      );
    }

    const data = await response.json() as { Token: string; expires_in: number };
    const token = data.Token;
    // Cache with 60-second buffer before actual expiry
    const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
    this.tokenCache.set(tenantId, { token, expiresAt });

    this.logger.log(`Obtained Interswitch token for tenant ${tenantId}`);
    return token;
  }

  // ─── Invoice submission ───────────────────────────────────────────────────

  private async postInvoice(
    baseUrl: string,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<InterswitchSuccessResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/Api/SwitchTax/postInvoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const body = await response.text();

    if (response.status === 201 || response.status === 200) {
      return JSON.parse(body) as InterswitchSuccessResponse;
    }

    let parsed: InterswitchErrorResponse = {};
    try { parsed = JSON.parse(body); } catch { /* raw body */ }

    const err = Object.assign(
      new Error(this.extractErrorMessage(parsed, body)),
      { statusCode: response.status, body: parsed },
    );
    throw err;
  }

  // ─── Payload builder ──────────────────────────────────────────────────────

  private buildPayload(invoice: any, tenant: any): Record<string, unknown> {
    const serviceId = tenant.interswitchServiceId ?? 'BILLINX';
    const invoiceNo = invoice.sourceReference ?? invoice.id.substring(0, 8).toUpperCase();
    const dateStr = this.toYYYYMMDD(invoice.issueDate);
    const irn = `${invoiceNo}-${serviceId}-${dateStr}`;

    const sellerParty = (invoice.metadata as any)?.sellerParty ?? {};
    const tenantAddress = (tenant.registeredAddress as any) ?? {};

    const payload: Record<string, unknown> = {
      business_id: tenant.interswitchBusinessId,
      irn,
      invoice_kind: invoice.invoiceKind ?? 'B2B',
      issue_date: this.toISODate(invoice.issueDate),
      due_date: invoice.dueDate ? this.toISODate(invoice.dueDate) : this.toISODate(invoice.issueDate),
      issue_time: invoice.issueTime ?? this.currentTime(),
      invoice_type_code: INVOICE_TYPE_CODES[invoice.invoiceTypeCode] ?? '381',
      payment_status: invoice.paymentStatus ?? 'UNPAID',
      tax_point_date: invoice.taxPointDate
        ? this.toISODate(invoice.taxPointDate)
        : this.toISODate(invoice.issueDate),
      document_currency_code: invoice.currency ?? 'NGN',
      tax_currency_code: invoice.taxCurrencyCode ?? invoice.currency ?? 'NGN',
      accounting_supplier_party: {
        party_name: invoice.sellerName,
        tin: invoice.sellerTin,
        email: sellerParty.email ?? `invoicing@${this.tinToSlug(invoice.sellerTin)}.ng`,
        telephone: sellerParty.telephone ?? '+2340000000000',
        business_description: sellerParty.businessDescription ?? undefined,
        postal_address: {
          street_name: sellerParty.postalAddress?.streetName ?? tenantAddress.streetName ?? '',
          city_name: sellerParty.postalAddress?.cityName ?? tenantAddress.cityName ?? 'Lagos',
          postal_zone: sellerParty.postalAddress?.postalZone ?? tenantAddress.postalZone ?? '',
          country: sellerParty.postalAddress?.country ?? tenantAddress.countryCode ?? 'NG',
        },
      },
      invoice_line: this.mapLineItems(invoice.lineItems ?? []),
      tax_total: this.mapTaxTotal(invoice.taxTotal ?? []),
      legal_monetary_total: invoice.legalMonetaryTotal,
    };

    if (invoice.buyerTin) {
      const buyerParty = (invoice.metadata as any)?.buyerParty ?? {};
      (payload as any).accounting_customer_party = {
        party_name: invoice.buyerName,
        tin: invoice.buyerTin,
        email: buyerParty.email ?? `buyer@${this.tinToSlug(invoice.buyerTin)}.ng`,
        telephone: buyerParty.telephone ?? '+2340000000000',
        business_description: buyerParty.businessDescription ?? undefined,
        postal_address: {
          street_name: buyerParty.postalAddress?.streetName ?? '',
          city_name: buyerParty.postalAddress?.cityName ?? 'Lagos',
          postal_zone: buyerParty.postalAddress?.postalZone ?? '',
          country: buyerParty.postalAddress?.country ?? 'NG',
        },
      };
    }

    if (invoice.billingReference) {
      (payload as any).billing_reference = invoice.billingReference;
    }

    return payload;
  }

  private mapLineItems(lineItems: any[]): unknown[] {
    return lineItems.map((item) => ({
      hsn_code: item.hsnCode ?? item.hsn_code,
      product_category: item.productCategory ?? item.product_category ?? item.item?.name,
      invoiced_quantity: item.invoicedQuantity ?? item.invoiced_quantity,
      line_extension_amount: item.lineExtensionAmount ?? item.line_extension_amount,
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
        base_quantity: item.price?.baseQuantity ?? item.price?.base_quantity ?? 1,
        price_unit: item.price?.priceUnit ?? item.price?.price_unit ?? 'NGN',
      },
    }));
  }

  private mapTaxTotal(taxTotal: any[]): unknown[] {
    return taxTotal.map((tt) => ({
      tax_amount: tt.taxAmount ?? tt.tax_amount,
      tax_subtotal: (tt.taxSubtotal ?? tt.tax_subtotal ?? []).map((sub: any) => ({
        taxable_amount: sub.taxableAmount ?? sub.taxable_amount,
        tax_amount: sub.taxAmount ?? sub.tax_amount,
        tax_category: {
          // Normalise legacy "VAT" to the Interswitch-required value
          id: this.normaliseTaxCategoryId(sub.taxCategory?.id ?? sub.tax_category?.id),
          percent: sub.taxCategory?.percent ?? sub.tax_category?.percent,
        },
      })),
    }));
  }

  private normaliseTaxCategoryId(id: string): string {
    if (!id) return 'STANDARD_VAT';
    const upper = id.toUpperCase();
    if (upper === 'VAT' || upper === 'S') return 'STANDARD_VAT';
    if (upper === 'Z' || upper === 'ZERO' || upper === 'ZERO_RATED') return 'ZERO_VAT';
    return upper;
  }

  // ─── Error mapping ────────────────────────────────────────────────────────

  private mapError(err: any): SubmissionResult {
    const status: number = err.statusCode ?? 0;
    const body: InterswitchErrorResponse = err.body ?? {};
    const message = err.message ?? 'Unknown error';
    const details = body.error?.details ?? body.details ?? '';

    // 401 — token invalid/expired
    if (status === 401) {
      return { success: false, errorCode: 'AUTH_EXPIRED', errorMessage: message, retryable: true };
    }

    // 429 — rate limited
    if (status === 429) {
      return { success: false, errorCode: 'RATE_LIMITED', errorMessage: message, retryable: true };
    }

    // 500 / 503 — server/NRS offline
    if (status >= 500) {
      return { success: false, errorCode: 'SERVER_ERROR', errorMessage: message, retryable: true };
    }

    // Timeout
    if (err.name === 'AbortError') {
      return { success: false, errorCode: 'TIMEOUT', errorMessage: 'Request timed out', retryable: true };
    }

    // 422 — schema validation failure
    if (status === 422) {
      return { success: false, errorCode: 'SCHEMA_VALIDATION', errorMessage: message, retryable: false };
    }

    // 400 — classify by error details
    if (status === 400) {
      const dl = details.toLowerCase();
      if (dl.includes('duplicate') || dl.includes('not a duplicate')) {
        return { success: false, errorCode: 'IRN_DUPLICATE', errorMessage: message, retryable: false };
      }
      if (dl.includes('invalid uuid') || dl.includes('business')) {
        return { success: false, errorCode: 'INVALID_BUSINESS_ID', errorMessage: message, retryable: false };
      }
      if (dl.includes('taxcategory') || dl.includes('tax category')) {
        return { success: false, errorCode: 'INVALID_TAX_CATEGORY', errorMessage: message, retryable: false };
      }
      if (dl.includes('taxpointdate') || dl.includes('tax point')) {
        return { success: false, errorCode: 'INVALID_TAX_POINT_DATE', errorMessage: message, retryable: false };
      }
      if (dl.includes('country')) {
        return { success: false, errorCode: 'INVALID_COUNTRY_CODE', errorMessage: message, retryable: false };
      }
      if (dl.includes('.tin')) {
        return { success: false, errorCode: 'INVALID_TIN', errorMessage: message, retryable: false };
      }
      return { success: false, errorCode: 'VALIDATION_ERROR', errorMessage: message, retryable: false };
    }

    return { success: false, errorCode: 'UNKNOWN_ERROR', errorMessage: message, retryable: false };
  }

  private extractErrorMessage(parsed: InterswitchErrorResponse, raw: string): string {
    return (
      parsed.error?.public_message ??
      parsed.error_description ??
      parsed.errorMessage ??
      parsed.message ??
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
    return tin.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12);
  }
}
