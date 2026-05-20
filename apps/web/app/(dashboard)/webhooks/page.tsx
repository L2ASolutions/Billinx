"use client";

import { useEffect, useState, FormEvent } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { webhookApi } from "@/lib/api";
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

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ url: "", events: [] as string[] });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await webhookApi.list();
      setWebhooks(res.data as Webhook[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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
      await webhookApi.create(form);
      setShowCreate(false);
      setForm({ url: "", events: [] });
      load();
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
    <>
      <Topbar
        title="Webhooks"
        actions={
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            + Add webhook
          </Button>
        }
      />

      <div className="p-6 space-y-4">
        {showCreate && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Create webhook</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <Input
                label="Endpoint URL (HTTPS)"
                type="url"
                placeholder="https://your-app.com/webhooks/billinx"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                required
                autoFocus
              />
              <div>
                <label className="block text-sm font-medium text-dark mb-2">Events</label>
                <div className="space-y-2">
                  {EVENT_TYPES.map((ev) => (
                    <label key={ev} className="flex items-center gap-2 text-sm text-dark cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.events.includes(ev)}
                        onChange={() => toggleEvent(ev)}
                        className="rounded border-border text-green focus:ring-green/30"
                      />
                      {ev}
                    </label>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-3">
                <Button type="submit" loading={creating} disabled={form.events.length === 0}>
                  Create
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl border border-border">
          {loading ? (
            <div className="p-12 flex justify-center">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : webhooks.length === 0 ? (
            <div className="p-12 text-center text-muted text-sm">
              No webhooks configured yet.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {webhooks.map((wh) => (
                <div key={wh.id} className="p-6 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full ${wh.isActive ? "bg-green" : "bg-gray-300"}`} />
                      <p className="text-sm font-medium text-dark truncate">{wh.url}</p>
                    </div>
                    <div className="flex gap-2 flex-wrap mt-2">
                      {wh.events.map((ev) => (
                        <span key={ev} className="px-2 py-0.5 bg-surface border border-border rounded text-xs text-muted">
                          {ev}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted mt-2">Created {formatDate(wh.createdAt)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleToggle(wh)}
                    >
                      {wh.isActive ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(wh.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
