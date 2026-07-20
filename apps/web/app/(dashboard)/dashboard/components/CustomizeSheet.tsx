'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { SECTION_LABELS, FINANCIAL_SECTIONS, canSeeFinancials } from './visibility';

export function CustomizeSheet({
  open,
  onClose,
  localHidden,
  onToggle,
  onSave,
  saving,
  role,
  tenantVisibility,
}: {
  open: boolean;
  onClose: () => void;
  localHidden: string[];
  onToggle: (key: string) => void;
  onSave: () => void;
  saving: boolean;
  role: string;
  tenantVisibility: Record<string, boolean> | undefined;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const sections = Object.entries(SECTION_LABELS).filter(([key]) => {
    if (FINANCIAL_SECTIONS.has(key) && !canSeeFinancials(role)) return false;
    // Don't show toggles for sections the tenant admin has disabled
    if (!['OWNER', 'ADMIN'].includes(role) && tenantVisibility && tenantVisibility[key] === false) return false;
    return true;
  });

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        onClick={onClose}
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[360px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-dark">Customize dashboard</h2>
            <p className="text-xs text-muted mt-0.5">
              Choose which sections to show on your dashboard. These preferences are saved to your account.
            </p>
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 shrink-0 p-1 rounded hover:bg-gray-100 transition-colors text-muted"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Toggles */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {sections.map(([key, label]) => {
            const isOn = !localHidden.includes(key);
            return (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-dark">{label}</span>
                <button
                  onClick={() => onToggle(key)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none ${isOn ? 'bg-[#1D9E75]' : 'bg-gray-200'}`}
                  role="switch"
                  aria-checked={isOn}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm mt-0.5 transition-transform duration-200 ${isOn ? 'translate-x-4' : 'translate-x-0.5'}`}
                  />
                </button>
              </div>
            );
          })}
          <p className="text-xs text-muted pt-2">
            FIRS Rejections is always visible and cannot be hidden.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border">
          <Button
            onClick={onSave}
            disabled={saving}
            className="w-full"
            size="sm"
          >
            {saving ? 'Saving…' : 'Save preferences'}
          </Button>
        </div>
      </div>
    </>
  );
}
