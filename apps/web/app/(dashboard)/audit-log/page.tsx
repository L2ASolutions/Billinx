'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRequireAuth } from '@/lib/auth';
import { activityApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  eventType: string;
  actor: string;
  actorEmail?: string;
  actorName?: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  occurredAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'invoice' | 'submission' | 'user' | 'auth' | 'api';
type TimeRange = '7' | '30' | '90' | 'all';

const TAB_OPTIONS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All events' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'submission', label: 'Submissions' },
  { key: 'user', label: 'Team' },
  { key: 'auth', label: 'Auth' },
  { key: 'api', label: 'API & Webhooks' },
];

const TIME_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'all', label: 'All time' },
];

const EVENT_LABELS: Record<string, string> = {
  USER_LOGIN: 'User login',
  USER_LOGOUT: 'User logout',
  USER_LOGIN_FAILED: 'Login failed',
  USER_CREATED: 'User created',
  USER_INVITED: 'User invited',
  USER_DEACTIVATED: 'User deactivated',
  INVOICE_CREATED: 'Invoice created',
  INVOICE_VALIDATED: 'Invoice validated',
  INVOICE_SUBMITTED: 'Invoice submitted',
  INVOICE_ACCEPTED: 'Invoice accepted',
  INVOICE_REJECTED: 'Invoice rejected',
  INVOICE_CANCELLED: 'Invoice cancelled',
  INVOICE_VIEWED: 'Invoice viewed',
  INVOICE_OVERDUE: 'Invoice overdue',
  PAYMENT_RECORDED: 'Payment recorded',
  API_KEY_CREATED: 'API key created',
  API_KEY_REVOKED: 'API key revoked',
  WEBHOOK_CREATED: 'Webhook created',
  WEBHOOK_DELIVERED: 'Webhook delivered',
  WEBHOOK_FAILED: 'Webhook failed',
  PRODUCT_CREATED: 'Product created',
  PRODUCT_UPDATED: 'Product updated',
  EXPORT_GENERATED: 'Export generated',
  REMINDER_SENT: 'Reminder sent',
  PASSWORD_RESET: 'Password reset',
  TENANT_CREATED: 'Tenant created',
  TENANT_UPDATED: 'Tenant updated',
  SYSTEM_ERROR: 'System error',
};

function eventTypeToTab(eventType: string): FilterTab {
  const t = eventType.toLowerCase();
  if (t.includes('invoice_accepted') || t.includes('invoice_rejected') || t.includes('invoice_submitted')) return 'submission';
  if (t.startsWith('invoice') || t.includes('payment')) return 'invoice';
  if (t.includes('api_key') || t.includes('webhook')) return 'api';
  if (t.startsWith('user') || t.startsWith('team') || t.includes('invite') || t.includes('product')) return 'user';
  if (t.includes('login') || t.includes('logout') || t.includes('auth') || t.includes('password') || t.includes('mfa')) return 'auth';
  return 'all';
}

function eventDotColor(eventType: string): string {
  const t = eventType.toLowerCase();
  if (t.includes('accepted') || t.includes('created') || t.includes('recorded')) return 'bg-green-500';
  if (t.includes('rejected') || t.includes('failed') || t.includes('error')) return 'bg-red-500';
  if (t.includes('cancelled') || t.includes('revoked') || t.includes('deactivated')) return 'bg-amber-500';
  if (t.includes('submitted') || t.includes('login')) return 'bg-blue-500';
  return 'bg-gray-400';
}

function displayActor(event: ActivityEvent): string {
  if (event.actorName) return event.actorName;
  if (event.actorEmail) return event.actorEmail;
  const actor = event.actor ?? '';
  if (actor.startsWith('user:')) return actor.replace('user:', '').substring(0, 8) + '…';
  if (actor.startsWith('system:')) return actor.replace('system:', '') + ' (system)';
  return actor;
}

function Sk({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  useRequireAuth();

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('30');

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { limit: '200' };
      if (timeRange !== 'all') {
        const since = new Date();
        since.setDate(since.getDate() - parseInt(timeRange));
        params.since = since.toISOString();
      }
      const res = await activityApi.list(params);
      setEvents((res.data as unknown as ActivityEvent[]) ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load audit log');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const filtered = tab === 'all' ? events : events.filter((e) => eventTypeToTab(e.eventType) === tab);

  const handleExport = () => {
    const rows = [
      ['Action', 'Actor', 'Actor Email', 'Entity', 'Time'],
      ...filtered.map((e) => [
        EVENT_LABELS[e.eventType] ?? e.eventType,
        displayActor(e),
        e.actorEmail ?? '',
        e.entityType ? `${e.entityType}${e.entityId ? ':' + e.entityId.substring(0, 8) : ''}` : '',
        new Date(e.occurredAt).toISOString(),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="bg-white border-b border-border px-6 py-5 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-bold text-dark">Audit log</h1>
          <p className="text-sm text-muted mt-0.5">
            {loading ? 'Loading…' : `${total.toLocaleString()} events total`}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-dark hover:bg-surface transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export CSV
        </button>
      </header>

      <div className="p-6">
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {/* Tab bar + time range */}
          <div className="flex items-center justify-between px-4 border-b border-border">
            <div className="flex overflow-x-auto">
              {TAB_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    tab === key
                      ? 'border-green text-green'
                      : 'border-transparent text-muted hover:text-dark'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 py-2 shrink-0 ml-4">
              {TIME_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTimeRange(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    timeRange === key
                      ? 'bg-dark text-white'
                      : 'text-muted hover:bg-surface hover:text-dark'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="m-4 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">{error}</div>
          )}

          {loading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3, 4, 5].map((i) => <Sk key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <p className="text-sm text-muted">No events in this period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface/50">
                    <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left w-5" />
                    <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left">Action</th>
                    <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left">Actor</th>
                    <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-left hidden md:table-cell">Entity</th>
                    <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((event) => (
                    <tr key={event.id} className="border-b border-border last:border-0 hover:bg-surface/40 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className={`w-2 h-2 rounded-full ${eventDotColor(event.eventType)}`} />
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-sm font-medium text-dark">
                          {EVENT_LABELS[event.eventType] ?? event.eventType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm text-dark truncate max-w-[200px]">
                            {displayActor(event)}
                          </span>
                          {event.actorName && event.actorEmail && (
                            <span className="text-xs text-muted truncate max-w-[200px]">{event.actorEmail}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        {event.entityType ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface text-xs text-muted border border-border">
                            {event.entityType}
                          </span>
                        ) : (
                          <span className="text-muted text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-muted text-right whitespace-nowrap">
                        {formatDate(event.occurredAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
