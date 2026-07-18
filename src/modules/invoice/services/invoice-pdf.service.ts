import { Injectable, NotFoundException } from '@nestjs/common';
import * as React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

const h = React.createElement;

const COLORS = {
  dark: '#1a1a2e',
  accent: '#0f3460',
  green: '#16a34a',
  border: '#D8DEE4',
  muted: '#5B6673',
  zebra: '#F4F6F8',
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: COLORS.dark,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  wordmark: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 18,
    color: COLORS.accent,
  },
  wordmarkSub: {
    fontSize: 7,
    color: COLORS.muted,
    marginTop: 2,
  },
  title: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
    color: COLORS.dark,
    textAlign: 'right',
  },
  irnHeader: {
    fontSize: 9,
    color: COLORS.accent,
    fontFamily: 'Helvetica-Bold',
    marginTop: 4,
    textAlign: 'right',
  },
  dateLine: {
    fontSize: 8,
    color: COLORS.muted,
    marginTop: 2,
    textAlign: 'right',
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginVertical: 10,
  },
  partiesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  partyBlock: {
    width: '48%',
  },
  partyLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  partyName: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.dark,
    marginBottom: 2,
  },
  partyLine: {
    fontSize: 8,
    color: COLORS.muted,
    marginBottom: 1.5,
  },
  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.dark,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  table: {
    marginBottom: 14,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.accent,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  tableRowZebra: {
    backgroundColor: COLORS.zebra,
  },
  tableCell: {
    fontSize: 8,
    color: COLORS.dark,
  },
  tableCellMuted: {
    fontSize: 7,
    color: COLORS.muted,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  totalsBlock: {
    width: 220,
  },
  totalsLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalsLabel: {
    fontSize: 8,
    color: COLORS.muted,
  },
  totalsValue: {
    fontSize: 8,
    color: COLORS.dark,
  },
  totalsFinalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    marginTop: 3,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  totalsFinalLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.dark,
  },
  totalsFinalValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.green,
  },
  footer: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  footerText: {
    flex: 1,
    paddingRight: 16,
  },
  footerLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.dark,
    marginBottom: 4,
  },
  footerLine: {
    fontSize: 7.5,
    color: COLORS.muted,
    marginBottom: 2,
  },
  footerIrn: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.accent,
    marginBottom: 2,
  },
  qrBlock: {
    width: 100,
    alignItems: 'center',
  },
  qrImage: {
    width: 80,
    height: 80,
  },
  qrCaption: {
    fontSize: 6.5,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 4,
  },
});

// Columns: Description | HSN/ISIC | Qty | Unit | Unit Price | Discount | Amount
const LINE_ITEM_COLS = [
  { key: 'description', width: '28%', label: 'Description' },
  { key: 'code', width: '12%', label: 'HSN/ISIC' },
  { key: 'qty', width: '8%', label: 'Qty' },
  { key: 'unit', width: '10%', label: 'Unit' },
  { key: 'unitPrice', width: '15%', label: 'Unit Price' },
  { key: 'discount', width: '12%', label: 'Discount' },
  { key: 'amount', width: '15%', label: 'Amount' },
];

const TAX_SUMMARY_COLS = [
  { key: 'category', width: '30%', label: 'Tax Category' },
  { key: 'taxable', width: '25%', label: 'Taxable Amount' },
  { key: 'rate', width: '15%', label: 'Rate' },
  { key: 'tax', width: '30%', label: 'Tax Amount' },
];

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return `${fmtDate(date)}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function fmtMoney(n: number | string | null | undefined, currency: string): string {
  const num = Number(n ?? 0);
  return `${currency} ${num.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatAddress(addr: any): string | undefined {
  if (!addr) return undefined;
  const parts = [addr.streetName, addr.cityName].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function humanizeTaxCategory(id: string | undefined): string {
  if (!id) return '—';
  return id
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly prisma: PrismaService,
  ) {}

  async generatePdf(
    id: string,
    tenantId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.invoiceRepository.findById(id);
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    const tenant = await this.prisma.asAdmin((tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { registeredAddress: true, telephone: true, phone: true },
      }),
    );

    const meta = (invoice.metadata ?? {}) as Record<string, any>;
    const sellerParty = meta.sellerParty ?? {};
    const buyerParty = meta.buyerParty ?? {};

    const irn = invoice.firsConfirmedIrn ?? invoice.platformIrn;

    const document = h(
      Document,
      null,
      h(
        Page,
        { size: 'A4', style: styles.page },
        this.buildHeader(invoice, irn),
        this.buildParties(invoice, sellerParty, buyerParty, tenant),
        this.buildLineItemsTable(invoice),
        this.buildTaxSummaryTable(invoice),
        this.buildTotals(invoice),
        this.buildFooter(invoice, irn),
      ),
    );

    const buffer = await renderToBuffer(document as any);
    return { buffer, filename: `invoice-${irn}.pdf` };
  }

  private buildHeader(invoice: any, irn: string) {
    return h(
      View,
      { style: styles.headerRow },
      h(
        View,
        null,
        h(Text, { style: styles.wordmark }, 'Billinx'),
        h(Text, { style: styles.wordmarkSub }, 'FIRS-Compliant E-Invoicing'),
      ),
      h(
        View,
        null,
        h(Text, { style: styles.title }, 'TAX INVOICE'),
        h(Text, { style: styles.irnHeader }, irn),
        h(
          Text,
          { style: styles.dateLine },
          `Issue date: ${fmtDate(invoice.issueDate)}`,
        ),
        invoice.dueDate
          ? h(
              Text,
              { style: styles.dateLine },
              `Due date: ${fmtDate(invoice.dueDate)}`,
            )
          : null,
      ),
    );
  }

  private buildParties(
    invoice: any,
    sellerParty: Record<string, any>,
    buyerParty: Record<string, any>,
    tenant: { registeredAddress: any; telephone: string | null; phone: string | null } | null,
  ) {
    const sellerAddress =
      formatAddress(sellerParty.postalAddress) ??
      formatAddress(tenant?.registeredAddress);
    const sellerPhone =
      sellerParty.telephone ?? tenant?.telephone ?? tenant?.phone ?? undefined;
    const buyerAddress = formatAddress(buyerParty.postalAddress);
    const buyerEmail = invoice.buyerEmail ?? buyerParty.email ?? undefined;
    const showBuyerTin = Boolean(
      invoice.buyerTin && invoice.invoiceKind !== 'B2C',
    );

    return h(
      View,
      { style: styles.partiesRow },
      h(
        View,
        { style: styles.partyBlock },
        h(Text, { style: styles.partyLabel }, 'Supplier'),
        h(Text, { style: styles.partyName }, invoice.sellerName),
        h(Text, { style: styles.partyLine }, `TIN: ${invoice.sellerTin}`),
        sellerAddress
          ? h(Text, { style: styles.partyLine }, sellerAddress)
          : null,
        sellerParty.email
          ? h(Text, { style: styles.partyLine }, sellerParty.email)
          : null,
        sellerPhone ? h(Text, { style: styles.partyLine }, sellerPhone) : null,
      ),
      h(
        View,
        { style: styles.partyBlock },
        h(Text, { style: styles.partyLabel }, 'Buyer'),
        h(Text, { style: styles.partyName }, invoice.buyerName),
        showBuyerTin
          ? h(Text, { style: styles.partyLine }, `TIN: ${invoice.buyerTin}`)
          : null,
        buyerAddress
          ? h(Text, { style: styles.partyLine }, buyerAddress)
          : null,
        buyerEmail ? h(Text, { style: styles.partyLine }, buyerEmail) : null,
      ),
    );
  }

  private buildLineItemsTable(invoice: any) {
    const currency = invoice.currency ?? 'NGN';
    const lineItems: any[] = invoice.lineItems ?? [];

    const headerCells = LINE_ITEM_COLS.map((col) =>
      h(
        Text,
        { key: col.key, style: [styles.tableHeaderCell, { width: col.width }] },
        col.label,
      ),
    );

    const rows = lineItems.map((li, i) => {
      const rowStyle =
        i % 2 === 1
          ? [styles.tableRow, styles.tableRowZebra]
          : [styles.tableRow];
      const code = li.hsnCode ?? li.isicCode ?? '—';
      const unit = li.price?.priceUnit ?? '—';
      const discount = li.discountAmount ?? 0;

      return h(
        View,
        { key: i, style: rowStyle },
        h(
          View,
          { style: { width: LINE_ITEM_COLS[0].width } },
          h(Text, { style: styles.tableCell }, li.item?.name ?? '—'),
          li.item?.description
            ? h(Text, { style: styles.tableCellMuted }, li.item.description)
            : null,
        ),
        h(
          Text,
          { style: [styles.tableCell, { width: LINE_ITEM_COLS[1].width }] },
          code,
        ),
        h(
          Text,
          { style: [styles.tableCell, { width: LINE_ITEM_COLS[2].width }] },
          String(li.invoicedQuantity ?? '—'),
        ),
        h(
          Text,
          { style: [styles.tableCell, { width: LINE_ITEM_COLS[3].width }] },
          unit,
        ),
        h(
          Text,
          { style: [styles.tableCell, { width: LINE_ITEM_COLS[4].width }] },
          fmtMoney(li.price?.priceAmount, currency),
        ),
        h(
          Text,
          { style: [styles.tableCell, { width: LINE_ITEM_COLS[5].width }] },
          discount > 0 ? fmtMoney(discount, currency) : '—',
        ),
        h(
          Text,
          { style: [styles.tableCell, { width: LINE_ITEM_COLS[6].width }] },
          fmtMoney(li.lineExtensionAmount, currency),
        ),
      );
    });

    return h(
      View,
      { style: styles.table },
      h(Text, { style: styles.sectionTitle }, 'Line Items'),
      h(View, { style: styles.tableHeaderRow }, ...headerCells),
      ...rows,
    );
  }

  private buildTaxSummaryTable(invoice: any) {
    const currency = invoice.currency ?? 'NGN';
    const taxTotal: any[] = invoice.taxTotal ?? [];
    const subtotals = taxTotal.flatMap((tt) => tt.taxSubtotal ?? []);

    const headerCells = TAX_SUMMARY_COLS.map((col) =>
      h(
        Text,
        { key: col.key, style: [styles.tableHeaderCell, { width: col.width }] },
        col.label,
      ),
    );

    const rows = subtotals.map((ts, i) => {
      const rowStyle =
        i % 2 === 1
          ? [styles.tableRow, styles.tableRowZebra]
          : [styles.tableRow];
      return h(
        View,
        { key: i, style: rowStyle },
        h(
          Text,
          { style: [styles.tableCell, { width: TAX_SUMMARY_COLS[0].width }] },
          humanizeTaxCategory(ts.taxCategory?.id),
        ),
        h(
          Text,
          { style: [styles.tableCell, { width: TAX_SUMMARY_COLS[1].width }] },
          fmtMoney(ts.taxableAmount, currency),
        ),
        h(
          Text,
          { style: [styles.tableCell, { width: TAX_SUMMARY_COLS[2].width }] },
          ts.taxCategory?.percent != null ? `${ts.taxCategory.percent}%` : '—',
        ),
        h(
          Text,
          { style: [styles.tableCell, { width: TAX_SUMMARY_COLS[3].width }] },
          fmtMoney(ts.taxAmount, currency),
        ),
      );
    });

    return h(
      View,
      { style: styles.table },
      h(Text, { style: styles.sectionTitle }, 'Tax Summary'),
      h(View, { style: styles.tableHeaderRow }, ...headerCells),
      ...(rows.length > 0
        ? rows
        : [
            h(
              View,
              { style: styles.tableRow },
              h(Text, { style: styles.tableCellMuted }, 'No tax breakdown available'),
            ),
          ]),
    );
  }

  private buildTotals(invoice: any) {
    const currency = invoice.currency ?? 'NGN';
    const lmt = (invoice.legalMonetaryTotal ?? {}) as Record<string, any>;
    const subtotalExVat = lmt.taxExclusiveAmount ?? Number(invoice.subtotal);
    const totalVat = Number(invoice.vatAmount ?? 0);
    const totalIncVat = lmt.taxInclusiveAmount ?? Number(invoice.totalAmount);
    const payable = lmt.payableAmount ?? Number(invoice.totalAmount);

    return h(
      View,
      { style: styles.totalsRow },
      h(
        View,
        { style: styles.totalsBlock },
        h(
          View,
          { style: styles.totalsLine },
          h(Text, { style: styles.totalsLabel }, 'Subtotal (ex VAT)'),
          h(Text, { style: styles.totalsValue }, fmtMoney(subtotalExVat, currency)),
        ),
        h(
          View,
          { style: styles.totalsLine },
          h(Text, { style: styles.totalsLabel }, 'Total VAT'),
          h(Text, { style: styles.totalsValue }, fmtMoney(totalVat, currency)),
        ),
        h(
          View,
          { style: styles.totalsLine },
          h(Text, { style: styles.totalsLabel }, 'Total (inc VAT)'),
          h(Text, { style: styles.totalsValue }, fmtMoney(totalIncVat, currency)),
        ),
        h(
          View,
          { style: styles.totalsFinalLine },
          h(Text, { style: styles.totalsFinalLabel }, 'Amount Payable'),
          h(Text, { style: styles.totalsFinalValue }, fmtMoney(payable, currency)),
        ),
      ),
    );
  }

  private buildFooter(invoice: any, irn: string) {
    const qrSrc = invoice.qrCodeBase64
      ? `data:image/png;base64,${invoice.qrCodeBase64}`
      : null;

    return h(
      View,
      { style: styles.footer },
      h(
        View,
        { style: styles.footerText },
        h(Text, { style: styles.footerLabel }, 'NRS Tax Information'),
        h(Text, { style: styles.footerIrn }, `IRN: ${irn}`),
        h(
          Text,
          { style: styles.footerLine },
          `Submitted: ${fmtDateTime(invoice.submittedAt)}`,
        ),
        h(
          Text,
          { style: styles.footerLine },
          'This document is validated by FIRS via the Interswitch NRS platform.',
        ),
      ),
      qrSrc
        ? h(
            View,
            { style: styles.qrBlock },
            h(Image, { src: qrSrc, style: styles.qrImage }),
            h(
              Text,
              { style: styles.qrCaption },
              'Scan to verify this invoice on the NRS platform',
            ),
          )
        : null,
    );
  }
}
