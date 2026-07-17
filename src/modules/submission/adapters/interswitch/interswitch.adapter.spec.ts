/// <reference types="jest" />

import { InterswitchAdapter } from './interswitch.adapter';
import { SubmissionRequest } from '../../../../../packages/types/submission';

const TENANT_ID = 'tenant-1';
const MASTER_KEY = Buffer.from('master-key');
const VALID_BUSINESS_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Mirrors the adapter's private OAUTH_TOKEN_TTL_MS / OAUTH_TOKEN_REFRESH_MARGIN_MS.
const OAUTH_TOKEN_TTL_MS = 3600 * 1000;
const OAUTH_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

function makeTenantRow(overrides: Record<string, any> = {}) {
  return {
    id: TENANT_ID,
    environment: 'SANDBOX',
    interswitchBusinessId: VALID_BUSINESS_ID,
    interswitchClientId: 'client-id-123',
    interswitchClientSecret: Buffer.from('enc-secret'),
    interswitchSecretIv: Buffer.from('iv-secret'),
    interswitchServiceId: 'SVC001',
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

function tokenResponse(token = 'access-token-xyz') {
  return {
    status: 200,
    ok: true,
    text: async () => JSON.stringify({ data: { Token: token } }),
  };
}

function successResponse(overrides: Record<string, any> = {}) {
  return {
    status: 201,
    ok: true,
    text: async () =>
      JSON.stringify({
        code: 200,
        message: 'ok',
        data: {
          IRN: 'FIRS-IRN-999',
          PostingDateTime: '2026-01-15T10:00:00Z',
          QRCodeData: 'qr-base64-data',
          ...overrides,
        },
      }),
  };
}

// Dispatches by URL so tests don't have to reason about call ordering between
// the OAuth token fetch and the actual NRS action call.
function makeFetchMock(routes: {
  token?: any;
  postInvoice?: any;
  transmit?: any;
  updateStatus?: any;
}) {
  return jest.fn().mockImplementation((url: string) => {
    if (url.includes('/Api/SwitchTax/Token')) {
      return Promise.resolve(routes.token ?? tokenResponse());
    }
    if (url.includes('/Api/SwitchTax/postInvoice')) {
      return Promise.resolve(routes.postInvoice ?? successResponse());
    }
    if (url.includes('/Api/SwitchTax/transmit/')) {
      return Promise.resolve(routes.transmit);
    }
    if (url.includes('/Api/SwitchTax/UpdateStatus')) {
      return Promise.resolve(routes.updateStatus);
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe('InterswitchAdapter', () => {
  let prisma: { asAdmin: jest.Mock; __tenant: any; __originalInvoice: any };
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
          invoice: {
            findFirst: jest
              .fn()
              .mockImplementation(() =>
                Promise.resolve(prisma.__originalInvoice),
              ),
          },
        }),
      ),
      __tenant: tenantRow,
      __originalInvoice: { issueDate: '2026-01-01' },
    };
    credentialService = {
      decrypt: jest.fn().mockReturnValue('decrypted-client-secret'),
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
    it('returns MISSING_BUSINESS_ID without calling the network when business_id is unset', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(
                makeTenantRow({ interswitchBusinessId: null }),
              ),
          },
          invoice: { findFirst: jest.fn() },
        }),
      );
      global.fetch = jest.fn();

      const result = await adapter.submit(makeRequest());

      expect(result).toEqual({
        success: false,
        errorCode: 'MISSING_BUSINESS_ID',
        errorMessage:
          'NRS business_id not configured for this tenant — contact your administrator',
        retryable: false,
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns MISSING_BUSINESS_ID when business_id is not a UUID', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(
                makeTenantRow({ interswitchBusinessId: 'BIZ-001' }),
              ),
          },
          invoice: { findFirst: jest.fn() },
        }),
      );
      global.fetch = jest.fn();

      const result = await adapter.submit(makeRequest());

      expect(result.errorCode).toBe('MISSING_BUSINESS_ID');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns MISSING_CREDENTIALS without calling the network when OAuth credentials are unset', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(makeTenantRow({ interswitchClientId: null })),
          },
          invoice: { findFirst: jest.fn() },
        }),
      );
      global.fetch = jest.fn();

      const result = await adapter.submit(makeRequest());

      expect(result).toEqual({
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        errorMessage: 'NRS OAuth credentials not configured for this tenant',
        retryable: false,
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('posts to the sandbox URL and returns a success result with the FIRS IRN/QR code on 201', async () => {
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      const result = await adapter.submit(makeRequest());

      expect(result.success).toBe(true);
      expect(result.firsConfirmedIrn).toBe('FIRS-IRN-999');
      expect(result.qrCodeBase64).toBe('qr-base64-data');

      const postCall = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      expect(postCall[0]).toBe(
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
          invoice: { findFirst: jest.fn() },
        }),
      );
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(makeRequest());

      const tokenCall = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/Token'),
      );
      const postCall = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      expect(tokenCall[0]).toBe(
        'https://api.interswitchgroup.com/Api/SwitchTax/Token',
      );
      expect(postCall[0]).toBe(
        'https://api.interswitchgroup.com/Api/SwitchTax/postInvoice',
      );
    });

    it('fetches an OAuth token with ClientId/ClientSecret and sends it as a Bearer token on postInvoice', async () => {
      const fetchMock = makeFetchMock({
        token: tokenResponse('the-access-token'),
        postInvoice: successResponse(),
      });
      global.fetch = fetchMock;

      await adapter.submit(makeRequest());

      const [tokenUrl, tokenInit] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/Token'),
      );
      expect(tokenUrl).toBe(
        'https://qa.interswitchgroup.com/Api/SwitchTax/Token',
      );
      expect(JSON.parse(tokenInit.body)).toEqual({
        ClientId: 'client-id-123',
        ClientSecret: 'decrypted-client-secret',
      });

      const [, postInit] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      expect(postInit.headers.Authorization).toBe('Bearer the-access-token');
    });

    it('decrypts the client secret using the requesting tenantId', async () => {
      global.fetch = makeFetchMock({ postInvoice: successResponse() });

      await adapter.submit(makeRequest());

      expect(credentialService.decrypt).toHaveBeenCalledWith(
        Buffer.from('enc-secret'),
        Buffer.from('iv-secret'),
        MASTER_KEY,
        TENANT_ID,
      );
    });

    it('reuses a cached token across calls within the TTL', async () => {
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(makeRequest());
      now += 5_000;
      await adapter.submit(makeRequest());

      const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
        url.includes('/Api/SwitchTax/Token'),
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it('refetches the token once past the refresh margin', async () => {
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(makeRequest());
      now += OAUTH_TOKEN_TTL_MS - OAUTH_TOKEN_REFRESH_MARGIN_MS + 1;
      await adapter.submit(makeRequest());

      const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
        url.includes('/Api/SwitchTax/Token'),
      );
      expect(tokenCalls).toHaveLength(2);
    });

    it('builds a payload with FIRS invoice type codes and normalised tax category ids', async () => {
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(makeRequest());

      const [, init] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      const body = JSON.parse(init.body);

      expect(body.business_id).toBe(VALID_BUSINESS_ID);
      expect(body.invoice_type_code).toBe('381');
      expect(body.accounting_supplier_party.tin).toBe('SELLER-TIN-01');
      expect(body.accounting_customer_party.tin).toBe('BUYER-TIN-01');
      expect(body.tax_total[0].tax_subtotal[0].tax_category.id).toBe(
        'STANDARD_VAT',
      );
    });

    it('normalises WHT and Stamp Duty aliases to their exact-case NRS values', async () => {
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
              taxTotal: [
                {
                  taxAmount: 15,
                  taxSubtotal: [
                    {
                      taxableAmount: 200,
                      taxAmount: 15,
                      taxCategory: { id: 'WHT', percent: 5 },
                    },
                    {
                      taxableAmount: 200,
                      taxAmount: 5,
                      taxCategory: { id: 'STAMP_DUTY', percent: 1 },
                    },
                  ],
                },
              ],
            }),
          },
        }),
      );

      const [, init] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      const body = JSON.parse(init.body);
      expect(body.tax_total[0].tax_subtotal[0].tax_category.id).toBe(
        'Withholding_Tax',
      );
      expect(body.tax_total[0].tax_subtotal[1].tax_category.id).toBe(
        'Stamp_Duty',
      );
    });

    it('rejects an unrecognized tax category id with a non-retryable INVALID_TAX_CATEGORY', async () => {
      global.fetch = makeFetchMock({ postInvoice: successResponse() });

      const result = await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
              taxTotal: [
                {
                  taxAmount: 15,
                  taxSubtotal: [
                    {
                      taxableAmount: 200,
                      taxAmount: 15,
                      taxCategory: { id: 'BOGUS', percent: 7.5 },
                    },
                  ],
                },
              ],
            }),
          },
        }),
      );

      expect(result).toMatchObject({
        success: false,
        errorCode: 'INVALID_TAX_CATEGORY',
        retryable: false,
      });
    });

    it('rejects an unrecognized invoice_type_code with a non-retryable error', async () => {
      global.fetch = makeFetchMock({ postInvoice: successResponse() });

      const result = await adapter.submit(
        makeRequest({
          payload: { invoice: makeInvoice({ invoiceTypeCode: 'BOGUS' }) },
        }),
      );

      expect(result).toMatchObject({
        success: false,
        errorCode: 'INVALID_INVOICE_TYPE_CODE',
        retryable: false,
      });
    });

    it('requires invoice_kind to be one of B2B/B2C/B2G', async () => {
      global.fetch = makeFetchMock({ postInvoice: successResponse() });

      const result = await adapter.submit(
        makeRequest({
          payload: { invoice: makeInvoice({ invoiceKind: undefined }) },
        }),
      );

      expect(result).toMatchObject({
        success: false,
        errorCode: 'MISSING_INVOICE_KIND',
        retryable: false,
      });
    });

    it('requires every legal_monetary_total field to be present and greater than zero', async () => {
      global.fetch = makeFetchMock({ postInvoice: successResponse() });

      const result = await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
              legalMonetaryTotal: {
                lineExtensionAmount: 200,
                taxExclusiveAmount: 200,
                taxInclusiveAmount: 0,
                payableAmount: 215,
              },
            }),
          },
        }),
      );

      expect(result).toMatchObject({
        success: false,
        errorCode: 'INVALID_LEGAL_MONETARY_TOTAL',
        retryable: false,
      });
    });

    it('classifies a PRODUCT line item and requires hsn_code + product_category', async () => {
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(makeRequest());

      const [, init] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      const body = JSON.parse(init.body);
      expect(body.invoice_line[0].hsn_code).toBe('1234');
      expect(body.invoice_line[0].product_category).toBe('Widgets');
    });

    it('rejects a PRODUCT line item missing hsn_code or product_category', async () => {
      global.fetch = makeFetchMock({ postInvoice: successResponse() });

      const result = await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
              lineItems: [
                {
                  invoicedQuantity: 1,
                  lineExtensionAmount: 100,
                  item: { name: 'Widget' },
                  price: { priceAmount: 100 },
                },
              ],
            }),
          },
        }),
      );

      expect(result).toMatchObject({
        success: false,
        errorCode: 'MISSING_PRODUCT_CLASSIFICATION',
        retryable: false,
      });
    });

    it('classifies a SERVICE line item using isic_code + service_category', async () => {
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
              lineItems: [
                {
                  itemType: 'SERVICE',
                  isicCode: '6201',
                  serviceCategory: 'Software Consulting',
                  invoicedQuantity: 1,
                  lineExtensionAmount: 500,
                  item: { name: 'Consulting' },
                  price: { priceAmount: 500 },
                },
              ],
            }),
          },
        }),
      );

      const [, init] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      const body = JSON.parse(init.body);
      expect(body.invoice_line[0].isic_code).toBe('6201');
      expect(body.invoice_line[0].service_category).toBe('Software Consulting');
      expect(body.invoice_line[0].hsn_code).toBeUndefined();
    });

    it('rejects a SERVICE line item missing isic_code or service_category', async () => {
      global.fetch = makeFetchMock({ postInvoice: successResponse() });

      const result = await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
              lineItems: [
                {
                  itemType: 'SERVICE',
                  invoicedQuantity: 1,
                  lineExtensionAmount: 500,
                  item: { name: 'Consulting' },
                  price: { priceAmount: 500 },
                },
              ],
            }),
          },
        }),
      );

      expect(result).toMatchObject({
        success: false,
        errorCode: 'MISSING_SERVICE_CLASSIFICATION',
        retryable: false,
      });
    });

    it('defaults price_unit to EA and accepts KGM/LTR', async () => {
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
              lineItems: [
                {
                  hsnCode: '1234',
                  productCategory: 'Widgets',
                  invoicedQuantity: 2,
                  lineExtensionAmount: 200,
                  item: { name: 'Widget' },
                  price: { priceAmount: 100, priceUnit: 'kgm' },
                },
              ],
            }),
          },
        }),
      );

      const [, init] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      const body = JSON.parse(init.body);
      expect(body.invoice_line[0].price.price_unit).toBe('KGM');
    });

    it('rejects an unrecognized price_unit', async () => {
      global.fetch = makeFetchMock({ postInvoice: successResponse() });

      const result = await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
              lineItems: [
                {
                  hsnCode: '1234',
                  productCategory: 'Widgets',
                  invoicedQuantity: 2,
                  lineExtensionAmount: 200,
                  item: { name: 'Widget' },
                  price: { priceAmount: 100, priceUnit: 'BAG' },
                },
              ],
            }),
          },
        }),
      );

      expect(result).toMatchObject({
        success: false,
        errorCode: 'INVALID_PRICE_UNIT',
        retryable: false,
      });
    });

    it('auto-generates a line item description when none is supplied', async () => {
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(
        makeRequest({
          payload: {
            invoice: makeInvoice({
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
            }),
          },
        }),
      );

      const [, init] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      const body = JSON.parse(init.body);
      expect(body.invoice_line[0].item.description).toBe(
        '2.00 EA at 100.00 each',
      );
    });

    it('omits accounting_customer_party when the invoice has no buyerTin', async () => {
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
      global.fetch = fetchMock;

      await adapter.submit(
        makeRequest({
          payload: { invoice: makeInvoice({ buyerTin: undefined }) },
        }),
      );

      const [, init] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      const body = JSON.parse(init.body);
      expect(body.accounting_customer_party).toBeUndefined();
    });

    it('defaults payment_means from the payment provider when the invoice has none stored', async () => {
      const fetchMock = makeFetchMock({ postInvoice: successResponse() });
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

      const [, init] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/postInvoice'),
      );
      const body = JSON.parse(init.body);
      expect(body.payment_means).toEqual([
        { payment_means_code: '48', payment_due_date: '2026-02-15' },
      ]);
    });

    describe('credit/debit note billing_reference', () => {
      it('auto-derives billing_reference from the original invoice for a credit note', async () => {
        prisma.__originalInvoice = { issueDate: '2026-01-02' };
        const fetchMock = makeFetchMock({ postInvoice: successResponse() });
        global.fetch = fetchMock;

        await adapter.submit(
          makeRequest({
            payload: {
              invoice: makeInvoice({
                invoiceTypeCode: 'CREDIT_NOTE',
                originalIrn: 'ORIGINAL-IRN-1',
              }),
            },
          }),
        );

        const [, init] = fetchMock.mock.calls.find(([url]) =>
          url.includes('/Api/SwitchTax/postInvoice'),
        );
        const body = JSON.parse(init.body);
        expect(body.billing_reference).toEqual([
          { irn: 'ORIGINAL-IRN-1', issue_date: '2026-01-02' },
        ]);
      });

      it('requires originalIrn for a credit/debit note', async () => {
        global.fetch = makeFetchMock({ postInvoice: successResponse() });

        const result = await adapter.submit(
          makeRequest({
            payload: {
              invoice: makeInvoice({
                invoiceTypeCode: 'DEBIT_NOTE',
                originalIrn: undefined,
              }),
            },
          }),
        );

        expect(result).toMatchObject({
          success: false,
          errorCode: 'MISSING_ORIGINAL_IRN',
          retryable: false,
        });
      });

      it('returns ORIGINAL_INVOICE_NOT_FOUND when the referenced original cannot be located', async () => {
        prisma.__originalInvoice = null;
        global.fetch = makeFetchMock({ postInvoice: successResponse() });

        const result = await adapter.submit(
          makeRequest({
            payload: {
              invoice: makeInvoice({
                invoiceTypeCode: 'CREDIT_NOTE',
                originalIrn: 'MISSING-IRN',
              }),
            },
          }),
        );

        expect(result).toMatchObject({
          success: false,
          errorCode: 'ORIGINAL_INVOICE_NOT_FOUND',
          retryable: false,
        });
      });

      it('passes through billingReference untouched for a STANDARD invoice', async () => {
        const fetchMock = makeFetchMock({ postInvoice: successResponse() });
        global.fetch = fetchMock;

        await adapter.submit(
          makeRequest({
            payload: {
              invoice: makeInvoice({
                billingReference: [
                  { irn: 'SOME-IRN', issue_date: '2026-01-01' },
                ],
              }),
            },
          }),
        );

        const [, init] = fetchMock.mock.calls.find(([url]) =>
          url.includes('/Api/SwitchTax/postInvoice'),
        );
        const body = JSON.parse(init.body);
        expect(body.billing_reference).toEqual([
          { irn: 'SOME-IRN', issue_date: '2026-01-01' },
        ]);
      });
    });

    describe('error mapping (via a rejected postInvoice call)', () => {
      function mockNrsError(status: number, body: Record<string, any> = {}) {
        global.fetch = makeFetchMock({
          postInvoice: { status, text: async () => JSON.stringify(body) },
        });
      }

      it('maps a 401 to a non-retryable INVALID_CREDENTIALS error', async () => {
        mockNrsError(401, { message: 'bad token' });
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
        global.fetch = jest.fn().mockImplementation((url: string) => {
          if (url.includes('/Api/SwitchTax/Token')) {
            return Promise.resolve(tokenResponse());
          }
          const err = new Error('aborted');
          err.name = 'AbortError';
          return Promise.reject(err);
        });
        const result = await adapter.submit(makeRequest());
        expect(result).toMatchObject({ errorCode: 'TIMEOUT', retryable: true });
      });

      it('maps a token-fetch failure through the same error mapping as postInvoice failures', async () => {
        global.fetch = jest.fn().mockImplementation((url: string) => {
          if (url.includes('/Api/SwitchTax/Token')) {
            return Promise.resolve({
              status: 401,
              text: async () =>
                JSON.stringify({ message: 'bad client secret' }),
            });
          }
          throw new Error('postInvoice should not be called');
        });

        const result = await adapter.submit(makeRequest());
        expect(result).toMatchObject({
          success: false,
          errorCode: 'INVALID_CREDENTIALS',
          retryable: false,
        });
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

    it('returns MISSING_CREDENTIALS when the tenant has no OAuth credentials configured', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(makeTenantRow({ interswitchClientId: null })),
          },
          invoice: { findFirst: jest.fn() },
        }),
      );
      const result = await adapter.checkStatus('IRN-1', {
        tenantId: TENANT_ID,
      });
      expect(result.errorCode).toBe('MISSING_CREDENTIALS');
    });

    it('fetches a token and sends it as a Bearer token on the transmit call', async () => {
      const fetchMock = makeFetchMock({
        token: tokenResponse('status-check-token'),
        transmit: {
          status: 200,
          text: async () =>
            JSON.stringify({
              data: { IRN: 'IRN-CONFIRMED', QRCodeData: 'qr' },
            }),
        },
      });
      global.fetch = fetchMock;

      const result = await adapter.checkStatus('IRN-1', {
        tenantId: TENANT_ID,
      });

      expect(result).toMatchObject({
        success: true,
        firsConfirmedIrn: 'IRN-CONFIRMED',
      });
      const [, transmitInit] = fetchMock.mock.calls.find(([url]) =>
        url.includes('/Api/SwitchTax/transmit/'),
      );
      expect(transmitInit.headers.Authorization).toBe(
        'Bearer status-check-token',
      );
    });

    it('returns a retryable STATUS_CHECK_FAILED for a 5xx response', async () => {
      global.fetch = makeFetchMock({
        transmit: { status: 503, text: async () => '{}' },
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
      global.fetch = makeFetchMock({
        transmit: { status: 404, text: async () => '{}' },
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
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('/Api/SwitchTax/Token')) {
          return Promise.resolve(tokenResponse());
        }
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
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('/Api/SwitchTax/Token')) {
          return Promise.resolve(tokenResponse());
        }
        return Promise.reject(new Error('network down'));
      });

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
    it('does nothing (no network call) when OAuth credentials are not configured', async () => {
      prisma.asAdmin.mockImplementation((fn: any) =>
        fn({
          tenant: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(makeTenantRow({ interswitchClientId: null })),
          },
          invoice: { findFirst: jest.fn() },
        }),
      );
      global.fetch = jest.fn();

      await adapter.updatePaymentStatus('IRN-1', TENANT_ID, 'PAID');

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('posts the payment status with a Bearer token and includes amount only for PARTIAL payments', async () => {
      const fetchMock = makeFetchMock({
        token: tokenResponse('update-status-token'),
        updateStatus: { ok: true },
      });
      global.fetch = fetchMock;

      await adapter.updatePaymentStatus('IRN-1', TENANT_ID, 'PARTIAL', 500);

      const [url, init] = fetchMock.mock.calls.find(([u]) =>
        u.includes('/Api/SwitchTax/UpdateStatus'),
      );
      expect(url).toBe(
        'https://qa.interswitchgroup.com/Api/SwitchTax/UpdateStatus',
      );
      expect(init.headers.Authorization).toBe('Bearer update-status-token');
      expect(JSON.parse(init.body)).toEqual({
        irn: 'IRN-1',
        payment_status: 'PARTIAL',
        amount: 500,
      });
    });

    it('omits amount for a full PAID status', async () => {
      const fetchMock = makeFetchMock({ updateStatus: { ok: true } });
      global.fetch = fetchMock;

      await adapter.updatePaymentStatus('IRN-1', TENANT_ID, 'PAID');

      const [, init] = fetchMock.mock.calls.find(([u]) =>
        u.includes('/Api/SwitchTax/UpdateStatus'),
      );
      expect(JSON.parse(init.body)).toEqual({
        irn: 'IRN-1',
        payment_status: 'PAID',
      });
    });

    it('does not throw when the NRS endpoint responds non-OK', async () => {
      global.fetch = makeFetchMock({
        updateStatus: {
          ok: false,
          status: 500,
          text: async () => 'server error',
        },
      });

      await expect(
        adapter.updatePaymentStatus('IRN-1', TENANT_ID, 'PAID'),
      ).resolves.toBeUndefined();
    });

    it('does not throw when the token fetch itself rejects', async () => {
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
