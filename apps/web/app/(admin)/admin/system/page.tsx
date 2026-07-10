"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";

interface QueueStatus {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface RetentionStats {
  archivedInvoices: number;
  archivedEvents: number;
  oldestInvoiceDate?: string;
  nextRunAt?: string;
}

interface AuditVerify {
  valid: boolean;
  totalEvents: number;
  invalidCount?: number;
  message?: string;
}

interface Metrics {
  invoicesToday?: number;
  invoicesThisWeek?: number;
  invoicesThisMonth?: number;
  acceptanceRate?: number;
  activeTenants?: number;
  systemErrors?: number;
  webhookDeliveryRate?: number;
}

function ActionCard({
  title,
  description,
  buttonLabel,
  buttonVariant = "primary",
  onAction,
  loading,
  result,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  buttonVariant?: "primary" | "warning" | "danger";
  onAction: () => void;
  loading: boolean;
  result?: string;
}) {
  const colors: Record<string, string> = {
    primary: "bg-dark text-white hover:bg-dark/90",
    warning: "bg-yellow-500 text-white hover:bg-yellow-600",
    danger: "bg-red-500 text-white hover:bg-red-600",
  };
  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <h3 className="font-semibold text-dark mb-1">{title}</h3>
      <p className="text-sm text-muted mb-4">{description}</p>
      <div className="flex items-center gap-3">
        <button
          disabled={loading}
          onClick={onAction}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${colors[buttonVariant]} disabled:opacity-50`}
        >
          {loading ? "Running…" : buttonLabel}
        </button>
        {result && (
          <span className="text-sm text-muted italic">{result}</span>
        )}
      </div>
    </div>
  );
}

function QueueCard({ title, q }: { title: string; q: QueueStatus | null }) {
  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <h3 className="font-semibold text-dark mb-3">{title}</h3>
      {!q ? (
        <p className="text-sm text-muted">—</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Waiting", value: q.waiting, color: "text-yellow-600" },
            { label: "Active", value: q.active, color: "text-blue-600" },
            { label: "Completed", value: q.completed, color: "text-green-700" },
            { label: "Failed", value: q.failed, color: "text-red-600" },
            { label: "Delayed", value: q.delayed, color: "text-orange-500" },
          ].map((s) => (
            <div key={s.label} className="text-center p-2 bg-surface rounded-lg">
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted">{s.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminSystemPage() {
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [bulkQueue, setBulkQueue] = useState<QueueStatus | null>(null);
  const [retention, setRetention] = useState<RetentionStats | null>(null);
  const [audit, setAudit] = useState<AuditVerify | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Action states
  const [retryLoading, setRetryLoading] = useState(false);
  const [retryResult, setRetryResult] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState("");
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [remindersResult, setRemindersResult] = useState("");
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionResult, setRetentionResult] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [q, bq, rs, m] = await Promise.allSettled([
        adminApi.queueStatus(),
        adminApi.bulkQueueStatus(),
        adminApi.retentionStats(),
        adminApi.metrics(),
      ]);
      if (q.status === "fulfilled") setQueue(q.value as QueueStatus);
      if (bq.status === "fulfilled") setBulkQueue(bq.value as QueueStatus);
      if (rs.status === "fulfilled") setRetention(rs.value as RetentionStats);
      if (m.status === "fulfilled") setMetrics(m.value as Metrics);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load system stats");
    } finally {
      setLoading(false);
    }
  }

  // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAll(); }, []);

  async function handleRetryFailed() {
    setRetryLoading(true);
    setRetryResult("");
    try {
      const res = await adminApi.retryFailed() as { requeued?: number };
      setRetryResult(`${res?.requeued ?? "?"} jobs re-queued`);
      loadAll();
    } catch (err: unknown) {
      setRetryResult(err instanceof Error ? err.message : "Failed");
    } finally {
      setRetryLoading(false);
    }
  }

  async function handleRecovery() {
    setRecoveryLoading(true);
    setRecoveryResult("");
    try {
      const res = await adminApi.runRecovery() as { recovered?: number; message?: string };
      setRecoveryResult(res?.message ?? `${res?.recovered ?? "?"} invoices recovered`);
    } catch (err: unknown) {
      setRecoveryResult(err instanceof Error ? err.message : "Failed");
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleReminders() {
    setRemindersLoading(true);
    setRemindersResult("");
    try {
      const res = await adminApi.runReminders() as { sent?: number; message?: string };
      setRemindersResult(res?.message ?? `${res?.sent ?? "?"} reminders sent`);
    } catch (err: unknown) {
      setRemindersResult(err instanceof Error ? err.message : "Failed");
    } finally {
      setRemindersLoading(false);
    }
  }

  async function handleRetention() {
    setRetentionLoading(true);
    setRetentionResult("");
    try {
      const res = await adminApi.runRetention() as { archived?: number; message?: string };
      setRetentionResult(res?.message ?? `${res?.archived ?? "?"} records archived`);
      loadAll();
    } catch (err: unknown) {
      setRetentionResult(err instanceof Error ? err.message : "Failed");
    } finally {
      setRetentionLoading(false);
    }
  }

  async function handleVerifyAudit() {
    setAuditLoading(true);
    try {
      const res = await adminApi.verifyAudit();
      setAudit(res as AuditVerify);
    } catch (err: unknown) {
      setAudit({ valid: false, totalEvents: 0, message: err instanceof Error ? err.message : "Verification failed" });
    } finally {
      setAuditLoading(false);
    }
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-dark">System Operations</h1>
        <button
          onClick={loadAll}
          className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted hover:text-dark hover:bg-surface transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
      )}

      {/* Platform Metrics */}
      {metrics && (
        <section>
          <h2 className="text-base font-semibold text-dark mb-3">Platform Metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Today's Invoices", value: metrics.invoicesToday ?? "—" },
              { label: "This Week", value: metrics.invoicesThisWeek ?? "—" },
              { label: "This Month", value: metrics.invoicesThisMonth ?? "—" },
              { label: "Acceptance Rate", value: metrics.acceptanceRate != null ? `${metrics.acceptanceRate}%` : "—" },
              { label: "Active Tenants", value: metrics.activeTenants ?? "—" },
              { label: "System Errors", value: metrics.systemErrors ?? "—" },
              { label: "Webhook Rate", value: metrics.webhookDeliveryRate != null ? `${metrics.webhookDeliveryRate}%` : "—" },
            ].map((m) => (
              <div key={m.label} className="bg-white rounded-xl border border-border p-4">
                <p className="text-xs text-muted mb-1">{m.label}</p>
                <p className="text-xl font-bold text-dark">{String(m.value)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Queue Status */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <section>
            <h2 className="text-base font-semibold text-dark mb-3">Queue Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <QueueCard title="Submission Queue" q={queue} />
              <QueueCard title="Bulk Submission Queue" q={bulkQueue} />
            </div>
          </section>

          {/* Retention stats */}
          {retention && (
            <section>
              <h2 className="text-base font-semibold text-dark mb-3">Data Retention</h2>
              <div className="bg-white rounded-xl border border-border p-5">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted">Archived Invoices</p>
                    <p className="font-semibold text-dark">{retention.archivedInvoices?.toLocaleString() ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted">Archived Events</p>
                    <p className="font-semibold text-dark">{retention.archivedEvents?.toLocaleString() ?? "—"}</p>
                  </div>
                  {retention.nextRunAt && (
                    <div>
                      <p className="text-muted">Next Run</p>
                      <p className="font-semibold text-dark">{retention.nextRunAt}</p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* Audit chain */}
      {audit && (
        <div className={`p-4 rounded-xl border ${audit.valid ? "bg-green-50 border-green/20" : "bg-red-50 border-red-200"}`}>
          <p className={`text-sm font-semibold ${audit.valid ? "text-green-700" : "text-red-600"}`}>
            Audit Chain: {audit.valid ? "✓ Valid" : "✗ Invalid"}
          </p>
          <p className="text-xs text-muted mt-1">
            {audit.totalEvents} total events
            {audit.invalidCount ? ` · ${audit.invalidCount} invalid` : ""}
            {audit.message ? ` · ${audit.message}` : ""}
          </p>
        </div>
      )}

      {/* Actions */}
      <section>
        <h2 className="text-base font-semibold text-dark mb-3">Manual Operations</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ActionCard
            title="Retry Failed Jobs"
            description="Re-queue all failed submission jobs back into the processing queue."
            buttonLabel="Retry Failed"
            onAction={handleRetryFailed}
            loading={retryLoading}
            result={retryResult}
          />
          <ActionCard
            title="Power-Failure Recovery"
            description="Reconcile stuck SUBMITTING invoices — resets them so they can be re-queued."
            buttonLabel="Run Recovery"
            buttonVariant="warning"
            onAction={handleRecovery}
            loading={recoveryLoading}
            result={recoveryResult}
          />
          <ActionCard
            title="Payment Reminders"
            description="Trigger the payment reminder check across all tenants immediately."
            buttonLabel="Send Reminders"
            onAction={handleReminders}
            loading={remindersLoading}
            result={remindersResult}
          />
          <ActionCard
            title="Data Retention"
            description="Manually trigger archiving of invoices older than 7 years and events older than 2 years."
            buttonLabel="Run Archiving"
            buttonVariant="warning"
            onAction={handleRetention}
            loading={retentionLoading}
            result={retentionResult}
          />
          <ActionCard
            title="Verify Audit Chain"
            description="Recompute and validate the hash-chained immutable audit log integrity."
            buttonLabel="Verify Chain"
            onAction={handleVerifyAudit}
            loading={auditLoading}
          />
        </div>
      </section>
    </div>
  );
}
