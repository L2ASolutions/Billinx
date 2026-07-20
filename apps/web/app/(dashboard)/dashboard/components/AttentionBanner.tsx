'use client';

import Link from 'next/link';

interface AttentionBannerProps {
  showRejections: boolean;
  showOverdue: boolean;
  showToReview: boolean;
  rejectedCount: number;
  overdueCount: number;
  toReview: number;
}

export function AttentionBanner({
  showRejections,
  showOverdue,
  showToReview,
  rejectedCount,
  overdueCount,
  toReview,
}: AttentionBannerProps) {
  const showBanner = showRejections || showOverdue || showToReview;
  if (!showBanner) return null;

  return (
    <div className={`rounded-xl border-l-4 px-5 py-3.5 flex items-center justify-between gap-4 ${
      showRejections
        ? 'bg-red-50 border-l-red-500'
        : showOverdue
        ? 'bg-red-50 border-l-red-500'
        : 'bg-amber-50 border-l-amber-500'
    }`}>
      <div className="flex items-center gap-3">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={showRejections || showOverdue ? 'text-red-500' : 'text-amber-600'}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p className={`text-sm font-medium ${showRejections || showOverdue ? 'text-red-800' : 'text-amber-800'}`}>
          {showRejections
            ? `${rejectedCount} invoice${rejectedCount !== 1 ? 's' : ''} rejected by FIRS — fix now to stay compliant`
            : showOverdue
            ? `${overdueCount} invoice${overdueCount !== 1 ? 's' : ''} are overdue`
            : `${toReview} received invoice${toReview !== 1 ? 's' : ''} need review`}
        </p>
      </div>
      <Link
        href={
          showRejections
            ? '/invoices?tab=sent&status=rejected'
            : showOverdue
            ? '/invoices?tab=sent&filter=overdue'
            : '/purchases'
        }
        className={`text-xs font-semibold shrink-0 hover:underline ${
          showRejections || showOverdue ? 'text-red-700' : 'text-amber-700'
        }`}
      >
        View →
      </Link>
    </div>
  );
}
