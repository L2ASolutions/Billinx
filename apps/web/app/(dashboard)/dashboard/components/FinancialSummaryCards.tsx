'use client';

import Link from 'next/link';
import { formatCurrency } from '@/lib/utils';
import { Sk } from './Sk';

interface FinancialSummaryCardsProps {
  statsLoading: boolean;
  incomingLoading: boolean;
  outstandingAmount: number;
  outstandingCount: number;
  overdueCount: number;
  outstandingPayables: number;
  payablesCount: number;
  netCash: number;
}

export function FinancialSummaryCards({
  statsLoading,
  incomingLoading,
  outstandingAmount,
  outstandingCount,
  overdueCount,
  outstandingPayables,
  payablesCount,
  netCash,
}: FinancialSummaryCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Receivables */}
      <Link href="/payments" className="block">
        <div className="bg-white rounded-xl border border-border shadow-card border-l-4 border-l-[#1D9E75] p-5 h-full hover:shadow-sm transition-shadow">
          <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Outstanding receivables</p>
          {statsLoading ? (
            <>
              <Sk className="h-8 w-28 mb-2" />
              <Sk className="h-3 w-36 mb-1" />
              <Sk className="h-3 w-20" />
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-[#1D9E75]">{formatCurrency(outstandingAmount, 'NGN')}</p>
              <p className="text-xs text-green-600 mt-1.5">
                {outstandingCount} invoice{outstandingCount !== 1 ? 's' : ''} unpaid
              </p>
              {overdueCount > 0 && (
                <p className="text-xs text-red-500 mt-0.5 font-medium">{overdueCount} overdue</p>
              )}
            </>
          )}
        </div>
      </Link>

      {/* Payables */}
      <Link href="/purchases" className="block">
        <div className={`bg-white rounded-xl border border-border shadow-card border-l-4 p-5 h-full hover:shadow-sm transition-shadow ${
          outstandingPayables > 0 ? 'border-l-red-500' : 'border-l-gray-300'
        }`}>
          <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Outstanding payables</p>
          {incomingLoading ? (
            <>
              <Sk className="h-8 w-28 mb-2" />
              <Sk className="h-3 w-36 mb-1" />
            </>
          ) : (
            <>
              <p className={`text-2xl font-bold ${outstandingPayables > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {formatCurrency(outstandingPayables, 'NGN')}
              </p>
              <p className="text-xs text-muted mt-1.5">
                {payablesCount} supplier invoice{payablesCount !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>
      </Link>

      {/* Net position */}
      <div className={`bg-white rounded-xl border border-border shadow-card border-l-4 p-5 ${
        statsLoading || incomingLoading
          ? 'border-l-gray-200'
          : netCash > 0
          ? 'border-l-[#1D9E75]'
          : netCash < 0
          ? 'border-l-red-500'
          : 'border-l-gray-300'
      }`}>
        <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Net cash position</p>
        {statsLoading || incomingLoading ? (
          <>
            <Sk className="h-8 w-28 mb-2" />
            <Sk className="h-3 w-24" />
          </>
        ) : (
          <>
            <p className={`text-2xl font-bold ${
              netCash > 0 ? 'text-[#1D9E75]' : netCash < 0 ? 'text-red-600' : 'text-gray-400'
            }`}>
              {formatCurrency(Math.abs(netCash), 'NGN')}
            </p>
            <p className="text-xs text-muted mt-1.5">
              {netCash > 0 ? 'Net receivable' : netCash < 0 ? 'Net payable' : 'Balanced'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
