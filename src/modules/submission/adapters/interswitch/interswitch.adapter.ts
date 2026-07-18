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

// Interswitch's NRS docs give these five exact-case strings — mixed case for
// Withholding_Tax/Stamp_Duty is intentional, not a typo.
const VALID_TAX_CATEGORIES = new Set([
  'STANDARD_VAT',
  'ZERO_VAT',
  'EXEMPTED',
  'Withholding_Tax',
  'Stamp_Duty',
]);

// Only the codes explicitly confirmed against the Interswitch NRS schema doc.
// The doc lists these as examples ("valid codes include: EA, KGM, LTR") —
// expand this set once the full NRS unit-code list is confirmed.
const VALID_PRICE_UNITS = new Set(['EA', 'KGM', 'LTR']);

const CREDIT_OR_DEBIT_NOTE_TYPES = new Set(['CREDIT_NOTE', 'DEBIT_NOTE']);
const VALID_INVOICE_KINDS = new Set(['B2B', 'B2C', 'B2G']);
const BUSINESS_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEGAL_MONETARY_TOTAL_FIELDS = [
  'line_extension_amount',
  'tax_exclusive_amount',
  'tax_inclusive_amount',
  'payable_amount',
] as const;

const OAUTH_TOKEN_TTL_MS = 3600 * 1000;
const OAUTH_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

// Thrown for payload-shape/business-rule problems caught before (or instead
// of) ever calling NRS — always maps to a non-retryable SubmissionResult with
// a specific errorCode, distinct from mapError()'s handling of NRS's own
// HTTP-level responses. Exported so callers of previewPayload() (a diagnostic
// read path, not the submission path) can catch it and translate errorCode
// into an appropriate HTTP response.
export class NrsValidationError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'NrsValidationError';
  }
}

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

// Interswitch's token-response field naming isn't pinned down beyond the
// endpoint path and ClientId/ClientSecret request body in the shared docs —
// this checks the common OAuth Client Credentials response shapes.
interface NrsTokenResponse {
  data?: { Token?: string; access_token?: string };
  Token?: string;
  access_token?: string;
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

  // Per-tenant OAuth token cache. Each tenant has its own Interswitch
  // Client ID/Secret (registered separately with the NRS Access Point
  // Provider), so tokens cannot be shared across tenants.
  private readonly tokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: CredentialService,
    private readonly secretsService: SecretsService,
  ) {}

  async submit(request: SubmissionRequest): Promise<SubmissionResult> {
    const tenant = await this.loadTenant(request.tenantId);

    if (
      !tenant.interswitchBusinessId ||
      !BUSINESS_ID_UUID_RE.test(tenant.interswitchBusinessId)
    ) {
      return {
        success: false,
        errorCode: 'MISSING_BUSINESS_ID',
        errorMessage:
          'NRS business_id not configured for this tenant — contact your administrator',
        retryable: false,
      };
    }

    if (
      !tenant.interswitchClientId ||
      !tenant.interswitchClientSecret ||
      !tenant.interswitchSecretIv
    ) {
      return {
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        errorMessage: 'NRS OAuth credentials not configured for this tenant',
        retryable: false,
      };
    }

    const baseUrl =
      tenant.environment === 'PRODUCTION'
        ? this.productionBaseUrl
        : this.sandboxBaseUrl;

    try {
      const clientSecret = await this.getDecryptedClientSecret(
        tenant,
        request.tenantId,
      );
      const token = await this.getAccessToken(
        request.tenantId,
        baseUrl,
        tenant.interswitchClientId,
        clientSecret,
      );

      const invoice = (request.payload as any).invoice;
      const payload = await this.buildPayload(invoice, tenant);
      const startMs = Date.now();

      const result = await this.postInvoice(baseUrl, token, payload);
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
      if (err instanceof NrsValidationError) {
        return {
          success: false,
          errorCode: err.errorCode,
          errorMessage: err.message,
          retryable: false,
        };
      }
      return this.mapError(err);
    }
  }

  // Diagnostic read path — builds the exact same payload submit() would send
  // to NRS, without ever calling postInvoice() or touching invoice/submission
  // state. Replicates submit()'s two pre-flight guards (business_id/OAuth
  // credentials) so a preview fails the same way a real submission would,
  // rather than silently emitting an incomplete payload.
  async previewPayload(
    tenantId: string,
    invoiceId: string,
  ): Promise<{ payload: Record<string, unknown>; irn: string }> {
    const tenant = await this.loadTenant(tenantId);

    if (
      !tenant.interswitchBusinessId ||
      !BUSINESS_ID_UUID_RE.test(tenant.interswitchBusinessId)
    ) {
      throw new NrsValidationError(
        'MISSING_BUSINESS_ID',
        'NRS business_id not configured for this tenant — contact your administrator',
      );
    }

    if (
      !tenant.interswitchClientId ||
      !tenant.interswitchClientSecret ||
      !tenant.interswitchSecretIv
    ) {
      throw new NrsValidationError(
        'MISSING_CREDENTIALS',
        'NRS OAuth credentials not configured for this tenant',
      );
    }

    const invoice = await this.prisma.asAdmin((tx) =>
      tx.invoice.findUnique({ where: { id: invoiceId } }),
    );
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NrsValidationError(
        'INVOICE_NOT_FOUND',
        `Invoice ${invoiceId} not found`,
      );
    }

    const payload = await this.buildPayload(invoice, tenant);
    return {
      payload: {
        ...payload,
        preview_note:
          'IRN and issue_time are generated at preview time and will differ from the final submission IRN',
      },
      irn: invoice.firsConfirmedIrn ?? invoice.platformIrn,
    };
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
      !tenant.interswitchClientId ||
      !tenant.interswitchClientSecret ||
      !tenant.interswitchSecretIv
    ) {
      return {
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        errorMessage: 'NRS OAuth credentials not configured for this tenant',
        retryable: false,
      };
    }

    const baseUrl =
      tenant.environment === 'PRODUCTION'
        ? this.productionBaseUrl
        : this.sandboxBaseUrl;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const clientSecret = await this.getDecryptedClientSecret(
        tenant,
        tenantId,
      );
      const token = await this.getAccessToken(
        tenantId,
        baseUrl,
        tenant.interswitchClientId,
        clientSecret,
      );

      const response = await fetch(
        `${baseUrl}/Api/SwitchTax/transmit/${encodeURIComponent(platformIrn)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
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

  // Returns whether the NRS call succeeded, so callers (e.g. the
  // update-status BullMQ worker) can throw and drive a retry rather than
  // this method silently swallowing every failure.
  async updatePaymentStatus(
    irn: string,
    tenantId: string,
    status: 'PAID' | 'PARTIAL',
    amount?: number,
  ): Promise<boolean> {
    const tenant = await this.loadTenant(tenantId);
    if (
      !tenant.interswitchClientId ||
      !tenant.interswitchClientSecret ||
      !tenant.interswitchSecretIv
    ) {
      this.logger.warn(
        `Cannot update payment status for IRN ${irn}: NRS OAuth credentials not configured`,
      );
      return false;
    }

    const baseUrl =
      tenant.environment === 'PRODUCTION'
        ? this.productionBaseUrl
        : this.sandboxBaseUrl;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const clientSecret = await this.getDecryptedClientSecret(
        tenant,
        tenantId,
      );
      const token = await this.getAccessToken(
        tenantId,
        baseUrl,
        tenant.interswitchClientId,
        clientSecret,
      );

      const response = await fetch(`${baseUrl}/Api/SwitchTax/UpdateStatus`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          irn,
          payment_status: status,
          ...(status === 'PARTIAL' && amount != null ? { amount } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.warn(
          `UpdateStatus for IRN ${irn} returned ${response.status}: ${body.slice(0, 200)}`,
        );
        return false;
      }
      this.logger.log(
        `Payment status updated on NRS for IRN ${irn}: ${status}`,
      );
      return true;
    } catch (err: any) {
      this.logger.warn(
        `UpdateStatus call failed for IRN ${irn}: ${err.message}`,
      );
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async ping(): Promise<boolean> {
    // Tenant-agnostic reachability probe — there is no specific tenant here
    // to fetch a per-tenant OAuth token for, so this remains an unauthenticated
    // connectivity check (unchanged from the static-header scheme, which also
    // sent no per-tenant credentials on this call).
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

  // ─── OAuth 2.0 Client Credentials ───────────────────────────────────────────

  private async getAccessToken(
    tenantId: string,
    baseUrl: string,
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    const cached = this.tokenCache.get(tenantId);
    if (
      cached &&
      Date.now() < cached.expiresAt - OAUTH_TOKEN_REFRESH_MARGIN_MS
    ) {
      return cached.token;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/Api/SwitchTax/Token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ClientId: clientId,
          ClientSecret: clientSecret,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const body = await response.text();
    let parsed: NrsTokenResponse = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* raw body */
    }

    if (!response.ok) {
      throw Object.assign(
        new Error(
          `NRS token request failed: ${response.status} ${body.slice(0, 200)}`,
        ),
        { statusCode: response.status, body: parsed },
      );
    }

    const token =
      parsed.data?.Token ??
      parsed.data?.access_token ??
      parsed.Token ??
      parsed.access_token;

    if (!token) {
      throw Object.assign(
        new Error('NRS token response did not include a token'),
        { statusCode: response.status, body: parsed },
      );
    }

    this.tokenCache.set(tenantId, {
      token,
      expiresAt: Date.now() + OAUTH_TOKEN_TTL_MS,
    });

    return token;
  }

  // ─── Invoice submission ───────────────────────────────────────────────────

  private async postInvoice(
    baseUrl: string,
    token: string,
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
          Authorization: `Bearer ${token}`,
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

  private async buildPayload(
    invoice: any,
    tenant: any,
  ): Promise<Record<string, unknown>> {
    const serviceId = tenant.interswitchServiceId ?? 'BILLINX';
    const invoiceNo =
      invoice.sourceReference ?? invoice.id.substring(0, 8).toUpperCase();
    const dateStr = this.toYYYYMMDD(invoice.issueDate);
    const unixTimestamp = Math.floor(Date.now() / 1000);
    const irn = `${invoiceNo}-${serviceId}-${dateStr}.${unixTimestamp}`;

    const sellerParty = invoice.metadata?.sellerParty ?? {};
    const tenantAddress = tenant.registeredAddress ?? {};

    const mappedTypeCode = INVOICE_TYPE_CODES[invoice.invoiceTypeCode];
    if (!mappedTypeCode) {
      throw new NrsValidationError(
        'INVALID_INVOICE_TYPE_CODE',
        `Unrecognized invoice type code: ${invoice.invoiceTypeCode}`,
      );
    }

    if (!invoice.invoiceKind || !VALID_INVOICE_KINDS.has(invoice.invoiceKind)) {
      throw new NrsValidationError(
        'MISSING_INVOICE_KIND',
        'invoice_kind is required and must be one of B2B, B2C, B2G',
      );
    }

    const legalMonetaryTotal = this.mapLegalMonetaryTotal(
      invoice.legalMonetaryTotal,
    );
    for (const field of LEGAL_MONETARY_TOTAL_FIELDS) {
      const value = Number((legalMonetaryTotal as any)[field]);
      if (!value || value <= 0) {
        throw new NrsValidationError(
          'INVALID_LEGAL_MONETARY_TOTAL',
          `legal_monetary_total.${field} must be present and greater than zero`,
        );
      }
    }

    const payload: Record<string, unknown> = {
      business_id: tenant.interswitchBusinessId,
      irn,
      invoice_kind: invoice.invoiceKind,
      issue_date: this.toISODate(invoice.issueDate),
      due_date: invoice.dueDate
        ? this.toISODate(invoice.dueDate)
        : this.toISODate(invoice.issueDate),
      issue_time: invoice.issueTime ?? this.currentTime(),
      invoice_type_code: mappedTypeCode,
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
      legal_monetary_total: legalMonetaryTotal,
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
    if (
      invoice.paymentMeans &&
      Array.isArray(invoice.paymentMeans) &&
      invoice.paymentMeans.length > 0
    ) {
      (payload as any).payment_means = invoice.paymentMeans;
    } else {
      const providerCode =
        PAYMENT_MEANS_CODES[invoice.paymentProvider ?? ''] ?? '30';
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

    // billing_reference — for credit/debit notes this is always derived from
    // originalIrn (not passed through from whatever was stored on the
    // invoice), so it always reflects the actual original invoice's issue date.
    if (CREDIT_OR_DEBIT_NOTE_TYPES.has(invoice.invoiceTypeCode)) {
      if (!invoice.originalIrn) {
        throw new NrsValidationError(
          'MISSING_ORIGINAL_IRN',
          'Credit notes and debit notes must reference an original IRN',
        );
      }
      const original = await this.prisma.asAdmin((tx) =>
        tx.invoice.findFirst({
          where: {
            tenantId: tenant.id,
            OR: [
              { platformIrn: invoice.originalIrn },
              { firsConfirmedIrn: invoice.originalIrn },
            ],
          },
          select: { issueDate: true },
        }),
      );
      if (!original) {
        throw new NrsValidationError(
          'ORIGINAL_INVOICE_NOT_FOUND',
          `Original invoice ${invoice.originalIrn} referenced by billing_reference was not found`,
        );
      }
      (payload as any).billing_reference = [
        {
          irn: invoice.originalIrn,
          issue_date: this.toISODate(original.issueDate),
        },
      ];
    } else if (invoice.billingReference) {
      (payload as any).billing_reference = invoice.billingReference;
    }

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
    return lineItems.map((item) => {
      const itemType = (item.itemType ?? item.item_type ?? 'PRODUCT')
        .toString()
        .toUpperCase();
      const isService = itemType === 'SERVICE';

      const classification = isService
        ? {
            isic_code: item.isicCode ?? item.isic_code,
            service_category: item.serviceCategory ?? item.service_category,
          }
        : {
            hsn_code: item.hsnCode ?? item.hsn_code,
            product_category:
              item.productCategory ?? item.product_category ?? item.item?.name,
          };

      if (isService) {
        if (!classification.isic_code || !classification.service_category) {
          throw new NrsValidationError(
            'MISSING_SERVICE_CLASSIFICATION',
            'SERVICE line items require both isic_code and service_category',
          );
        }
      } else if (!classification.hsn_code || !classification.product_category) {
        throw new NrsValidationError(
          'MISSING_PRODUCT_CLASSIFICATION',
          'PRODUCT line items require both hsn_code and product_category',
        );
      }

      const priceUnit = this.resolvePriceUnit(
        item.price?.priceUnit ?? item.price?.price_unit,
      );
      const quantity = item.invoicedQuantity ?? item.invoiced_quantity;
      const priceAmount = item.price?.priceAmount ?? item.price?.price_amount;

      return {
        ...classification,
        invoiced_quantity: quantity,
        line_extension_amount:
          item.lineExtensionAmount ?? item.line_extension_amount,
        discount_rate: item.discountRate ?? item.discount_rate ?? 0,
        discount_amount: item.discountAmount ?? item.discount_amount ?? 0,
        fee_rate: item.feeRate ?? item.fee_rate ?? 0,
        fee_amount: item.feeAmount ?? item.fee_amount ?? 0,
        item: {
          name: item.item?.name ?? item.itemName,
          description:
            item.item?.description ??
            this.formatDefaultDescription(quantity, priceUnit, priceAmount),
          sellers_item_identification:
            item.item?.sellersItemIdentification ??
            item.item?.sellers_item_identification ??
            classification.hsn_code ??
            classification.isic_code,
        },
        price: {
          price_amount: priceAmount,
          base_quantity:
            item.price?.baseQuantity ?? item.price?.base_quantity ?? 1,
          price_unit: priceUnit,
        },
      };
    });
  }

  private resolvePriceUnit(unit?: string): string {
    const resolved = (unit ?? 'EA').toString().toUpperCase();
    if (!VALID_PRICE_UNITS.has(resolved)) {
      throw new NrsValidationError(
        'INVALID_PRICE_UNIT',
        `Unrecognized price_unit: ${resolved}`,
      );
    }
    return resolved;
  }

  private formatDefaultDescription(
    quantity: number | undefined,
    priceUnit: string,
    priceAmount: number | undefined,
  ): string {
    const q = Number(quantity ?? 0).toFixed(2);
    const p = Number(priceAmount ?? 0).toFixed(2);
    return `${q} ${priceUnit} at ${p} each`;
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

    // Legacy aliases — map loose/legacy input onto the exact-case NRS values.
    let normalised: string;
    if (upper === 'VAT' || upper === 'S' || upper === 'STANDARD_VAT') {
      normalised = 'STANDARD_VAT';
    } else if (
      upper === 'Z' ||
      upper === 'ZERO' ||
      upper === 'ZERO_RATED' ||
      upper === 'ZERO_VAT'
    ) {
      normalised = 'ZERO_VAT';
    } else if (upper === 'WHT' || upper === 'WITHHOLDING_TAX') {
      normalised = 'Withholding_Tax';
    } else if (
      upper === 'EXEMPT' ||
      upper === 'NOT_APPLICABLE' ||
      upper === 'EXEMPTED'
    ) {
      normalised = 'EXEMPTED';
    } else if (upper === 'STAMP_DUTY' || upper === 'STAMP' || upper === 'SD') {
      normalised = 'Stamp_Duty';
    } else if (VALID_TAX_CATEGORIES.has(id)) {
      // Already exact-case-correct as supplied (e.g. 'Withholding_Tax' itself).
      normalised = id;
    } else {
      throw new NrsValidationError(
        'INVALID_TAX_CATEGORY',
        `Unrecognized tax category id: ${id}`,
      );
    }

    return normalised;
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

    // 401 — invalid OAuth credentials or expired/rejected token
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

  private async getDecryptedClientSecret(
    tenant: any,
    tenantId: string,
  ): Promise<string> {
    const masterKey = await this.secretsService.getMasterEncryptionKey();
    return this.credentialService.decrypt(
      Buffer.from(tenant.interswitchClientSecret),
      Buffer.from(tenant.interswitchSecretIv),
      masterKey,
      tenantId,
    );
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
