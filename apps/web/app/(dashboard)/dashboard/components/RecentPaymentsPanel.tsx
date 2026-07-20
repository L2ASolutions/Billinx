'use client';

import Link from 'next/link';
import { formatCurrency, formatPaymentMethod } from '@/lib/utils';
import { Sk } from './Sk';
import type { RecentPayment } from './types';

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function providerColor(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes('paystack')) return 'bg-green-50 text-green-700';
  if (p.includes('flutterwave')) return 'bg-orange-50 text-orange-700';
  if (p.includes('bank') || p.includes('transfer')) return 'bg-blue-50 text-blue-700';
  return 'bg-gray-100 text-gray-600';
}

interface RecentPaymentsPanelProps {
  statsLoading: boolean;
  recentPayments: RecentPayment[];
}

export function RecentPaymentsPanel({ statsLoading, recentPayments }: RecentPaymentsPanelProps) {
  return (
    <div className="bg-white rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-dark">Recent payments</h2>
        <Link href="/payments" className="text-xs text-[#1D9E75] font-medium hover:underline">
          View all →
        </Link>
      </div>
      {statsLoading ? (
        <div className="p-4 space-y-3">
          {[0, 1, 2, 3].map((i) => <Sk key={i} className="h-10 w-full" />)}
        </div>
      ) : recentPayments.length === 0 ? (
        <div className="py-12 flex flex-col items-center gap-3 text-center px-5">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="text-gray-300">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          <p className="text-sm text-muted">No payments recorded yet</p>
          <Link href="/payments" className="text-xs text-[#1D9E75] font-medium hover:underline">
            Record payment →
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {recentPayments.slice(0, 4).map((p, i) => (
            <li key={i} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-dark truncate">{p.buyerName}</p>
                <p className="text-xs text-muted mt-0.5">{timeAgo(p.paidAt)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${providerColor(p.provider)}`}>
                  {formatPaymentMethod(p.provider)}
                </span>
                <span className="text-sm font-bold text-[#1D9E75]">{formatCurrency(p.amount, 'NGN')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
