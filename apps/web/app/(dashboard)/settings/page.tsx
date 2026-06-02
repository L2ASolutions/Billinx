"use client";

import { useEffect, useState, FormEvent, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiKeyApi, reminderApi, webhookApi, api, referenceApi } from "@/lib/api";
import { Skeleton, SkeletonTableRow } from "@/components/ui/Skeleton";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";

// ── Tab types ─────────────────────────────────────────────────────────────────

type MainTab = "company" | "notifications" | "security" | "invoicing" | "integrations";
type IntegTab = "apikeys" | "webhooks" | "reminders";

// ── Shared helpers ────────────────────────────────────────────────────────────

function sel(cls = "") {
  return `w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green ${cls}`;
}

const EVENT_TYPES = [
  "invoice.accepted",
  "invoice.rejected",
  "invoice.submission_failed",
  "invoice.dead_lettered",
  "invoice.cancelled",
];

// ── API Keys tab ──────────────────────────────────────────────────────────────

interface ApiKey {
  id: string;
  name: string;
  environment: string;
  keyPrefix: string;
  requestCount: number;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newEnv, setNewEnv] = useState("test");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [rotatedKey, setRotatedKey] = useState<{ id: string; key: string } | null>(null);
  const [keyError, setKeyError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [rotatingId, setRotatingId] = useState<string | null>(null);

  async function loadKeys() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await apiKeyApi.list();
      // Backend returns ApiKey[] directly (not { data: [] }) — handle both shapes.
      const arr = (Array.isArray(res) ? res : (res as any).data ?? []) as ApiKey[];
      setKeys(arr);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadKeys(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setKeyError("");
    setCreating(true);
    try {
      const res = await apiKeyApi.create(newLabel, newEnv);
      setNewKey(res.key);
      setNewLabel("");
      loadKeys();
    } catch (err: unknown) {
      setKeyError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRotate(id: string) {
    if (!confirm("Rotate this key? The old key will have a 24-hour grace period.")) return;
    setRotatingId(id);
    try {
      const res = await apiKeyApi.rotate(id);
      setRotatedKey({ id, key: res.key });
      loadKeys();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Rotate failed");
    } finally {
      setRotatingId(null);
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`Revoke key "${name}"? This cannot be undone.`)) return;
    try {
      await apiKeyApi.revoke(id);
      setKeys((k) => k.filter((x) => x.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Revoke failed");
    }
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{loadError}</div>
      )}

      {(newKey || rotatedKey) && (
        <div className="p-4 bg-green-light border border-green/20 rounded-xl">
          <p className="text-xs font-medium text-dark mb-1">
            {rotatedKey ? "Rotated API key — copy now, won't be shown again:" : "New API key — copy it now, it won't be shown again:"}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm text-dark bg-white px-3 py-2 rounded-lg border border-border break-all">
              {newKey || rotatedKey?.key}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(newKey || rotatedKey?.key || "")}
              className="text-green hover:text-green-dark text-sm font-medium shrink-0"
            >
              Copy
            </button>
          </div>
          <button onClick={() => { setNewKey(""); setRotatedKey(null); }}
            className="text-xs text-muted mt-2 hover:text-dark">Dismiss</button>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-48">
          <Input label="Label" placeholder="e.g. Production App" value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-dark mb-1">Environment</label>
          <select className={sel("w-auto")} value={newEnv} onChange={(e) => setNewEnv(e.target.value)}>
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </div>
        <Button type="submit" loading={creating}>Create key</Button>
      </form>
      {keyError && <p className="text-sm text-red-500">{keyError}</p>}

      {loading ? (
        <div className="space-y-3 py-2">
          {[0,1,2].map(i => <SkeletonTableRow key={i} />)}
        </div>
      ) : keys.length === 0 ? (
        <div className="p-8 text-center bg-surface rounded-xl border border-border">
          <p className="text-sm text-muted">No API keys yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div key={key.id} className="p-4 bg-surface rounded-xl border border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-dark">{key.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${key.environment === "live" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {key.environment}
                    </span>
                    {key.expiresAt && new Date(key.expiresAt) < new Date() && (
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-50 text-red-600">Expired</span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    <span className="font-mono">{key.keyPrefix}••••</span>
                    {" · "}{(key.requestCount ?? 0).toLocaleString()} requests
                    {" · "}Created {formatDate(key.createdAt)}
                    {key.lastUsedAt && ` · Last used ${formatDate(key.lastUsedAt)}`}
                    {key.expiresAt && ` · Expires ${formatDate(key.expiresAt)}`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" size="sm" loading={rotatingId === key.id}
                    onClick={() => handleRotate(key.id)}>Rotate</Button>
                  <Button variant="danger" size="sm"
                    onClick={() => handleRevoke(key.id, key.name)}>Revoke</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Webhooks tab ──────────────────────────────────────────────────────────────

interface Webhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

function WebhooksTab() {
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
      const arr = (Array.isArray(res) ? res : (res as any).data ?? []) as any[];
      setWebhooks(arr.map((w: any) => ({ ...w, events: w.events ?? w.eventTypes ?? [] })));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }

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

// ── Reminders tab ─────────────────────────────────────────────────────────────

interface ReminderRule {
  id: string;
  name: string;
  triggerType: string;
  triggerDays: number;
  reminderMessage: string;
  isActive: boolean;
  isDefault: boolean;
}

interface ReminderForm {
  name: string;
  triggerType: string;
  triggerDays: string;
  reminderMessage: string;
}

const TRIGGER_TYPES = [
  { value: "BEFORE_DUE", label: "Before due date" },
  { value: "ON_DUE",     label: "On due date" },
  { value: "AFTER_DUE",  label: "After due date (overdue)" },
];

const EMPTY_RULE: ReminderForm = { name: "", triggerType: "BEFORE_DUE", triggerDays: "3", reminderMessage: "" };

function RemindersTab() {
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editRule, setEditRule] = useState<ReminderRule | null>(null);
  const [form, setForm] = useState<ReminderForm>(EMPTY_RULE);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await reminderApi.list();
      setRules(res.data as ReminderRule[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load reminder rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(rule: ReminderRule) {
    setTogglingId(rule.id);
    try {
      await reminderApi.update(rule.id, { isActive: !rule.isActive });
      setRules((rs) => rs.map((r) => r.id === rule.id ? { ...r, isActive: !r.isActive } : r));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Update failed");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this reminder rule?")) return;
    try {
      await reminderApi.delete(id);
      setRules((rs) => rs.filter((r) => r.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function handleSubmit() {
    setFormError("");
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        triggerType: form.triggerType,
        triggerDays: parseInt(form.triggerDays, 10),
        reminderMessage: form.reminderMessage,
      };
      if (editRule) await reminderApi.update(editRule.id, payload);
      else await reminderApi.create(payload);
      setShowModal(false);
      load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Send automatic payment reminders to buyers before or after due dates.</p>
        <Button size="sm" onClick={() => { setEditRule(null); setForm(EMPTY_RULE); setFormError(""); setShowModal(true); }}>
          + Add rule
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3 py-2">
          {[0,1,2].map(i => <SkeletonTableRow key={i} />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="p-8 text-center bg-surface rounded-xl border border-border">
          <p className="text-sm text-muted mb-3">No reminder rules configured.</p>
          <Button size="sm" onClick={() => { setEditRule(null); setForm(EMPTY_RULE); setFormError(""); setShowModal(true); }}>
            Add first rule
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="p-4 bg-surface rounded-xl border border-border">
              <div className="flex items-start gap-4">
                <button
                  className={`mt-0.5 w-10 h-6 rounded-full transition-colors shrink-0 ${rule.isActive ? "bg-green" : "bg-gray-200"} ${togglingId === rule.id ? "opacity-50" : ""}`}
                  onClick={() => handleToggle(rule)} disabled={togglingId === rule.id}>
                  <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${rule.isActive ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-dark">{rule.name}</span>
                    {rule.isDefault && <span className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">Default</span>}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {TRIGGER_TYPES.find((t) => t.value === rule.triggerType)?.label ?? rule.triggerType}
                    {" — "}{rule.triggerDays} day{rule.triggerDays !== 1 ? "s" : ""}
                  </p>
                  {rule.reminderMessage && (
                    <p className="text-xs text-muted mt-1 italic line-clamp-1">&ldquo;{rule.reminderMessage}&rdquo;</p>
                  )}
                </div>
                {!rule.isDefault && (
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="secondary"
                      onClick={() => { setEditRule(rule); setForm({ name: rule.name, triggerType: rule.triggerType, triggerDays: String(rule.triggerDays), reminderMessage: rule.reminderMessage }); setFormError(""); setShowModal(true); }}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(rule.id)}>Delete</Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">{editRule ? "Edit rule" : "Add reminder rule"}</h2>
              <button onClick={() => setShowModal(false)} className="text-muted hover:text-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {formError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{formError}</div>}
              <Input label="Rule name *" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. 3-day reminder" />
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Trigger *</label>
                <select className={sel()} value={form.triggerType}
                  onChange={(e) => setForm((f) => ({ ...f, triggerType: e.target.value }))}>
                  {TRIGGER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <Input label="Days *" type="number" value={form.triggerDays}
                onChange={(e) => setForm((f) => ({ ...f, triggerDays: e.target.value }))} placeholder="Number of days" />
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Message</label>
                <textarea className={`${sel()} resize-none`} rows={3} value={form.reminderMessage}
                  onChange={(e) => setForm((f) => ({ ...f, reminderMessage: e.target.value }))}
                  placeholder="Reminder message sent to buyer…" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button loading={submitting} disabled={!form.name} onClick={handleSubmit}>
                {editRule ? "Save changes" : "Add rule"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Company profile tab ───────────────────────────────────────────────────────

interface TenantProfile {
  businessName?: string;
  tin?: string;
  industry?: string;
  registrationNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  lga?: string;
  postalZone?: string;
  country?: string;
  phone?: string;
  website?: string;
  telephone?: string;
  businessDescription?: string;
  bankName?: string;
  bankAccount?: string;
  bankAccountName?: string;
}

function CompanyTab() {
  const [profile, setProfile] = useState<TenantProfile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [states, setStates] = useState<{ code: string; name: string }[]>([]);
  const [lgas, setLgas] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    referenceApi.states().then(setStates).catch(() => {});
    api.get<TenantProfile>("/v1/tenants/me")
      .then((data) => setProfile(data ?? {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!profile.state) { setLgas([]); return; }
    referenceApi.lgas(profile.state).then(setLgas).catch(() => setLgas([]));
  }, [profile.state]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.patch("/v1/tenants/me", profile);
      setSuccess("Company profile saved.");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const uf = (field: keyof TenantProfile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setProfile((p) => ({ ...p, [field]: e.target.value }));

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-xl border border-border p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0,1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}
      {success && <div className="p-3 bg-green-light border border-green/20 rounded-xl text-sm text-dark">{success}</div>}

      {/* Business information */}
      <div className="bg-white rounded-xl border border-border p-6">
        <h3 className="font-semibold text-dark mb-4">Business information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Business name" placeholder="Acme Limited" value={profile.businessName ?? ""}
            onChange={uf("businessName")} />
          <Input label="TIN" placeholder="12345678-0001" value={profile.tin ?? ""}
            onChange={uf("tin")} />
          <Input label="Industry" placeholder="e.g. Technology, Manufacturing" value={profile.industry ?? ""}
            onChange={uf("industry")} />
          <Input label="CAC registration number" placeholder="RC-000000" value={profile.registrationNumber ?? ""}
            onChange={uf("registrationNumber")} />
          <Input label="Phone" type="tel" placeholder="+234 800 000 0000" value={profile.phone ?? ""}
            onChange={uf("phone")} />
          <Input label="Website" type="url" placeholder="https://yourcompany.com" value={profile.website ?? ""}
            onChange={uf("website")} />
          <Input label="Telephone (for FIRS invoices)" type="tel" placeholder="+2348012345678" value={profile.telephone ?? ""}
            onChange={uf("telephone")} />
          <div className="md:col-span-2">
            <Input label="Business description (for FIRS invoices)" placeholder="e.g. Software services company"
              value={profile.businessDescription ?? ""} onChange={uf("businessDescription")} />
          </div>
          <div className="md:col-span-2 pt-2 border-t border-border">
            <p className="text-sm font-medium text-dark mb-3">Bank transfer details (shown on payment page)</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input label="Bank name" placeholder="e.g. GTBank, Access Bank" value={profile.bankName ?? ""}
                onChange={uf("bankName")} />
              <Input label="Account number" placeholder="0123456789" value={profile.bankAccount ?? ""}
                onChange={uf("bankAccount")} />
              <Input label="Account name" placeholder="Company name on account" value={profile.bankAccountName ?? ""}
                onChange={uf("bankAccountName")} />
            </div>
          </div>
        </div>
      </div>

      {/* Registered address */}
      <div className="bg-white rounded-xl border border-border p-6">
        <h3 className="font-semibold text-dark mb-4">Registered address</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Input label="Street address" placeholder="1 Broad Street" value={profile.address ?? ""}
              onChange={uf("address")} />
          </div>
          <Input label="City" placeholder="Lagos" value={profile.city ?? ""} onChange={uf("city")} />
          <div>
            <label className="block text-sm font-medium text-dark mb-1">State</label>
            <select className={sel()} value={profile.state ?? ""} onChange={uf("state")}>
              <option value="">Select state…</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">LGA</label>
            <select className={sel()} value={profile.lga ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, lga: e.target.value }))}
              disabled={!profile.state}>
              <option value="">{profile.state ? "Select LGA…" : "Select state first"}</option>
              {lgas.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <Input label="Postal zone" placeholder="e.g. 100001" value={profile.postalZone ?? ""}
            onChange={uf("postalZone")} />
          <Input label="Country" placeholder="Nigeria" value={profile.country ?? ""} onChange={uf("country")} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={saving}>Save changes</Button>
      </div>
    </form>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: "company",       label: "Company profile" },
  { id: "notifications", label: "Notifications" },
  { id: "security",      label: "Security" },
  { id: "invoicing",     label: "Invoicing" },
  { id: "integrations",  label: "Integrations" },
];

const INTEG_TABS: { id: IntegTab; label: string }[] = [
  { id: "apikeys",   label: "API keys" },
  { id: "webhooks",  label: "Webhooks" },
  { id: "reminders", label: "Reminder rules" },
];

function SettingsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();

  const tabParam = params.get("tab") as MainTab | null;
  const [mainTab, setMainTab] = useState<MainTab>(tabParam ?? "company");
  const [integTab, setIntegTab] = useState<IntegTab>("apikeys");

  function switchMain(tab: MainTab) {
    setMainTab(tab);
    router.replace(`/settings?tab=${tab}`, { scroll: false });
  }

  return (
    <>
      <Topbar title="Settings" />

      <div className="p-6 max-w-4xl space-y-6">
        {/* Main tab bar */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex border-b border-border px-4">
            {MAIN_TABS.map((t) => (
              <button key={t.id} onClick={() => switchMain(t.id)}
                className={`px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  mainTab === t.id
                    ? "border-green text-green"
                    : "border-transparent text-muted hover:text-dark"
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* Company profile */}
            {mainTab === "company" && <CompanyTab />}

            {/* Notifications */}
            {mainTab === "notifications" && (
              <div className="space-y-4">
                <p className="text-sm text-muted">Configure which events trigger email notifications.</p>
                {[
                  { label: "Invoice accepted by FIRS", desc: "When a submitted invoice is confirmed by FIRS NRS" },
                  { label: "Invoice rejected", desc: "When FIRS rejects an invoice with an error code" },
                  { label: "Payment recorded", desc: "When a payment is recorded against an invoice" },
                  { label: "Team member joined", desc: "When a team member accepts an invitation" },
                  { label: "API key expiring", desc: "7-day and 1-day warning before an API key expires" },
                ].map((item) => (
                  <label key={item.label}
                    className="flex items-center justify-between p-4 bg-surface rounded-xl border border-border cursor-pointer hover:bg-white transition-colors">
                    <div>
                      <p className="text-sm font-medium text-dark">{item.label}</p>
                      <p className="text-xs text-muted">{item.desc}</p>
                    </div>
                    <div className="w-10 h-6 rounded-full bg-green relative shrink-0">
                      <span className="block w-4 h-4 rounded-full bg-white shadow transition-transform translate-x-5 mx-1 mt-1" />
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* Security */}
            {mainTab === "security" && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-border p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-dark">Profile</p>
                      <p className="text-xs text-muted mt-0.5">{user?.email} · {user?.role}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-green-light flex items-center justify-center text-green font-bold">
                      {user?.name?.[0]?.toUpperCase() ?? "U"}
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-border p-5">
                  <p className="text-sm font-semibold text-dark mb-1">Two-factor authentication</p>
                  <p className="text-xs text-muted mb-3">TOTP MFA is required for Owner and Admin roles.</p>
                  <Button size="sm" variant="secondary">Manage MFA →</Button>
                </div>
                <div className="bg-white rounded-xl border border-border p-5">
                  <p className="text-sm font-semibold text-dark mb-1">Change password</p>
                  <p className="text-xs text-muted mb-3">Send yourself a password reset email.</p>
                  <Button size="sm" variant="secondary">Send reset email →</Button>
                </div>
                <div className="bg-white rounded-xl border border-border p-5">
                  <p className="text-sm font-semibold text-dark mb-1">Active sessions</p>
                  <p className="text-xs text-muted mb-3">Revoke all other sessions if you think your account has been compromised.</p>
                  <Button size="sm" variant="danger">Revoke all other sessions</Button>
                </div>
              </div>
            )}

            {/* Invoicing */}
            {mainTab === "invoicing" && (
              <div className="space-y-4">
                <p className="text-sm text-muted">Default settings applied to new invoices.</p>
                <div className="bg-white rounded-xl border border-border p-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">Default VAT rate (%)</label>
                    <input type="number" min="0" max="100" step="0.5" defaultValue="7.5"
                      className="px-3 py-2 rounded-lg border border-border text-dark text-sm w-32 focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">Default payment terms (days)</label>
                    <input type="number" min="0" defaultValue="30"
                      className="px-3 py-2 rounded-lg border border-border text-dark text-sm w-32 focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-dark mb-1">Default currency</label>
                    <select className={`${sel()} w-32`}>
                      <option value="NGN">NGN</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <Button size="sm">Save defaults</Button>
                </div>
              </div>
            )}

            {/* Integrations */}
            {mainTab === "integrations" && (
              <div className="space-y-5">
                {/* Sub-tab bar */}
                <div className="flex gap-1 bg-surface rounded-lg p-1 border border-border w-fit">
                  {INTEG_TABS.map((t) => (
                    <button key={t.id} onClick={() => setIntegTab(t.id)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        integTab === t.id ? "bg-white shadow text-dark" : "text-muted hover:text-dark"
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {integTab === "apikeys" && <ApiKeysTab />}
                {integTab === "webhooks" && <WebhooksTab />}
                {integTab === "reminders" && <RemindersTab />}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
