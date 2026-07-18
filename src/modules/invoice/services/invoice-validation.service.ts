import { Injectable, BadRequestException } from '@nestjs/common';
import {
  ValidationResponse,
  ValidationErrorItem,
} from '../../../../packages/types/invoice';

export type ValidationContext = 'CREATE' | 'VALIDATE' | 'SUBMIT';

export interface InvoiceValidationDto {
  invoiceTypeCode?: string;
  invoiceKind?: string;
  seller?: { tin?: string; partyName?: string };
  buyer?: { tin?: string; partyName?: string };
  issueDate?: string | Date;
  originalIrn?: string;
  lineItems?: any[];
  // Effective payable amount, resolved by the caller before passing in.
  totalAmount?: number;
  legalMonetaryTotal?: {
    lineExtensionAmount?: number;
    taxExclusiveAmount?: number;
    taxInclusiveAmount?: number;
    payableAmount?: number;
  };
  taxTotal?: any[];
  paymentStatus?: string;
}

const VALID_INVOICE_KINDS = new Set(['B2B', 'B2C', 'B2G']);

// Every invoiceTypeCode value InvoiceService.mapInvoiceTypeCode() recognises
// (NRS numeric codes, legacy aliases, and the stored enum names themselves).
// Anything outside this set would otherwise silently fall back to STANDARD
// there — this check rejects it before it ever reaches that fallback.
const VALID_INVOICE_TYPE_CODES = new Set([
  '381',
  '380',
  '384',
  '390',
  '385',
  '383',
  '325',
  'STANDARD',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'PROFORMA',
]);

const VALID_PAYMENT_STATUSES = new Set(['PENDING', 'PAID', 'PARTIAL']);

// Matches InterswitchAdapter's VALID_PRICE_UNITS.
const VALID_PRICE_UNITS = new Set(['EA', 'KGM', 'LTR']);

// Matches every alias InterswitchAdapter's normaliseTaxCategoryId() accepts
// (case-insensitively) — a value is valid here iff the adapter would
// successfully normalise it rather than throwing INVALID_TAX_CATEGORY.
const VALID_TAX_CATEGORY_ALIASES = new Set([
  'VAT',
  'S',
  'STANDARD_VAT',
  'Z',
  'ZERO',
  'ZERO_RATED',
  'ZERO_VAT',
  'WHT',
  'WITHHOLDING_TAX',
  'EXEMPT',
  'NOT_APPLICABLE',
  'EXEMPTED',
  'STAMP_DUTY',
  'STAMP',
  'SD',
]);

const LEGAL_MONETARY_TOTAL_FIELDS = [
  ['lineExtensionAmount', 'legalMonetaryTotal.lineExtensionAmount'],
  ['taxExclusiveAmount', 'legalMonetaryTotal.taxExclusiveAmount'],
  ['taxInclusiveAmount', 'legalMonetaryTotal.taxInclusiveAmount'],
  ['payableAmount', 'legalMonetaryTotal.payableAmount'],
] as const;

function isValidTaxCategoryId(id: string): boolean {
  return VALID_TAX_CATEGORY_ALIASES.has(id.toUpperCase());
}

function getLineItemType(item: any): 'PRODUCT' | 'SERVICE' {
  const raw = (item.itemType ?? item.item_type ?? 'PRODUCT')
    .toString()
    .toUpperCase();
  return raw === 'SERVICE' ? 'SERVICE' : 'PRODUCT';
}

function getLineItemPriceUnit(item: any): string | undefined {
  return item.price?.priceUnit ?? item.price?.price_unit ?? undefined;
}

// Rules by context
// ─────────────────────────────────────────────────────────────────────────────
// CREATE  — pre-persist checks; DRAFT permissiveness applies.
//           lineItems and totalAmount are NOT required (empty DRAFT allowed).
//           buyer.tin IS required for B2B/B2G (FIRS mandate).
//           originalIrn IS required for credit/debit notes.
//           invoiceTypeCode, invoiceKind, and paymentStatus (if present) must
//           be recognised values — this is content-correctness, not
//           completeness, so it's enforced even for a DRAFT.
//
// SUBMIT  — pre-queue checks; invoice must be FIRS-ready.
//           All CREATE rules PLUS: lineItems non-empty, totalAmount > 0,
//           legal_monetary_total fields all present and > 0, every line
//           item's classification/tax-category/price-unit content is valid
//           (these are NRS-schema content checks that only make sense once
//           the invoice is actually being submitted, not mid-draft).
//
// VALIDATE — POST /v1/invoices/validate; collects all errors rather than
//            throwing; returns ValidationResponse.
//            Mirrors SUBMIT rules so the endpoint gives reliable pre-flight
//            feedback — callers won't pass /validate only to fail at submitDraft.

@Injectable()
export class InvoiceValidationService {
  private isCreditOrDebitNote(invoiceTypeCode?: string): boolean {
    return ['380', '384', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(
      invoiceTypeCode ?? '',
    );
  }

  // Overloads — callers get the precise return type based on context.
  validateInvoiceFields(
    dto: InvoiceValidationDto,
    context: 'VALIDATE',
  ): ValidationResponse;
  validateInvoiceFields(
    dto: InvoiceValidationDto,
    context: 'CREATE' | 'SUBMIT',
  ): void;
  validateInvoiceFields(
    dto: InvoiceValidationDto,
    context: ValidationContext,
  ): ValidationResponse | void {
    if (context === 'VALIDATE') {
      return this.validateCollecting(dto);
    }
    this.validateThrowing(dto, context);
  }

  // ── Error-collecting path (VALIDATE) ───────────────────────────────────────

  private validateCollecting(dto: InvoiceValidationDto): ValidationResponse {
    const errors: ValidationErrorItem[] = [];
    const warnings: ValidationErrorItem[] = [];

    if (!dto.seller?.tin) {
      errors.push({
        field: 'seller.tin',
        code: 'MISSING_SELLER_TIN',
        message: 'Seller TIN is required',
        severity: 'ERROR',
      });
    }

    if (!dto.seller?.partyName) {
      errors.push({
        field: 'seller.partyName',
        code: 'MISSING_SELLER_NAME',
        message: 'Seller name is required',
        severity: 'ERROR',
      });
    }

    if (!dto.buyer?.partyName) {
      errors.push({
        field: 'buyer.partyName',
        code: 'MISSING_BUYER_NAME',
        message: 'Buyer name is required',
        severity: 'ERROR',
      });
    }

    if (!dto.issueDate) {
      errors.push({
        field: 'issueDate',
        code: 'MISSING_ISSUE_DATE',
        message: 'Invoice issue date is required',
        severity: 'ERROR',
      });
    }

    if (!dto.invoiceKind || !VALID_INVOICE_KINDS.has(dto.invoiceKind)) {
      errors.push({
        field: 'invoiceKind',
        code: 'MISSING_INVOICE_KIND',
        message: 'invoiceKind is required and must be one of B2B, B2C, B2G',
        severity: 'ERROR',
      });
    }

    if (
      dto.invoiceTypeCode &&
      !VALID_INVOICE_TYPE_CODES.has(dto.invoiceTypeCode)
    ) {
      errors.push({
        field: 'invoiceTypeCode',
        code: 'INVALID_INVOICE_TYPE_CODE',
        message: `Unrecognized invoice type code: ${dto.invoiceTypeCode}`,
        severity: 'ERROR',
      });
    }

    if (dto.paymentStatus && !VALID_PAYMENT_STATUSES.has(dto.paymentStatus)) {
      errors.push({
        field: 'paymentStatus',
        code: 'INVALID_PAYMENT_STATUS',
        message: `paymentStatus must be one of ${[...VALID_PAYMENT_STATUSES].join(', ')}`,
        severity: 'ERROR',
      });
    }

    if (!dto.lineItems || dto.lineItems.length === 0) {
      errors.push({
        field: 'lineItems',
        code: 'MISSING_LINE_ITEMS',
        message: 'Invoice must have at least one line item',
        severity: 'ERROR',
      });
    }

    if (Number(dto.totalAmount) <= 0) {
      errors.push({
        field: 'legalMonetaryTotal.payableAmount',
        code: 'INVALID_TOTAL_AMOUNT',
        message: 'Invoice total must be greater than zero',
        severity: 'ERROR',
      });
    }

    if (
      (dto.invoiceKind === 'B2B' || dto.invoiceKind === 'B2G') &&
      !dto.buyer?.tin
    ) {
      errors.push({
        field: 'buyer.tin',
        code: 'MISSING_BUYER_TIN',
        message: 'buyer.tin is required for B2B and B2G invoices',
        severity: 'ERROR',
      });
    }

    if (this.isCreditOrDebitNote(dto.invoiceTypeCode) && !dto.originalIrn) {
      errors.push({
        field: 'originalIrn',
        code: 'MISSING_ORIGINAL_IRN',
        message: 'Credit notes and debit notes must reference an original IRN',
        severity: 'ERROR',
      });
    }

    if (dto.legalMonetaryTotal) {
      for (const [key, field] of LEGAL_MONETARY_TOTAL_FIELDS) {
        const value = Number(dto.legalMonetaryTotal[key]);
        if (!value || value <= 0) {
          errors.push({
            field,
            code: 'INVALID_LEGAL_MONETARY_TOTAL',
            message: `${field} must be present and greater than zero`,
            severity: 'ERROR',
          });
        }
      }
    }

    if (dto.taxTotal) {
      dto.taxTotal.forEach((tt: any, ttIndex: number) => {
        (tt.taxSubtotal ?? tt.tax_subtotal ?? []).forEach(
          (sub: any, subIndex: number) => {
            const id = sub.taxCategory?.id ?? sub.tax_category?.id;
            if (id && !isValidTaxCategoryId(id)) {
              errors.push({
                field: `taxTotal[${ttIndex}].taxSubtotal[${subIndex}].taxCategory.id`,
                code: 'INVALID_TAX_CATEGORY',
                message: `Unrecognized tax category id: ${id}`,
                severity: 'ERROR',
              });
            }
          },
        );
      });
    }

    if (dto.lineItems) {
      dto.lineItems.forEach((item: any, index: number) => {
        const itemType = getLineItemType(item);
        if (itemType === 'SERVICE') {
          const isicCode = item.isicCode ?? item.isic_code;
          const serviceCategory = item.serviceCategory ?? item.service_category;
          if (!isicCode || !serviceCategory) {
            errors.push({
              field: `lineItems[${index}]`,
              code: 'MISSING_SERVICE_CLASSIFICATION',
              message:
                'SERVICE line items require both isicCode and serviceCategory',
              severity: 'ERROR',
            });
          }
        } else {
          const hsnCode = item.hsnCode ?? item.hsn_code;
          const productCategory = item.productCategory ?? item.product_category;
          if (!hsnCode || !productCategory) {
            errors.push({
              field: `lineItems[${index}]`,
              code: 'MISSING_PRODUCT_CLASSIFICATION',
              message:
                'PRODUCT line items require both hsnCode and productCategory',
              severity: 'ERROR',
            });
          }
        }

        const priceUnit = getLineItemPriceUnit(item);
        if (priceUnit && !VALID_PRICE_UNITS.has(priceUnit.toUpperCase())) {
          errors.push({
            field: `lineItems[${index}].price.priceUnit`,
            code: 'INVALID_PRICE_UNIT',
            message: `Unrecognized price_unit: ${priceUnit}`,
            severity: 'ERROR',
          });
        }
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ── Throwing path (CREATE / SUBMIT) ────────────────────────────────────────

  private validateThrowing(
    dto: InvoiceValidationDto,
    context: 'CREATE' | 'SUBMIT',
  ): void {
    // Rules shared by CREATE and SUBMIT
    if (!dto.seller?.tin)
      throw new BadRequestException('seller.tin is required');
    if (!dto.seller?.partyName)
      throw new BadRequestException('seller.partyName is required');
    if (!dto.buyer?.partyName)
      throw new BadRequestException('buyer.partyName is required');
    if (!dto.issueDate) throw new BadRequestException('issueDate is required');

    if (!dto.invoiceKind || !VALID_INVOICE_KINDS.has(dto.invoiceKind)) {
      throw new BadRequestException(
        'invoiceKind is required and must be one of B2B, B2C, B2G',
      );
    }

    if (
      dto.invoiceTypeCode &&
      !VALID_INVOICE_TYPE_CODES.has(dto.invoiceTypeCode)
    ) {
      throw new BadRequestException(
        `Unrecognized invoice type code: ${dto.invoiceTypeCode}`,
      );
    }

    if (dto.paymentStatus && !VALID_PAYMENT_STATUSES.has(dto.paymentStatus)) {
      throw new BadRequestException(
        `paymentStatus must be one of ${[...VALID_PAYMENT_STATUSES].join(', ')}`,
      );
    }

    if (
      (dto.invoiceKind === 'B2B' || dto.invoiceKind === 'B2G') &&
      !dto.buyer?.tin
    ) {
      throw new BadRequestException(
        'buyer.tin is required for B2B / B2G invoices',
      );
    }

    if (this.isCreditOrDebitNote(dto.invoiceTypeCode) && !dto.originalIrn) {
      throw new BadRequestException(
        'Credit notes and debit notes must reference an original IRN',
      );
    }

    // SUBMIT-only: invoice must be FIRS-ready
    if (context === 'SUBMIT') {
      if (!dto.lineItems || dto.lineItems.length === 0)
        throw new BadRequestException('At least one line item is required');
      if (Number(dto.totalAmount) <= 0)
        throw new BadRequestException(
          'Invoice total must be greater than zero',
        );

      if (dto.legalMonetaryTotal) {
        for (const [key, field] of LEGAL_MONETARY_TOTAL_FIELDS) {
          const value = Number(dto.legalMonetaryTotal[key]);
          if (!value || value <= 0) {
            throw new BadRequestException(
              `${field} must be present and greater than zero`,
            );
          }
        }
      }

      if (dto.taxTotal) {
        for (const tt of dto.taxTotal) {
          for (const sub of tt.taxSubtotal ?? tt.tax_subtotal ?? []) {
            const id = sub.taxCategory?.id ?? sub.tax_category?.id;
            if (id && !isValidTaxCategoryId(id)) {
              throw new BadRequestException(
                `Unrecognized tax category id: ${id}`,
              );
            }
          }
        }
      }

      if (dto.lineItems) {
        for (const item of dto.lineItems) {
          const itemType = getLineItemType(item);
          if (itemType === 'SERVICE') {
            const isicCode = item.isicCode ?? item.isic_code;
            const serviceCategory =
              item.serviceCategory ?? item.service_category;
            if (!isicCode || !serviceCategory) {
              throw new BadRequestException(
                'SERVICE line items require both isicCode and serviceCategory',
              );
            }
          } else {
            const hsnCode = item.hsnCode ?? item.hsn_code;
            const productCategory =
              item.productCategory ?? item.product_category;
            if (!hsnCode || !productCategory) {
              throw new BadRequestException(
                'PRODUCT line items require both hsnCode and productCategory',
              );
            }
          }

          const priceUnit = getLineItemPriceUnit(item);
          if (priceUnit && !VALID_PRICE_UNITS.has(priceUnit.toUpperCase())) {
            throw new BadRequestException(
              `Unrecognized price_unit: ${priceUnit}`,
            );
          }
        }
      }
    }
  }
}
