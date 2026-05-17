# Developer Quickstart — Billinx Compliance API

Get from zero to your first FIRS-accepted invoice in under 10 minutes.

## Prerequisites

- Node.js 20+, PostgreSQL 15+, Redis 7+
- A FIRS TIN (Tax Identification Number) for your business
- Billinx API running locally (`npm run start:dev`) or a staging URL

---

## Step 1: Register Your Business

Create a tenant account. This registers your company and creates the OWNER user.

```bash
curl -X POST http://localhost:3000/v1/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Chidi",
    "lastName": "Okonkwo",
    "email": "chidi@acmeng.ng",
    "password": "SecurePass123!",
    "tenantName": "Acme Engineering Ltd",
    "tenantEmail": "hello@acmeng.ng",
    "tenantPhone": "+2348012345678",
    "tin": "12345678-0001"
  }'
```

**Expected response:**

```json
{
  "tenant": {
    "id": "ten_clx1234abcd",
    "name": "Acme Engineering Ltd",
    "tin": "12345678-0001",
    "environment": "sandbox"
  },
  "user": {
    "id": "usr_clx5678efgh",
    "email": "chidi@acmeng.ng",
    "role": "OWNER"
  }
}
```

Save the `tenant.id` — you will need it to log in.

---

## Step 2: Log In and Get Tokens

```bash
curl -X POST http://localhost:3000/v1/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "ten_clx1234abcd",
    "email": "chidi@acmeng.ng",
    "password": "SecurePass123!"
  }'
```

**Expected response:**

```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiJ9...",
  "refreshToken": "rt_abc123...",
  "expiresIn": 900
}
```

The `accessToken` is valid for 15 minutes. Use the `refreshToken` to get a new one.

---

## Step 3: Create an API Key

For programmatic invoice submission, use an API key rather than a JWT.

```bash
curl -X POST http://localhost:3000/v1/api-keys \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ERP Integration",
    "description": "Connects our Sage ERP to Billinx"
  }'
```

**Expected response:**

```json
{
  "id": "key_clxabc123",
  "name": "ERP Integration",
  "key": "blx_live_sk_abcdef1234567890abcdef1234567890",
  "createdAt": "2026-05-17T10:00:00.000Z"
}
```

**Important:** The `key` is only shown once. Store it securely (e.g., in AWS Secrets Manager or your CI/CD environment variables).

---

## Step 4: Validate an Invoice (Optional but Recommended)

Before submitting to FIRS, validate your invoice structure to catch errors early.

```bash
curl -X POST http://localhost:3000/v1/invoices/validate \
  -H "Authorization: Bearer blx_live_sk_abcdef1234567890abcdef1234567890" \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceTypeCode": "STANDARD",
    "invoiceKind": "B2B",
    "invoiceNumber": "INV-2026-001",
    "issueDate": "2026-05-17",
    "dueDate": "2026-06-17",
    "currency": "NGN",
    "seller": {
      "tin": "12345678-0001",
      "name": "Acme Engineering Ltd",
      "address": "45 Adeola Odeku Street, Victoria Island, Lagos",
      "phone": "+2348012345678",
      "email": "accounts@acmeng.ng"
    },
    "buyer": {
      "tin": "98765432-0001",
      "name": "Lagos State Government",
      "address": "The Secretariat, Alausa, Ikeja, Lagos"
    },
    "lineItems": [
      {
        "lineId": "1",
        "description": "Civil Engineering Consultancy Services",
        "quantity": 1,
        "unitPrice": 5000000.00,
        "lineExtensionAmount": 5000000.00,
        "hsnCode": "998311",
        "taxCategory": "STANDARD_VAT",
        "taxRate": 7.5
      }
    ],
    "taxTotal": {
      "taxAmount": 375000.00,
      "taxSubtotals": [
        {
          "taxCategory": "STANDARD_VAT",
          "taxRate": 7.5,
          "taxableAmount": 5000000.00,
          "taxAmount": 375000.00
        }
      ]
    },
    "legalMonetaryTotal": {
      "lineExtensionAmount": 5000000.00,
      "taxExclusiveAmount": 5000000.00,
      "taxInclusiveAmount": 5375000.00,
      "payableAmount": 5375000.00
    }
  }'
```

**Success response:**

```json
{
  "valid": true,
  "errors": []
}
```

**Failure response (example):**

```json
{
  "valid": false,
  "errors": [
    {
      "field": "taxTotal.taxAmount",
      "message": "taxAmount (400000) does not match sum of taxSubtotals (375000)"
    }
  ]
}
```

---

## Step 5: Submit an Invoice to FIRS

```bash
curl -X POST http://localhost:3000/v1/invoices \
  -H "Authorization: Bearer blx_live_sk_abcdef1234567890abcdef1234567890" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: inv-2026-001-submit-v1" \
  -d '{
    "invoiceTypeCode": "STANDARD",
    "invoiceKind": "B2B",
    "invoiceNumber": "INV-2026-001",
    "issueDate": "2026-05-17",
    "dueDate": "2026-06-17",
    "currency": "NGN",
    "seller": {
      "tin": "12345678-0001",
      "name": "Acme Engineering Ltd",
      "address": "45 Adeola Odeku Street, Victoria Island, Lagos",
      "phone": "+2348012345678",
      "email": "accounts@acmeng.ng"
    },
    "buyer": {
      "tin": "98765432-0001",
      "name": "Lagos State Government",
      "address": "The Secretariat, Alausa, Ikeja, Lagos",
      "phone": "+2349087654321",
      "email": "procurement@lasg.gov.ng"
    },
    "lineItems": [
      {
        "lineId": "1",
        "description": "Civil Engineering Consultancy Services",
        "quantity": 1,
        "unitPrice": 5000000.00,
        "lineExtensionAmount": 5000000.00,
        "hsnCode": "998311",
        "taxCategory": "STANDARD_VAT",
        "taxRate": 7.5
      },
      {
        "lineId": "2",
        "description": "Topographic Survey — Phase 1",
        "quantity": 2,
        "unitPrice": 750000.00,
        "lineExtensionAmount": 1500000.00,
        "hsnCode": "998312",
        "taxCategory": "STANDARD_VAT",
        "taxRate": 7.5
      }
    ],
    "taxTotal": {
      "taxAmount": 487500.00,
      "taxSubtotals": [
        {
          "taxCategory": "STANDARD_VAT",
          "taxRate": 7.5,
          "taxableAmount": 6500000.00,
          "taxAmount": 487500.00
        }
      ]
    },
    "legalMonetaryTotal": {
      "lineExtensionAmount": 6500000.00,
      "taxExclusiveAmount": 6500000.00,
      "taxInclusiveAmount": 6987500.00,
      "payableAmount": 6987500.00
    }
  }'
```

**Expected response (HTTP 201):**

```json
{
  "id": "inv_clxabc123def456",
  "irn": "BLX-20260517-ACME-0001",
  "status": "QUEUED",
  "invoiceNumber": "INV-2026-001",
  "issueDate": "2026-05-17",
  "legalMonetaryTotal": {
    "payableAmount": 6987500.00
  },
  "createdAt": "2026-05-17T10:05:00.000Z"
}
```

The invoice is now queued for submission to FIRS. Submission is asynchronous.

---

## Step 6: Check Invoice Status

Poll the status endpoint or use a webhook (see below) to know when FIRS processes your invoice.

```bash
curl http://localhost:3000/v1/invoices/inv_clxabc123def456/status \
  -H "Authorization: Bearer blx_live_sk_abcdef1234567890abcdef1234567890"
```

**Accepted response:**

```json
{
  "id": "inv_clxabc123def456",
  "status": "ACCEPTED",
  "irn": "BLX-20260517-ACME-0001",
  "firsConfirmedIrn": "FIRS-NG-20260517-001234",
  "qrCodeBase64": "data:image/png;base64,iVBOR...",
  "acceptedAt": "2026-05-17T10:05:30.000Z",
  "history": [
    { "status": "DRAFT", "changedAt": "2026-05-17T10:05:00.000Z" },
    { "status": "VALIDATING", "changedAt": "2026-05-17T10:05:01.000Z" },
    { "status": "QUEUED", "changedAt": "2026-05-17T10:05:02.000Z" },
    { "status": "SUBMITTING", "changedAt": "2026-05-17T10:05:10.000Z" },
    { "status": "ACCEPTED", "changedAt": "2026-05-17T10:05:30.000Z" }
  ]
}
```

Print the QR code on your invoice PDF and embed the `firsConfirmedIrn` for compliance.

---

## Bonus: Subscribe to Webhooks

Instead of polling, receive real-time notifications when invoices change state.

```bash
curl -X POST http://localhost:3000/v1/webhooks \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourapp.ng/webhooks/billinx",
    "events": ["invoice.accepted", "invoice.rejected"],
    "description": "Production invoice notifications"
  }'
```

Billinx will `POST` a signed JSON payload to your URL. Verify the signature using the `X-Billinx-Signature` header:

```javascript
const crypto = require('crypto');
const signature = req.headers['x-billinx-signature'];
const expectedSig = crypto
  .createHmac('sha256', YOUR_WEBHOOK_SIGNING_KEY)
  .update(JSON.stringify(req.body))
  .digest('hex');

if (signature !== `sha256=${expectedSig}`) {
  return res.status(401).send('Invalid signature');
}
```

---

## Invoice Type Reference

| `invoiceTypeCode` | Description |
|---|---|
| `STANDARD` | Standard tax invoice |
| `CREDIT_NOTE` | Reduces a previously issued invoice (requires `originalIrn`) |
| `DEBIT_NOTE` | Increases a previously issued invoice (requires `originalIrn`) |
| `PROFORMA` | Quote/proforma — not submitted to FIRS |

| `invoiceKind` | Description |
|---|---|
| `B2B` | Business to business |
| `B2C` | Business to consumer |
| `B2G` | Business to government |

## VAT Rate Reference (Nigeria FIRS)

| `taxCategory` | Rate | Description |
|---|---|---|
| `STANDARD_VAT` | 7.5% | Standard VAT rate in Nigeria |
| `ZERO_RATED` | 0% | Zero-rated supplies |
| `EXEMPT` | 0% | VAT-exempt supplies |

## Idempotency

All mutating endpoints (POST, PUT, PATCH) accept an `Idempotency-Key` header. If you send the same key within 24 hours, the original response is replayed — protecting against duplicate invoice submissions due to network retries.

```
Idempotency-Key: your-unique-key-per-operation
```

Use a UUID or a deterministic key like `${invoiceNumber}-submit-v1`.
