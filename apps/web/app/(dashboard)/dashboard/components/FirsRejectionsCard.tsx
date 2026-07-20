'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sk } from './Sk';
import type { RejectionsData } from './types';

export function FirsRejectionsCard({
  data,
  loading,
}: {
  data: RejectionsData | null;
  loading: boolean;
}) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-border shadow-card border-l-4 border-l-gray-200 p-5">
        <Sk className="h-4 w-36 mb-2" />
        <Sk className="h-3 w-48 mb-3" />
        <Sk className="h-8 w-full" />
      </div>
    );
  }

  if (!data || data.allResolved) {
    return (
      <div className="bg-white rounded-xl border border-border shadow-card border-l-4 border-l-[#1D9E75] p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-green-50 flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1D9E75]">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-dark">FIRS Status</p>
            <p className="text-xs text-muted">No rejected invoices this period</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-[#1D9E75] shrink-0">All accepted</span>
      </div>
    );
  }

  const topReasons = data.reasons.slice(0, 3);
  const moreCount = data.reasons.length - 3;

  return (
    <div className="bg-white rounded-xl border border-border shadow-card border-l-4 border-l-red-500 p-5">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-sm font-semibold text-dark">FIRS Rejections</span>
        </div>
        <span className="text-sm font-bold text-red-600 shrink-0">
          {data.totalRejected} invoice{data.totalRejected !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-2">
        {topReasons.map((reason) => (
          <button
            key={reason.errorCode}
            onClick={() => router.push('/invoices?direction=sent&filter=needs-attention')}
            className="w-full flex items-center justify-between gap-3 text-left hover:bg-red-50 rounded-lg px-3 py-2 transition-colors group"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-dark truncate">{reason.errorMessage}</p>
              <p className="text-[10px] text-muted font-mono">{reason.errorCode}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-muted">
                {reason.count} invoice{reason.count !== 1 ? 's' : ''}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="text-muted group-hover:text-red-500 transition-colors">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
        {moreCount > 0 && (
          <p className="text-xs text-muted px-3">+ {moreCount} more reason{moreCount !== 1 ? 's' : ''}</p>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-border flex justify-end">
        <Link
          href="/invoices?direction=sent&filter=needs-attention"
          className="text-xs font-semibold text-red-600 hover:underline"
        >
          View all rejected →
        </Link>
      </div>
    </div>
  );
}
