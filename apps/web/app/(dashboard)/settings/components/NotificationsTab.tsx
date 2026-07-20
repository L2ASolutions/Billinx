"use client";

export function NotificationsTab() {
  return (
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
  );
}
