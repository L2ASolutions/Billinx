'use client';

import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';

interface VatSummaryStripProps {
  outputVat: number;
  inputVat: number;
  netVat: number;
}

export function VatSummaryStrip({ outputVat, inputVat, netVat }: VatSummaryStripProps) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted">
      <span>Output VAT: <span className="text-dark font-medium">{formatCurrency(outputVat, 'NGN')}</span></span>
      <span className="mx-1">·</span>
      <span>Input VAT: <span className="text-dark font-medium">{formatCurrency(inputVat, 'NGN')}</span></span>
      <span className="mx-1">·</span>
      <span>
        Net:{' '}
        <span className={`font-medium ${netVat > 0 ? 'text-red-600' : netVat < 0 ? 'text-[#1D9E75]' : 'text-dark'}`}>
          {netVat >= 0 ? '' : '-'}{formatCurrency(Math.abs(netVat), 'NGN')} {netVat > 0 ? 'payable' : netVat < 0 ? 'credit' : ''}
        </span>
      </span>
      <span className="mx-1">·</span>
      <Link href="/vat-return" className="text-[#1D9E75] font-medium hover:underline">View VAT return →</Link>
    </div>
  );
}
