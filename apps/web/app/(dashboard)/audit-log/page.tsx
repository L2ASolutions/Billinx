'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRequireAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  eventType: string;
  actor: string;
  outcome: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'invoice' | 'submission' | 'user' | 'auth';
type TimeRange = '7' | '30' | '90' | 'all';

const TAB_OPTIONS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All events' },
  { key: 'invoice', label: 'Invoice events' },
  { key: 'submission', label: 'FIRS submissions' },
  { key: 'user', label: 'User events' },
  { key: 'auth', label: 'Auth events' },
];

const TIME_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'all', label: 'All time' },
];

function eventTypeToTab(eventType: string): FilterTab {
  const t = eventType.toLowerCase();
  if (t.startsWith('invoice')) return 'invoice';
  if (t.includes('submission') || t.includes('firs')) return 'submission';
  if (t.startsWith('user') || t.startsWith('team') || t.startsWith('invite')) return 'user';
  if (t.startsWith('login') || t.startsWith('logout') || t.startsWith('auth') || t.startsWith('password') || t.startsWith('mfa')) return 'auth';
  return 'all';
}

function outcomeBadge(outcome: string) {
  const o = outcome?.toLowerCase() ?? '';
  if (o === 'success' || o === 'accepted') return 'bg-green-50 text-green-700';
  if (o === 'failure' || o === 'rejected' || o === 'failed') return 'bg-red-50 text-red-600';
  return 'bg-gray-100 text-gray-600';
}

function Sk({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  useRequireAuth();

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('30');

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (timeRange !== 'all') {
        const since = new Date();
        since.setDate(since.getDate() - parseInt(timeRange));
        params.since = since.toISOString();
      }
      const res = await api.get<{ data: ActivityEvent[]; total: number }>(
        '/v1/activity?' + new URLSearchParams(params).toString(),
      );
      setEvents((res as { data: ActivityEvent[] }).data ?? []);
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
      ['Action', 'Actor', 'Outcome', 'Time'],
      ...filtered.map((e) => [
        e.eventType,
        e.actor,
        e.outcome ?? '',
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
          <p className="text-sm text-muted mt-0.5">Track all actions and events in your account</p>
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
        {/* Filters */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center justify-between px-4 border-b border-border">
            <div className="flex">
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
            {/* Time range */}
            <div className="flex items-center gap-1 py-2">
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

          {/* Error */}
          {error && (
            <div className="m-4 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3, 4].map((i) => <Sk key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-surface flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <p className="text-sm text-muted">No events found for this filter</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {['Action', 'Actor', 'Outcome', 'Time'].map((col, i) => (
                      <th key={col} className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide ${i === 3 ? 'text-right' : 'text-left'}`}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((event) => (
                    <tr key={event.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                      <td className="px-6 py-3 text-sm font-medium text-dark">
                        {(event.eventType ?? '').replace(/_/g, ' ')}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted font-mono">
                        {event.actor}
                      </td>
                      <td className="px-6 py-3">
                        {event.outcome ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${outcomeBadge(event.outcome)}`}>
                            {event.outcome}
                          </span>
                        ) : (
                          <span className="text-muted text-xs">—</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-sm text-muted text-right whitespace-nowrap">
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
