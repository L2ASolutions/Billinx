import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { InvoiceService } from '../services/invoice.service';
import { RedisService } from '../../../shared/redis/redis.service';
import { addToBulkQueue } from '../../submission/queues/bulk-submission.queue';

const MAX_BULK_SIZE = 500;
const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB
const BULK_RATE_LIMIT = 3;
const BULK_RATE_WINDOW_SECS = 60;

export interface BulkInvoiceResult {
  index: number;
  sourceRef?: string;
  status: 'queued' | 'invalid';
  irn?: string;
  errors?: string[];
}

export interface BulkSummary {
  batchId: string;
  total: number;
  queued: number;
  rejected: number;
  results: BulkInvoiceResult[];
}

export interface BulkBatchStatus {
  batchId: string;
  total: number;
  queued: number;
  processing: number;
  accepted: number;
  rejected: number;
  failed: number;
  invalidCount: number;
  percentComplete: number;
  createdAt: string;
}

@Injectable()
export class BulkInvoiceService {
  private readonly logger = new Logger(BulkInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceService: InvoiceService,
    private readonly redis: RedisService,
  ) {}

  async processBulkJson(
    tenantId: string,
    environment: string,
    actor: string,
    invoices: any[],
  ): Promise<BulkSummary> {
    await this.enforceBulkRateLimit(tenantId);

    if (!Array.isArray(invoices) || invoices.length === 0) {
      throw new BadRequestException('invoices must be a non-empty array');
    }
    if (invoices.length > MAX_BULK_SIZE) {
      throw new BadRequestException(
        `Bulk request exceeds maximum of ${MAX_BULK_SIZE} invoices`,
      );
    }

    return this.processBatch(tenantId, environment, actor, invoices, 'JSON');
  }

  async processBulkCsv(
    tenantId: string,
    environment: string,
    actor: string,
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<BulkSummary> {
    await this.enforceBulkRateLimit(tenantId);

    if (fileBuffer.length > MAX_CSV_BYTES) {
      throw new BadRequestException('CSV file exceeds 5 MB limit');
    }

    const invoices = this.parseCsv(fileBuffer.toString('utf8'));

    if (invoices.length === 0) {
      throw new BadRequestException('CSV file contains no invoice rows');
    }
    if (invoices.length > MAX_BULK_SIZE) {
      throw new BadRequestException(
        `CSV contains ${invoices.length} rows; maximum is ${MAX_BULK_SIZE}`,
      );
    }

    return this.processBatch(
      tenantId,
      environment,
      actor,
      invoices,
      'CSV',
      fileName,
    );
  }

  async getBatchStatus(
    tenantId: string,
    batchId: string,
  ): Promise<BulkBatchStatus> {
    const batch = await this.prisma.asAdmin(async (tx) => {
      return (tx as any).bulkBatch.findFirst({
        where: { id: batchId, tenantId },
      });
    });

    if (!batch) {
      throw new BadRequestException(`Batch ${batchId} not found`);
    }

    const completed = batch.accepted + batch.rejected + batch.failed;
    const percentComplete =
      batch.total > 0 ? Math.round((completed / batch.total) * 100) : 0;

    return {
      batchId: batch.id,
      total: batch.total,
      queued: batch.queued,
      processing: batch.processing,
      accepted: batch.accepted,
      rejected: batch.rejected,
      failed: batch.failed,
      invalidCount: batch.invalidCount,
      percentComplete,
      createdAt: batch.createdAt.toISOString(),
    };
  }

  private async processBatch(
    tenantId: string,
    environment: string,
    actor: string,
    invoices: any[],
    source: 'JSON' | 'CSV',
    fileName?: string,
  ): Promise<BulkSummary> {
    const results: BulkInvoiceResult[] = [];
    let queued = 0;
    let rejected = 0;

    // Create the batch record first
    const batch = await this.prisma.asAdmin(async (tx) => {
      return (tx as any).bulkBatch.create({
        data: {
          tenantId,
          environment,
          actor,
          source,
          fileName: fileName ?? null,
          total: invoices.length,
        },
      });
    });

    // Process each invoice independently
    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      try {
        const { invoice: created, isDuplicate } =
          await this.invoiceService.createInvoice(
            tenantId,
            environment,
            actor,
            inv,
          );

        if (!isDuplicate) {
          // Queue to bulk queue (lower priority than individual invoices)
          await addToBulkQueue({
            invoiceId: created.id,
            tenantId,
            platformIrn: created.platformIrn,
            adapterKey: (created as any).adapterKey ?? 'mock',
            attempt: 1,
            batchId: batch.id,
          });
        }

        queued++;
        results.push({
          index: i,
          sourceRef: inv.sourceReference,
          status: 'queued',
          irn: created.platformIrn,
        });
      } catch (err: any) {
        rejected++;
        results.push({
          index: i,
          sourceRef: inv.sourceReference,
          status: 'invalid',
          errors: [err.message ?? 'Validation failed'],
        });
      }
    }

    // Update batch with initial counts
    await this.prisma.asAdmin(async (tx) => {
      return (tx as any).bulkBatch.update({
        where: { id: batch.id },
        data: { queued, invalidCount: rejected },
      });
    });

    this.logger.log(
      `Bulk batch ${batch.id}: ${queued} queued, ${rejected} rejected out of ${invoices.length}`,
    );

    return {
      batchId: batch.id,
      total: invoices.length,
      queued,
      rejected,
      results,
    };
  }

  private async enforceBulkRateLimit(tenantId: string): Promise<void> {
    const key = `bulk:rl:${tenantId}`;
    const { allowed, retryAfter } = await this.redis.checkRateLimit(
      key,
      BULK_RATE_LIMIT,
      BULK_RATE_WINDOW_SECS,
    );
    if (!allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Bulk rate limit exceeded: maximum ${BULK_RATE_LIMIT} bulk requests per minute. Retry after ${retryAfter}s.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private parseCsv(raw: string): any[] {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = this.parseCsvRow(lines[0]).map((h) =>
      h.trim().toLowerCase(),
    );
    const invoices: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvRow(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] ?? '';
      });
      invoices.push(this.mapCsvRowToInvoice(row));
    }

    return invoices;
  }

  private parseCsvRow(line: string): string[] {
    const fields: string[] = [];
    let inQuote = false;
    let current = '';

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === ',' && !inQuote) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  }

  private mapCsvRowToInvoice(row: Record<string, string>): any {
    const parseJson = (val: string, fallback: any = null) => {
      if (!val) return fallback;
      try {
        return JSON.parse(val);
      } catch {
        return fallback;
      }
    };

    const subtotal = parseFloat(row['subtotal'] ?? '0') || 0;
    const vatAmount = parseFloat(row['vat_amount'] ?? '0') || 0;
    const totalAmount = parseFloat(row['total_amount'] ?? '0') || 0;

    return {
      invoiceTypeCode: row['invoice_type_code'] || 'STANDARD',
      invoiceKind: row['invoice_kind'] || 'B2B',
      issueDate: row['issue_date'],
      dueDate: row['due_date'] || undefined,
      currency: row['currency'] || 'NGN',
      sourceReference: row['source_reference'] || undefined,
      note: row['note'] || undefined,
      seller: {
        tin: row['seller_tin'],
        partyName: row['seller_name'],
      },
      buyer: {
        tin: row['buyer_tin'] || undefined,
        partyName: row['buyer_name'],
      },
      lineItems: parseJson(row['line_items'], [
        {
          lineId: '1',
          description: row['description'] || 'Item',
          quantity: 1,
          unitCode: 'EA',
          unitPrice: subtotal,
          lineExtensionAmount: subtotal,
          taxCategoryId: 'STANDARD_VAT',
          taxPercent: vatAmount > 0 ? (vatAmount / subtotal) * 100 : 7.5,
          taxAmount: vatAmount,
        },
      ]),
      taxTotal: parseJson(row['tax_total'], [
        { taxAmount: vatAmount, taxableAmount: subtotal },
      ]),
      legalMonetaryTotal: parseJson(row['legal_monetary_total'], {
        lineExtensionAmount: subtotal,
        taxExclusiveAmount: subtotal,
        taxInclusiveAmount: totalAmount,
        payableAmount: totalAmount,
      }),
    };
  }
}
