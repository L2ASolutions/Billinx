"use client";

import { useEffect, useState, FormEvent, useCallback } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiKeyApi, reminderApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";

type Tab = "profile" | "apikeys" | "reminders";

// ─── API Keys ───────────────────────────────────────────────────────────────

interface ApiKey {
  id: string;
  name: string; // BUG-016: backend field is `name`, not `label`
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
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState("test");
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
      setKeys(res.data as ApiKey[]);
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
      const res = await apiKeyApi.create(newKeyLabel, newKeyEnv);
      setNewKey(res.key);
      setNewKeyLabel("");
      loadKeys();
    } catch (err: unknown) {
      setKeyError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRotate(id: string) {
    if (!confirm("Rotate this key? The old key will have a 24h grace period.")) return;
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

  // BUG-016: pass key.name (not key.label) to revoke confirmation

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{loadError}</div>
      )}

      {/* New key banner */}
      {(newKey || rotatedKey) && (
        <div className="p-4 bg-green-light border border-green/20 rounded-xl">
          <p className="text-xs font-medium text-dark mb-1">
            {rotatedKey ? "Rotated API key (copy now — won't be shown again):" : "Your new API key (copy it now — it won't be shown again):"}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm text-dark bg-white px-3 py-2 rounded-lg border border-border break-all">
              {newKey || rotatedKey?.key}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(newKey || rotatedKey?.key || "")}
              className="text-green hover:text-green-dark text-sm font-medium"
            >
              Copy
            </button>
          </div>
          <button onClick={() => { setNewKey(""); setRotatedKey(null); }} className="text-xs text-muted mt-2 hover:text-dark">Dismiss</button>
        </div>
      )}

      {/* Create key form */}
      <form onSubmit={handleCreate} className="flex gap-3 items-end">
        <div className="flex-1">
          <Input label="Label" placeholder="e.g. Production App" value={newKeyLabel} onChange={(e) => setNewKeyLabel(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-dark mb-1">Environment</label>
          <select
            className="px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
            value={newKeyEnv}
            onChange={(e) => setNewKeyEnv(e.target.value)}
          >
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </div>
        <Button type="submit" loading={creating}>Create Key</Button>
      </form>
      {keyError && <p className="text-sm text-red-500">{keyError}</p>}

      {/* Keys list */}
      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : keys.length === 0 ? (
        <div className="p-8 text-center bg-surface rounded-xl border border-border">
          <p className="text-sm text-muted">No API keys yet. Create one above.</p>
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
                    {" · "}{key.requestCount.toLocaleString()} requests
                    {" · "}Created {formatDate(key.createdAt)}
                    {key.lastUsedAt && ` · Last used ${formatDate(key.lastUsedAt)}`}
                    {key.expiresAt && ` · Expires ${formatDate(key.expiresAt)}`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={rotatingId === key.id}
                    onClick={() => handleRotate(key.id)}
                  >
                    Rotate
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRevoke(key.id, key.name)}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reminder Rules ─────────────────────────────────────────────────────────

interface ReminderRule {
  id: string;
  name: string;
  triggerType: string;
  triggerDays: number;
  reminderMessage: string; // BUG-011: backend field is reminderMessage, not message
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
}

interface ReminderForm {
  name: string;
  triggerType: string;
  triggerDays: string;
  reminderMessage: string; // BUG-011
}

const TRIGGER_TYPES = [
  { value: "BEFORE_DUE", label: "Before due date" },
  { value: "ON_DUE", label: "On due date" },
  { value: "AFTER_DUE", label: "After due date (overdue)" },
];

const EMPTY_RULE: ReminderForm = {
  name: "",
  triggerType: "BEFORE_DUE",
  triggerDays: "3",
  reminderMessage: "",
};

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

  function openCreate() {
    setEditRule(null);
    setForm(EMPTY_RULE);
    setFormError("");
    setShowModal(true);
  }

  function openEdit(r: ReminderRule) {
    setEditRule(r);
    setForm({
      name: r.name,
      triggerType: r.triggerType,
      triggerDays: String(r.triggerDays),
      reminderMessage: r.reminderMessage,
    });
    setFormError("");
    setShowModal(true);
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
      if (editRule) {
        await reminderApi.update(editRule.id, payload);
      } else {
        await reminderApi.create(payload);
      }
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
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Reminder rules automatically send payment reminders to buyers before or after due dates.
        </p>
        <Button size="sm" onClick={openCreate}>+ Add Rule</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rules.length === 0 ? (
        <div className="p-8 text-center bg-surface rounded-xl border border-border">
          <p className="text-sm text-muted mb-3">No reminder rules configured.</p>
          <Button size="sm" onClick={openCreate}>Add your first rule</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="p-4 bg-surface rounded-xl border border-border">
              <div className="flex items-start gap-4">
                {/* Toggle */}
                <button
                  className={`mt-0.5 w-10 h-6 rounded-full transition-colors shrink-0 ${rule.isActive ? "bg-green" : "bg-gray-200"} ${togglingId === rule.id ? "opacity-50" : ""}`}
                  onClick={() => handleToggle(rule)}
                  disabled={togglingId === rule.id}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${rule.isActive ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-dark">{rule.name}</span>
                    {rule.isDefault && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">Default</span>
                    )}
                    {!rule.isActive && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-400">Inactive</span>
                    )}
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
                    <Button size="sm" variant="secondary" onClick={() => openEdit(rule)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => handleDelete(rule.id)}>Delete</Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold text-dark">{editRule ? "Edit Rule" : "Add Reminder Rule"}</h2>
              <button onClick={() => setShowModal(false)} className="text-muted hover:text-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{formError}</div>
              )}
              <Input
                label="Rule Name *"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. 3-day reminder"
              />
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Trigger Type *</label>
                <select
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={form.triggerType}
                  onChange={(e) => setForm((f) => ({ ...f, triggerType: e.target.value }))}
                >
                  {TRIGGER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <Input
                label="Trigger Days *"
                type="number"
                value={form.triggerDays}
                onChange={(e) => setForm((f) => ({ ...f, triggerDays: e.target.value }))}
                placeholder="Number of days"
              />
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Message</label>
                <textarea
                  className="w-full px-3 py-2.5 rounded-lg border border-border text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green resize-none"
                  rows={3}
                  value={form.reminderMessage}
                  onChange={(e) => setForm((f) => ({ ...f, reminderMessage: e.target.value }))}
                  placeholder="Reminder message sent to buyer..."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button loading={submitting} disabled={!form.name} onClick={handleSubmit}>
                {editRule ? "Save Changes" : "Add Rule"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Settings Page ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("profile");

  const TABS: { id: Tab; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "apikeys", label: "API Keys" },
    { id: "reminders", label: "Reminders" },
  ];

  return (
    <>
      <Topbar title="Settings" />

      <div className="p-6 max-w-3xl space-y-6">
        {/* Tab bar */}
        <div className="flex gap-1 bg-surface rounded-xl p-1 border border-border w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id ? "bg-white shadow text-dark" : "text-muted hover:text-dark"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Profile tab */}
        {tab === "profile" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Profile</h2>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-green-light flex items-center justify-center text-green text-2xl font-bold">
                {user?.name?.[0]?.toUpperCase() ?? "U"}
              </div>
              <div>
                <p className="text-base font-semibold text-dark">{user?.name}</p>
                <p className="text-sm text-muted">{user?.email}</p>
                <span className="inline-block mt-1 px-2 py-0.5 bg-surface border border-border rounded text-xs text-muted">
                  {user?.role}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* API Keys tab */}
        {tab === "apikeys" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-5">API Keys</h2>
            <ApiKeysTab />
          </div>
        )}

        {/* Reminders tab */}
        {tab === "reminders" && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-5">Reminder Rules</h2>
            <RemindersTab />
          </div>
        )}
      </div>
    </>
  );
}
