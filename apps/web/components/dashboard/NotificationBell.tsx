"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { activityApi, type ActivityEvent } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: "accepted" | "rejected" | "overdue" | "payment" | "other";
  title: string;
  description: string;
  occurredAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RELEVANT_TYPES = new Set([
  "INVOICE_ACCEPTED",
  "INVOICE_REJECTED",
  "INVOICE_OVERDUE",
  "PAYMENT_RECORDED",
]);

const READ_KEY = "billinx_read_notifications";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch {}
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function toNotification(ev: ActivityEvent): Notification | null {
  const irn = (ev.payload?.platformIrn as string) ?? (ev.payload?.irn as string) ?? ev.entityId ?? "INV";
  const shortIrn = irn.split("-").slice(-1)[0] ?? irn;

  switch (ev.eventType) {
    case "INVOICE_ACCEPTED":
      return {
        id: ev.id,
        type: "accepted",
        title: "Invoice accepted",
        description: `${shortIrn} was accepted by FIRS`,
        occurredAt: ev.occurredAt,
      };
    case "INVOICE_REJECTED":
      return {
        id: ev.id,
        type: "rejected",
        title: "Invoice rejected",
        description: `${shortIrn} was rejected by FIRS`,
        occurredAt: ev.occurredAt,
      };
    case "INVOICE_OVERDUE": {
      const days = (ev.payload?.daysOverdue as number) ?? 0;
      return {
        id: ev.id,
        type: "overdue",
        title: "Invoice overdue",
        description: `${shortIrn} is${days ? ` ${days} days` : ""} overdue`,
        occurredAt: ev.occurredAt,
      };
    }
    case "PAYMENT_RECORDED": {
      const amt = ev.payload?.amount as number | undefined;
      const formatted = amt != null ? `₦${Number(amt).toLocaleString()}` : "Payment";
      return {
        id: ev.id,
        type: "payment",
        title: "Payment received",
        description: `${formatted} recorded for ${shortIrn}`,
        occurredAt: ev.occurredAt,
      };
    }
    default:
      return null;
  }
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function BellIcon({ hasUnread }: { hasUnread: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={hasUnread ? "currentColor" : "currentColor"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function NotifIcon({ type }: { type: Notification["type"] }) {
  if (type === "accepted") {
    return (
      <div className="w-8 h-8 rounded-full bg-green/10 flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    );
  }
  if (type === "rejected") {
    return (
      <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
    );
  }
  if (type === "overdue") {
    return (
      <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
    );
  }
  if (type === "payment") {
    return (
      <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await activityApi.list({ limit: "50" });
      const notifs = data
        .filter((ev) => RELEVANT_TYPES.has(ev.eventType))
        .slice(0, 20)
        .map(toNotification)
        .filter((n): n is Notification => n !== null);
      setNotifications(notifs);
    } catch {}
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReadIds(getReadIds());
    // Defer so the notification fetch doesn't fire alongside main page data
    const t = setTimeout(() => load(), 2000);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  function markAllRead() {
    const all = new Set([...readIds, ...notifications.map((n) => n.id)]);
    setReadIds(all);
    saveReadIds(all);
  }

  function handleOpen() {
    setOpen((v) => !v);
    if (!open) load();
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-dark transition-colors"
        aria-label="Notifications"
      >
        <BellIcon hasUnread={unreadCount > 0} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-border shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-dark">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-green hover:text-green-dark font-medium transition-colors"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted">No notifications</div>
            ) : (
              notifications.map((n) => {
                const isRead = readIds.has(n.id);
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 ${isRead ? "" : "bg-blue-50/40"}`}
                  >
                    <NotifIcon type={n.type} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-dark leading-snug">{n.title}</p>
                      <p className="text-xs text-muted mt-0.5 leading-snug truncate">{n.description}</p>
                      <p className="text-[11px] text-muted/70 mt-1">{timeAgo(n.occurredAt)}</p>
                    </div>
                    {!isRead && (
                      <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
