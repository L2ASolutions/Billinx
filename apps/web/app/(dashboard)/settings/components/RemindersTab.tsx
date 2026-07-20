"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { reminderApi } from "@/lib/api";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { sel } from "./shared";

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

export function RemindersTab() {
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

  // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
  // eslint-disable-next-line react-hooks/set-state-in-effect
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
