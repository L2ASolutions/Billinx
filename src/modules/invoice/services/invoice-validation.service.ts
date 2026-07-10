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
}

// Rules by context
// ─────────────────────────────────────────────────────────────────────────────
// CREATE  — pre-persist checks; DRAFT permissiveness applies.
//           lineItems and totalAmount are NOT required (empty DRAFT allowed).
//           buyer.tin IS required for B2B/B2G (FIRS mandate).
//           originalIrn IS required for credit/debit notes.
//
// SUBMIT  — pre-queue checks; invoice must be FIRS-ready.
//           All CREATE rules PLUS: lineItems non-empty, totalAmount > 0.
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

    if (dto.lineItems) {
      dto.lineItems.forEach((item: any, index: number) => {
        if (!item.hsnCode) {
          warnings.push({
            field: `lineItems[${index}].hsnCode`,
            code: 'MISSING_HSN_CODE',
            message: 'HSN code recommended for goods-based line items',
            severity: 'WARNING',
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
    if (!dto.issueDate)
      throw new BadRequestException('issueDate is required');

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
    }
  }
}
