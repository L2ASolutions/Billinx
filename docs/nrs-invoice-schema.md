# NRS Invoice Schema Reference
## Billinx Integration — Complete Field Reference
### Last updated: May 2026

---

## Overview

The NRS invoice schema is based on the Universal Business Language (UBL) standard.
It supports both XML and JSON. Billinx uses the JSON format.

Validation endpoint: `POST base_url/api/v1/invoice/validate`

---

## Invoice Header Fields

| Field | Required | Type | Description | Example |
|-------|----------|------|-------------|---------|
| business_id | ✅ Yes | String | NRS-assigned UUID for the business | "6dj03c76-1d83-4a39-a4de-51bd70547aef" |
| irn | ✅ Yes | String | Invoice Reference Number | "INV001-94ND90NR-20240611" |
| issue_date | ✅ Yes | Date | Invoice issue date YYYY-MM-DD | "2024-05-14" |
| invoice_type_code | ✅ Yes | String | Invoice type (see codes) | "381" |
| invoice_kind | ✅ Yes | String | B2B, B2C, or B2G | "B2B" |
| document_currency_code | ✅ Yes | String | ISO currency code | "NGN" |
| tax_currency_code | ✅ Yes | String | Tax currency code | "NGN" |
| accounting_supplier_party | ✅ Yes | Object | Seller details | See below |
| tax_total | ✅ Yes | Array | Tax information | See below |
| legal_monetary_total | ✅ Yes | Object | Invoice totals | See below |
| invoice_line | ✅ Yes | Array | Line items | See below |
| due_date | ❌ No | Date | Payment due date YYYY-MM-DD | "2024-06-14" |
| issue_time | ❌ No | String | Issue time HH:MM:SS | "17:59:04" |
| payment_status | ❌ No | String | PAID or PENDING (default: PENDING) | "PENDING" |
| note | ❌ No | String | Free text note (encrypted in storage) | "Includes 5% discount" |
| tax_point_date | ❌ No | Date | Date tax becomes applicable | "2024-05-14" |
| accounting_cost | ❌ No | String | Cost centre / accounting category | "2000 NGN" |
| buyer_reference | ❌ No | String | Buyer's reference number | "PO-2024-001" |
| order_reference | ❌ No | String | Order number | "ORD-2024-001" |
| actual_delivery_date | ❌ No | Date | Date goods/services delivered | "2024-05-14" |
| payment_terms_note | ❌ No | String | Payment terms description | "Payment due within 30 days" |
| accounting_customer_party | ❌ No | Object | Buyer details (required if B2B with TIN) | See below |
| payee_party | ❌ No | Object | Party receiving payment if different | See below |
| bill_party | ❌ No | Object | Billing party if different | See below |
| ship_party | ❌ No | Object | Shipping party | See below |
| tax_representative_party | ❌ No | Object | Tax agent details | See below |
| invoice_delivery_period | ❌ No | Object | Delivery start and end dates | See below |
| billing_reference | ❌ No | Array | Links to previous invoices (credit notes) | See below |
| payment_means | ❌ No | Array | Payment methods and due dates | See below |
| allowance_charge | ❌ No | Array | Discounts and surcharges | See below |
| dispatch_document_reference | ❌ No | Object | Despatch advice reference | See below |
| receipt_document_reference | ❌ No | Object | Receipt advice reference | See below |
| originator_document_reference | ❌ No | Object | Original document reference | See below |
| contract_document_reference | ❌ No | Object | Contract reference | See below |
| additional_document_reference | ❌ No | Array | Additional related documents | See below |

---

## Party Object (Supplier, Customer, Payee, Bill, Ship)

Used for: `accounting_supplier_party`, `accounting_customer_party`, `payee_party`, `bill_party`, `ship_party`, `tax_representative_party`

```json
{
  "party_name": "ABC Cement Ltd",
  "tin": "RN-847789",
  "email": "supplier@business.com",
  "telephone": "+23480254099000",
  "business_description": "Cement and building materials",
  "postal_address": {
    "street_name": "32, Owonikoko Street",
    "city_name": "Ikeja",
    "postal_zone": "023401",
    "lga": "NG-LA-IKJ",
    "state": "NG-LA",
    "country": "NG"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| party_name | ✅ Yes | Business name |
| tin | ✅ Yes | Tax Identification Number |
| email | ✅ Yes | Business email |
| telephone | ❌ No | Must start with + (country code) |
| business_description | ❌ No | Business description |
| postal_address.street_name | ✅ Yes | Street address |
| postal_address.city_name | ✅ Yes | City |
| postal_address.postal_zone | ❌ No | Postal code |
| postal_address.lga | ❌ No | LGA code e.g. NG-AB-ANO |
| postal_address.state | ❌ No | State code e.g. NG-AB |
| postal_address.country | ✅ Yes | ISO 3166-1 alpha-2 e.g. NG |

---

## Tax Total

```json
"tax_total": [
  {
    "tax_amount": 37500.00,
    "tax_subtotal": [
      {
        "taxable_amount": 500000.00,
        "tax_amount": 37500.00,
        "tax_category": {
          "id": "STANDARD_VAT",
          "percent": 7.50
        }
      }
    ]
  }
]
```

| Field | Required | Description |
|-------|----------|-------------|
| tax_amount | ✅ Yes | Total tax amount |
| tax_subtotal[].taxable_amount | ✅ Yes | Amount subject to tax |
| tax_subtotal[].tax_amount | ✅ Yes | Tax amount for this subtotal |
| tax_subtotal[].tax_category.id | ✅ Yes | Tax category code (see full list) |
| tax_subtotal[].tax_category.percent | ✅ Yes | Tax rate percentage |

---

## Legal Monetary Total

```json
"legal_monetary_total": {
  "line_extension_amount": 500000.00,
  "tax_exclusive_amount": 500000.00,
  "tax_inclusive_amount": 537500.00,
  "payable_amount": 537500.00
}
```

| Field | Required | Description |
|-------|----------|-------------|
| line_extension_amount | ✅ Yes | Sum of all line amounts |
| tax_exclusive_amount | ✅ Yes | Total before tax |
| tax_inclusive_amount | ✅ Yes | Total after tax |
| payable_amount | ✅ Yes | Final payable amount |

---

## Invoice Line Items

```json
"invoice_line": [
  {
    "hsn_code": "CC-001",
    "product_category": "Food and Beverages",
    "invoiced_quantity": 1000.00,
    "line_extension_amount": 500000.00,
    "discount_rate": 0.00,
    "discount_amount": 0.00,
    "fee_rate": 0.00,
    "fee_amount": 0.00,
    "item": {
      "name": "Premium Cement Bags",
      "description": "50kg bags of premium cement",
      "sellers_item_identification": "CC-001"
    },
    "price": {
      "price_amount": 500.00,
      "base_quantity": 1,
      "price_unit": "NGN per 1"
    }
  }
]
```

| Field | Required | Description |
|-------|----------|-------------|
| hsn_code | ✅ Yes | HS/product classification code |
| product_category | ✅ Yes | Product category description |
| invoiced_quantity | ✅ Yes | Quantity invoiced |
| line_extension_amount | ✅ Yes | Line total (qty × price) |
| item.name | ✅ Yes | Item name |
| item.description | ❌ No | Item description |
| item.sellers_item_identification | ❌ No | Seller's item ID |
| price.price_amount | ✅ Yes | Unit price |
| price.base_quantity | ✅ Yes | Base quantity for price |
| price.price_unit | ✅ Yes | Price unit e.g. "NGN per 1" |
| discount_rate | ❌ No | Discount percentage |
| discount_amount | ❌ No | Discount amount |
| fee_rate | ❌ No | Fee percentage |
| fee_amount | ❌ No | Fee amount |

---

## Optional Complex Fields

### Invoice Delivery Period
```json
"invoice_delivery_period": {
  "start_date": "2024-06-14",
  "end_date": "2024-06-16"
}
```

### Billing Reference (Credit Notes)
```json
"billing_reference": [
  {
    "irn": "INV001-94ND90NR-20240601",
    "issue_date": "2024-06-01"
  }
]
```

### Payment Means
```json
"payment_means": [
  {
    "payment_means_code": "30",
    "payment_due_date": "2024-06-14"
  }
]
```

### Allowance and Charge
```json
"allowance_charge": [
  {
    "charge_indicator": true,
    "amount": 800.60
  },
  {
    "charge_indicator": false,
    "amount": 10.00
  }
]
```
Note: `charge_indicator: true` = surcharge, `false` = discount

### Document References
All follow the same structure:
```json
{
  "irn": "ITW001-E9E0C0D3-20240619",
  "issue_date": "2024-05-14"
}
```

---

## Billinx Field Mapping

How Billinx internal fields map to NRS schema fields:

| Billinx Field | NRS Field | Notes |
|---------------|-----------|-------|
| tenant.nrsBusinessId | business_id | Per tenant, from NRS registration |
| invoice.platformIrn | irn | Generated by Billinx |
| invoice.issueDate | issue_date | |
| invoice.issueTime | issue_time | New field — add to schema |
| invoice.dueDate | due_date | Already added |
| invoice.invoiceTypeCode | invoice_type_code | |
| invoice.invoiceKind | invoice_kind | Already added |
| invoice.paymentStatus | payment_status | Already added |
| invoice.currency | document_currency_code | |
| invoice.note | note | New field — add to schema |
| invoice.taxPointDate | tax_point_date | Already added |
| invoice.accountingCost | accounting_cost | New field |
| invoice.buyerReference | buyer_reference | New field |
| invoice.orderReference | order_reference | New field |
| invoice.actualDeliveryDate | actual_delivery_date | New field |
| invoice.paymentTermsNote | payment_terms_note | New field |
| invoice.paymentMeans | payment_means | New field (Json) |
| invoice.allowanceCharge | allowance_charge | New field (Json) |
| invoice.invoiceDeliveryPeriod | invoice_delivery_period | New field (Json) |
| invoice.seller | accounting_supplier_party | |
| invoice.buyer | accounting_customer_party | |
| seller.postalAddress.lga | postal_address.lga | New field |
| seller.postalAddress.state | postal_address.state | New field |
| buyer.postalAddress.lga | postal_address.lga | New field |
| buyer.postalAddress.state | postal_address.state | New field |
| lineItem.productCategory | product_category | Already added |
| lineItem.price.baseQuantity | price.base_quantity | Already added |
| lineItem.price.priceUnit | price.price_unit | Already added |
| lineItem.feeRate | fee_rate | New field |
| lineItem.feeAmount | fee_amount | New field |

---

## Complete Request Example

```json
{
  "business_id": "6dj03c76-1d83-4a39-a4de-51bd70547aef",
  "irn": "INV001-94ND90NR-20240611",
  "issue_date": "2024-05-14",
  "due_date": "2024-06-14",
  "issue_time": "17:59:04",
  "invoice_type_code": "381",
  "invoice_kind": "B2B",
  "payment_status": "PENDING",
  "document_currency_code": "NGN",
  "tax_currency_code": "NGN",
  "accounting_supplier_party": {
    "party_name": "Dangote Group",
    "tin": "TIN-000001",
    "email": "invoices@dangote.com",
    "telephone": "+2348012345678",
    "business_description": "Cement and building materials",
    "postal_address": {
      "street_name": "32 Owonikoko Street",
      "city_name": "Gwarikpa",
      "postal_zone": "900108",
      "lga": "NG-FC-AWU",
      "state": "NG-FC",
      "country": "NG"
    }
  },
  "accounting_customer_party": {
    "party_name": "TechCorp Nigeria",
    "tin": "NG-TECH-001",
    "email": "accounts@techcorp.ng",
    "telephone": "+2348098765432",
    "postal_address": {
      "street_name": "15 Adeola Odeku",
      "city_name": "Victoria Island",
      "postal_zone": "101241",
      "lga": "NG-LA-ETI",
      "state": "NG-LA",
      "country": "NG"
    }
  },
  "invoice_line": [
    {
      "hsn_code": "CC-001",
      "product_category": "Cement and Building Materials",
      "invoiced_quantity": 10,
      "line_extension_amount": 100000.00,
      "discount_rate": 0,
      "discount_amount": 0,
      "fee_rate": 0,
      "fee_amount": 0,
      "item": {
        "name": "Premium Cement Bags",
        "description": "High quality cement 50kg bags",
        "sellers_item_identification": "CC-001"
      },
      "price": {
        "price_amount": 10000.00,
        "base_quantity": 1,
        "price_unit": "NGN per 1"
      }
    }
  ],
  "tax_total": [
    {
      "tax_amount": 7500.00,
      "tax_subtotal": [
        {
          "taxable_amount": 100000.00,
          "tax_amount": 7500.00,
          "tax_category": {
            "id": "STANDARD_VAT",
            "percent": 7.5
          }
        }
      ]
    }
  ],
  "legal_monetary_total": {
    "line_extension_amount": 100000.00,
    "tax_exclusive_amount": 100000.00,
    "tax_inclusive_amount": 107500.00,
    "payable_amount": 107500.00
  }
}
```

---

## Response on Success

```json
{
  "code": 201,
  "message": "Transmitted successfully",
  "data": {
    "IRN": "INV001-94ND90NR-20240611",
    "PostingDateTime": "2024-06-11 14:32:01",
    "QRCodeData": "Base64EncodedQRCode..."
  }
}
```

Store `QRCodeData` as `qrCodeBase64` on the invoice record.
The QR code must appear on every printed invoice.
