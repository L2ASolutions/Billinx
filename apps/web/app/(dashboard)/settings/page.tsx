"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Topbar } from "@/components/dashboard/Topbar";
import { ApiKeysTab } from "./components/ApiKeysTab";
import { WebhooksTab } from "./components/WebhooksTab";
import { RemindersTab } from "./components/RemindersTab";
import { CompanyTab } from "./components/CompanyTab";
import { FeaturesTab } from "./components/FeaturesTab";
import { NotificationsTab } from "./components/NotificationsTab";
import { SecurityTab } from "./components/SecurityTab";
import { InvoicingTab } from "./components/InvoicingTab";

// ── Tab types ─────────────────────────────────────────────────────────────────

type MainTab = "company" | "notifications" | "security" | "invoicing" | "integrations" | "features";
type IntegTab = "apikeys" | "webhooks" | "reminders";

// ── Settings page ─────────────────────────────────────────────────────────────

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: "company",       label: "Company profile" },
  { id: "notifications", label: "Notifications" },
  { id: "security",      label: "Security" },
  { id: "invoicing",     label: "Invoicing" },
  { id: "integrations",  label: "Integrations" },
  { id: "features",      label: "Features" },
];

const INTEG_TABS: { id: IntegTab; label: string }[] = [
  { id: "apikeys",   label: "API keys" },
  { id: "webhooks",  label: "Webhooks" },
  { id: "reminders", label: "Reminder rules" },
];

function SettingsContent() {
  const router = useRouter();
  const params = useSearchParams();

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
            {mainTab === "notifications" && <NotificationsTab />}

            {/* Security */}
            {mainTab === "security" && <SecurityTab />}

            {/* Invoicing */}
            {mainTab === "invoicing" && <InvoicingTab />}

            {/* Features */}
            {mainTab === "features" && <FeaturesTab />}

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
