'use client';

import Link from 'next/link';
import { Sk } from './Sk';

interface NeedsAttentionPanelProps {
  statsLoading: boolean;
  attentionItems: { type: 'rejected'; label: string; sub: string }[];
  overdueCount: number;
}

export function NeedsAttentionPanel({ statsLoading, attentionItems, overdueCount }: NeedsAttentionPanelProps) {
  return (
    <div className="bg-white rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-dark">Needs attention</h2>
        <Link href="/invoices" className="text-xs text-[#1D9E75] font-medium hover:underline">
          View all →
        </Link>
      </div>
      {statsLoading ? (
        <div className="p-4 space-y-3">
          {[0, 1, 2].map((i) => <Sk key={i} className="h-10 w-full" />)}
        </div>
      ) : attentionItems.length === 0 && overdueCount === 0 ? (
        <div className="py-12 flex flex-col items-center gap-3 text-center px-5">
          <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1D9E75]">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-sm font-medium text-dark">Everything is up to date</p>
          <p className="text-xs text-muted">No invoices need attention</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {attentionItems.map((item, i) => (
            <li key={i} className="px-5 py-3 flex items-start gap-3">
              <span className={`mt-0.5 shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                item.type === 'rejected' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
              }`}>
                {item.type === 'rejected' ? 'Rejected' : 'Overdue'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-dark truncate">{item.label}</p>
                <p className="text-xs text-muted mt-0.5 truncate">{item.sub}</p>
              </div>
            </li>
          ))}
          {overdueCount > 0 && attentionItems.length < 4 && (
            <li className="px-5 py-3 flex items-start gap-3">
              <span className="mt-0.5 shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
                Overdue
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-dark">{overdueCount} invoice{overdueCount !== 1 ? 's' : ''} past due date</p>
                <Link href="/invoices?tab=sent&filter=overdue" className="text-xs text-[#1D9E75] hover:underline">
                  View overdue invoices →
                </Link>
              </div>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
