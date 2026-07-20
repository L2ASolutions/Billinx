"use client";

import { Button } from "@/components/ui/Button";
import { sel } from "./shared";

export function InvoicingTab() {
  return (
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
  );
}
