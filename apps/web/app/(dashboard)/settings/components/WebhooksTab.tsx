"use client";

import { useEffect, useState, FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { webhookApi } from "@/lib/api";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/utils";

const EVENT_TYPES = [
  "invoice.accepted",
  "invoice.rejected",
  "invoice.submission_failed",
  "invoice.dead_lettered",
  "invoice.cancelled",
];

interface Webhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

export function WebhooksTab() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ url: "", events: [] as string[] });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function loadWebhooks() {
    setLoading(true);
    setError("");
    try {
      const res = await webhookApi.list();
      // Backend returns WebhookSubscriptionResponse[] directly (not { data: [] })
      // and uses "eventTypes" not "events" — normalise both.
      type RawWebhook = Omit<Webhook, "events"> & { events?: string[]; eventTypes?: string[] };
      const arr = (Array.isArray(res) ? res : (res as unknown as { data?: unknown[] }).data ?? []) as RawWebhook[];
      setWebhooks(arr.map((w) => ({ ...w, events: w.events ?? w.eventTypes ?? [] })));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }

  // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadWebhooks(); }, []);

  function toggleEvent(ev: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((e) => e !== ev) : [...f.events, ev],
    }));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      // Backend CreateSubscriptionRequest expects "eventTypes" not "events".
      await webhookApi.create({ url: form.url, eventTypes: form.events });
      setShowCreate(false);
      setForm({ url: "", events: [] });
      loadWebhooks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create webhook");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this webhook?")) return;
    try {
      await webhookApi.delete(id);
      setWebhooks((w) => w.filter((x) => x.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function handleToggle(wh: Webhook) {
    try {
      await webhookApi.update(wh.id, { isActive: !wh.isActive });
      setWebhooks((ws) => ws.map((w) => w.id === wh.id ? { ...w, isActive: !w.isActive } : w));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>+ Add webhook</Button>
      </div>

      {showCreate && (
        <div className="p-5 bg-surface rounded-xl border border-border">
          <h3 className="font-medium text-dark mb-4">New webhook endpoint</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <Input label="Endpoint URL (HTTPS)" type="url"
              placeholder="https://your-app.com/webhooks/billinx"
              value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              required autoFocus />
            <div>
              <label className="block text-sm font-medium text-dark mb-2">Events to subscribe</label>
              <div className="grid grid-cols-1 gap-2">
                {EVENT_TYPES.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm text-dark cursor-pointer">
                    <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)}
                      className="rounded border-border text-green focus:ring-green/30" />
                    {ev}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <Button type="submit" loading={creating} disabled={form.events.length === 0}>Create</Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 py-2">
          {[0,1,2].map(i => <SkeletonTableRow key={i} />)}
        </div>
      ) : webhooks.length === 0 ? (
        <div className="p-8 text-center bg-surface rounded-xl border border-border">
          <p className="text-sm text-muted">No webhooks configured yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <div key={wh.id} className="p-4 bg-surface rounded-xl border border-border flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${wh.isActive ? "bg-green" : "bg-gray-300"}`} />
                  <p className="text-sm font-medium text-dark truncate">{wh.url}</p>
                </div>
                <div className="flex gap-2 flex-wrap mt-1.5">
                  {wh.events.map((ev) => (
                    <span key={ev} className="px-2 py-0.5 bg-white border border-border rounded text-xs text-muted">{ev}</span>
                  ))}
                </div>
                <p className="text-xs text-muted mt-1.5">Created {formatDate(wh.createdAt)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="secondary" size="sm" onClick={() => handleToggle(wh)}>
                  {wh.isActive ? "Disable" : "Enable"}
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(wh.id)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
