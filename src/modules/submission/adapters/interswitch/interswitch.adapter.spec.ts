/// <reference types="jest" />

import { InterswitchAdapter } from './interswitch.adapter';
import { SubmissionRequest } from '../../../../../packages/types/submission';

const TENANT_ID = 'tenant-1';
const MASTER_KEY = Buffer.from('master-key');

function makeTenantRow(overrides: Record<string, any> = {}) {
  return {
    id: TENANT_ID,
    environment: 'SANDBOX',
    nrsApiKey: Buffer.from('enc-key'),
    nrsApiKeyIv: Buffer.from('iv-key'),
    nrsApiSecret: Buffer.from('enc-secret'),
    nrsApiSecretIv: Buffer.from('iv-secret'),
    interswitchServiceId: 'SVC001',
    interswitchBusinessId: 'BIZ-001',
    registeredAddress: {
      streetName: '1 Main St',
      cityName: 'Lagos',
      countryCode: 'NG',
    },
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, any> = {}) {
  return {
    id: 'invoice-0001-abcd',
    sourceReference: undefined,
    issueDate: '2026-01-15',
    dueDate: '2026-02-15',
    invoiceKind: 'B2B',
    invoiceTypeCode: 'STANDARD',
    paymentStatus: 'PENDING',
    currency: 'NGN',
    sellerName: 'Seller Ltd',
    sellerTin: 'SELLER-TIN-01',
    buyerName: 'Buyer Ltd',
    buyerTin: 'BUYER-TIN-01',
    lineItems: [
      {
        hsnCode: '1234',
        productCategory: 'Widgets',
        invoicedQuantity: 2,
        lineExtensionAmount: 200,
        item: { name: 'Widget' },
        price: { priceAmount: 100 },
      },
    ],
    taxTotal: [
      {
        taxAmount: 15,
        taxSubtotal: [
          {
            taxableAmount: 200,
            taxAmount: 15,
            taxCategory: { id: 'VAT', percent: 7.5 },
          },
        ],
      },
    ],
    legalMonetaryTotal: {
      lineExtensionAmount: 200,
      taxExclusiveAmount: 200,
      taxInclusiveAmount: 215,
      payableAmount: 215,
    },
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<SubmissionRequest> = {},
): SubmissionRequest {
  return {
    invoiceId: 'invoice-1',
    tenantId: TENANT_ID,
    platformIrn: 'INV0001-SVC00001-20260115',
    adapterKey: 'interswitch',
    payload: { invoice: makeInvoice() },
    ...overrides,
  };
}

describe('InterswitchAdapter', () => {
  let prisma: { asAdmin: jest.Mock; __tenant: any };
  let credentialService: { decrypt: jest.Mock };
  let secretsService: { getMasterEncryptionKey: jest.Mock };
  let adapter: InterswitchAdapter;
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    const tenantRow = makeTenantRow();
    prisma = {
      asAdmin: jest.fn().mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest.fn().mockResolvedValue(tenantRow),
          },
        }),
      ),
      __tenant: tenantRow,
    };
    credentialService = {
      decrypt: jest
        .fn()
        .mockReturnValueOnce('decrypted-api-key')
        .mockReturnValueOnce('decrypted-api-secret'),
    };
    secretsService = {
      getMasterEncryptionKey: jest.fn().mockResolvedValue(MASTER_KEY),
    };
    adapter = new InterswitchAdapter(
      prisma as any,
      credentialService as any,
      secretsService as any,
    );
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  describe('submit', () => {
    it('returns MISSING_CREDENTIALS without calling the network when NRS credentials are unset', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(makeTenantRow({ nrsApiKey: null })),
          },
        }),
      );
      global.fetch = jest.fn();

      const result = await adapter.submit(makeRequest());

      expect(result).toEqual({
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        errorMessage: 'NRS API credentials not configured for this tenant',
        retryable: false,
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('posts to the sandbox URL and returns a success result with the FIRS IRN/QR code on 201', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        status: 201,
        text: async () =>
          JSON.stringify({
            code: 200,
            message: 'ok',
            data: {
              IRN: 'FIRS-IRN-999',
              PostingDateTime: '2026-01-15T10:00:00Z',
              QRCodeData: 'qr-base64-data',
            },
          }),
      });
      global.fetch = fetchMock;

      const result = await adapter.submit(makeRequest());

      expect(result.success).toBe(true);
      expect(result.firsConfirmedIrn).toBe('FIRS-IRN-999');
      expect(result.qrCodeBase64).toBe('qr-base64-data');
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://qa.interswitchgroup.com/Api/SwitchTax/postInvoice',
      );
    });

    it('posts to the production URL when the tenant environment is PRODUCTION', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(makeTenantRow({ environment: 'PRODUCTION' })),
          },
        }),
      );
      const fetchMock = jest.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            message: 'ok',
            data: { IRN: 'FIRS-IRN-1', PostingDateTime: 'x', QRCodeData: 'qr' },
          }),
      });
      global.fetch = fetchMock;

      await adapter.submit(makeRequest());

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://api.interswitchgroup.com/Api/SwitchTax/postInvoice',
      );
    });

    it('decrypts stored credentials using the requesting tenantId', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            message: 'ok',
            data: { IRN: 'IRN', PostingDateTime: 'x', QRCodeData: 'qr' },
          }),
      });

      await adapter.submit(makeRequest());

      expect(credentialService.decrypt).toHaveBeenNthCalledWith(
        1,
        Buffer.from('enc-key'),
        Buffer.from('iv-key'),
        MASTER_KEY,
        TENANT_ID,
      );
      expect(credentialService.decrypt).toHaveBeenNthCalledWith(
        2,
        Buffer.from('enc-secret'),
        Buffer.from('iv-secret'),
        MASTER_KEY,
        TENANT_ID,
      );
    });

    it('builds a payload with FIRS invoice type codes and normalised tax category ids', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            message: 'ok',
            data: { IRN: 'IRN', PostingDateTime: 'x', QRCodeData: 'qr' },
          }),
      });
      global.fetch = fetchMock;

      await adapter.submit(makeRequest());

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);

      expect(body.invoice_type_code).toBe('381');
      expect(body.accounting_supplier_party.tin).toBe('SELLER-TIN-01');
      expect(body.accounting_customer_party.tin).toBe('BUYER-TIN-01');
      expect(body.tax_total[0].tax_subtotal[0].tax_category.id).toBe(
        'STANDARD_VAT',
      );
    });

    it('omits accounting_customer_party when the invoice has no buyerTin', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            message: 'ok',
            data: { IRN: 'IRN', PostingDateTime: 'x', QRCodeData: 'qr' },
          }),
      });
      global.fetch = fetchMock;

      await adapter.submit(
        makeRequest({
          payload: { invoice: makeInvoice({ buyerTin: undefined }) },
        }),
      );

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.accounting_customer_party).toBeUndefined();
    });

    it('defaults payment_means from the payment provider when the invoice has none stored', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            message: 'ok',
            data: { IRN: 'IRN', PostingDateTime: 'x', QRCodeData: 'qr' },
          }),
      });
      global.fetch = fetchMock;

      await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
              paymentProvider: 'PAYSTACK',
              paymentMeans: undefined,
            }),
          },
        }),
      );

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.payment_means).toEqual([
        { payment_means_code: '48', payment_due_date: '2026-02-15' },
      ]);
    });

    describe('error mapping (via a rejected postInvoice call)', () => {
      function mockNrsError(status: number, body: Record<string, any> = {}) {
        global.fetch = jest.fn().mockResolvedValue({
          status,
          text: async () => JSON.stringify(body),
        });
      }

      it('maps a 401 to a non-retryable INVALID_CREDENTIALS error', async () => {
        mockNrsError(401, { message: 'bad api key' });
        const result = await adapter.submit(makeRequest());
        expect(result).toMatchObject({
          success: false,
          errorCode: 'INVALID_CREDENTIALS',
          retryable: false,
        });
      });

      it('maps a 429 to a retryable RATE_LIMITED error', async () => {
        mockNrsError(429, { message: 'slow down' });
        const result = await adapter.submit(makeRequest());
        expect(result).toMatchObject({
          errorCode: 'RATE_LIMITED',
          retryable: true,
        });
      });

      it('maps a 500 to a retryable SERVER_ERROR', async () => {
        mockNrsError(500, { message: 'nrs down' });
        const result = await adapter.submit(makeRequest());
        expect(result).toMatchObject({
          errorCode: 'SERVER_ERROR',
          retryable: true,
        });
      });

      it('maps a 422 to a non-retryable SCHEMA_VALIDATION error', async () => {
        mockNrsError(422, { message: 'bad schema' });
        const result = await adapter.submit(makeRequest());
        expect(result).toMatchObject({
          errorCode: 'SCHEMA_VALIDATION',
          retryable: false,
        });
      });

      it('maps a 400 with duplicate-IRN details to IRN_DUPLICATE', async () => {
        mockNrsError(400, {
          message: 'irn error',
          details: 'duplicate IRN detected',
        });
        const result = await adapter.submit(makeRequest());
        expect(result.errorCode).toBe('IRN_DUPLICATE');
      });

      it('maps a 400 with business-id details to INVALID_BUSINESS_ID', async () => {
        mockNrsError(400, {
          message: 'x',
          details: 'invalid business identifier',
        });
        const result = await adapter.submit(makeRequest());
        expect(result.errorCode).toBe('INVALID_BUSINESS_ID');
      });

      it('maps a 400 with unmatched details to a generic VALIDATION_ERROR', async () => {
        mockNrsError(400, { message: 'x', details: 'something unrelated' });
        const result = await adapter.submit(makeRequest());
        expect(result.errorCode).toBe('VALIDATION_ERROR');
      });

      it('maps an unrecognised status to UNKNOWN_ERROR', async () => {
        mockNrsError(418, { message: 'teapot' });
        const result = await adapter.submit(makeRequest());
        expect(result.errorCode).toBe('UNKNOWN_ERROR');
      });

      it('maps a thrown AbortError to a retryable TIMEOUT', async () => {
        global.fetch = jest.fn().mockImplementation(() => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          return Promise.reject(err);
        });
        const result = await adapter.submit(makeRequest());
        expect(result).toMatchObject({ errorCode: 'TIMEOUT', retryable: true });
      });
    });
  });

  describe('checkStatus', () => {
    it('returns MISSING_TENANT_ID when tenantId is absent from tenantCredential', async () => {
      const result = await adapter.checkStatus('IRN-1', {});
      expect(result).toEqual({
        success: false,
        errorCode: 'MISSING_TENANT_ID',
        errorMessage: 'tenantId required for status check',
        retryable: false,
      });
    });

    it('returns MISSING_CREDENTIALS when the tenant has no NRS credentials configured', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(makeTenantRow({ nrsApiKey: null })),
          },
        }),
      );
      const result = await adapter.checkStatus('IRN-1', {
        tenantId: TENANT_ID,
      });
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('returns success when the NRS status endpoint reports the IRN as confirmed', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({ data: { IRN: 'IRN-CONFIRMED', QRCodeData: 'qr' } }),
      });

      const result = await adapter.checkStatus('IRN-1', {
        tenantId: TENANT_ID,
      });
      expect(result).toMatchObject({
        success: true,
        firsConfirmedIrn: 'IRN-CONFIRMED',
      });
    });

    it('returns a retryable STATUS_CHECK_FAILED for a 5xx response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 503,
        text: async () => '{}',
      });

      const result = await adapter.checkStatus('IRN-1', {
        tenantId: TENANT_ID,
      });
      expect(result).toMatchObject({
        success: false,
        errorCode: 'STATUS_CHECK_FAILED',
        retryable: true,
      });
    });

    it('returns a non-retryable STATUS_CHECK_FAILED for a 4xx response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 404,
        text: async () => '{}',
      });

      const result = await adapter.checkStatus('IRN-1', {
        tenantId: TENANT_ID,
      });
      expect(result).toMatchObject({
        success: false,
        errorCode: 'STATUS_CHECK_FAILED',
        retryable: false,
      });
    });

    it('returns a retryable TIMEOUT when the request aborts', async () => {
      global.fetch = jest.fn().mockImplementation(() => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const result = await adapter.checkStatus('IRN-1', {
        tenantId: TENANT_ID,
      });
      expect(result).toMatchObject({ errorCode: 'TIMEOUT', retryable: true });
    });

    it('returns a non-retryable STATUS_CHECK_ERROR for other thrown errors', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

      const result = await adapter.checkStatus('IRN-1', {
        tenantId: TENANT_ID,
      });
      expect(result).toMatchObject({
        errorCode: 'STATUS_CHECK_ERROR',
        errorMessage: 'network down',
        retryable: false,
      });
    });
  });

  describe('updatePaymentStatus', () => {
    it('does nothing (no network call) when NRS credentials are not configured', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(makeTenantRow({ nrsApiKey: null })),
          },
        }),
      );
      global.fetch = jest.fn();

      await adapter.updatePaymentStatus('IRN-1', TENANT_ID, 'PAID');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('posts the payment status and includes amount only for PARTIAL payments', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock;

      await adapter.updatePaymentStatus('IRN-1', TENANT_ID, 'PARTIAL', 500);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://qa.interswitchgroup.com/Api/SwitchTax/UpdateStatus',
      );
      expect(JSON.parse(init.body)).toEqual({
        irn: 'IRN-1',
        payment_status: 'PARTIAL',
        amount: 500,
      });
    });

    it('omits amount for a full PAID status', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock;

      await adapter.updatePaymentStatus('IRN-1', TENANT_ID, 'PAID');

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({
        irn: 'IRN-1',
        payment_status: 'PAID',
      });
    });

    it('does not throw when the NRS endpoint responds non-OK', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'server error',
      });

      await expect(
        adapter.updatePaymentStatus('IRN-1', TENANT_ID, 'PAID'),
      ).resolves.toBeUndefined();
    });

    it('does not throw when fetch itself rejects', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

      await expect(
        adapter.updatePaymentStatus('IRN-1', TENANT_ID, 'PAID'),
      ).resolves.toBeUndefined();
    });
  });

  describe('ping', () => {
    it('returns true for a non-5xx response', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 400 });
      await expect(adapter.ping()).resolves.toBe(true);
    });

    it('returns false for a 5xx response', async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 503 });
      await expect(adapter.ping()).resolves.toBe(false);
    });

    it('returns false when fetch throws', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('down'));
      await expect(adapter.ping()).resolves.toBe(false);
    });
  });
});
