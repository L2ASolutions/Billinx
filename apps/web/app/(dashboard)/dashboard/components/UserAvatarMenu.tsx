'use client';

import { useEffect, useRef, useState } from 'react';

function initialsFor(fullName: string): string {
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  return nameParts.length >= 2
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : (nameParts[0]?.[0]?.toUpperCase() ?? 'U');
}

const LogoutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export function UserAvatarMenu({
  fullName,
  role,
  onLogout,
}: {
  fullName: string;
  role: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const initials = initialsFor(fullName);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-full bg-dark text-white text-sm font-bold flex items-center justify-center shrink-0 hover:opacity-90 transition-opacity"
        aria-label="User menu"
        aria-expanded={open}
      >
        {initials}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl border border-border shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-dark text-white text-sm font-bold flex items-center justify-center shrink-0">
              {initials}
            </div>
            <div className="hidden md:block min-w-0">
              <p className="text-sm font-bold text-dark truncate">{fullName || "—"}</p>
              <p className="text-xs text-muted truncate">{role}</p>
            </div>
          </div>
          <div className="border-t border-border" />
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-dark hover:bg-surface transition-colors"
          >
            <LogoutIcon />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
