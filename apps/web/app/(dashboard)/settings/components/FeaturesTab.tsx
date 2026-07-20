"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { api, invalidateCache } from "@/lib/api";
import { useInventoryEnabled } from "@/lib/userProfile";

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`w-10 h-6 rounded-full transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-green/30 ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      } ${checked ? "bg-green" : "bg-gray-200"}`}
    >
      <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 mt-1 ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

export function FeaturesTab() {
  const [inventoryEnabled, setInventoryEnabledCtx] = useInventoryEnabled();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmDisable, setConfirmDisable] = useState(false);

  useEffect(() => {
    api.get<{ inventoryEnabled?: boolean }>('/v1/tenants/me')
      .then((t) => setInventoryEnabledCtx(!!t?.inventoryEnabled))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setInventoryEnabledCtx]);

  async function handleInventoryToggle(value: boolean) {
    if (!value) {
      setConfirmDisable(true);
      return;
    }
    await applyInventoryChange(true);
  }

  async function applyInventoryChange(value: boolean) {
    setSaving(true);
    try {
      await api.patch('/v1/tenants/me', { inventoryEnabled: value });
      setInventoryEnabledCtx(value);
      invalidateCache('/v1/tenants/me');
      setToast(value ? "Inventory tracking enabled" : "Inventory tracking disabled");
      setTimeout(() => setToast(""), 3000);
    } catch {
      setToast("Failed to update feature setting");
      setTimeout(() => setToast(""), 3000);
    } finally {
      setSaving(false);
      setConfirmDisable(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-28 rounded-xl bg-surface border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className="p-3 bg-green-light border border-green/20 rounded-xl text-sm text-dark">{toast}</div>
      )}

      <div>
        <h2 className="text-base font-semibold text-dark">Platform Features</h2>
        <p className="text-sm text-muted mt-0.5">Enable or disable optional features for your account</p>
      </div>

      {/* Inventory Management */}
      <div className="bg-white rounded-xl border border-border p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-dark">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <path d="M12 22V12" /><path d="M3.3 7l8.7 5 8.7-5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-dark">Inventory Management</p>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              Track stock levels across your products. Set reorder points and get alerts when stock runs low.
              Stock is automatically updated when invoices are created or received.
            </p>
          </div>
          <Toggle checked={inventoryEnabled} onChange={handleInventoryToggle} disabled={saving} />
        </div>
      </div>


      {/* Confirm disable modal */}
      {confirmDisable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-dark">Disable inventory tracking?</h2>
            </div>
            <div className="p-6">
              <p className="text-sm text-muted">
                Your stock data will be kept but automatic tracking will stop.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setConfirmDisable(false)}>Cancel</Button>
              <Button variant="danger" loading={saving} onClick={() => applyInventoryChange(false)}>Disable</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
