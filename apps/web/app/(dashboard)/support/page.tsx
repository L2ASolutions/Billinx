'use client';

import { useRequireAuth } from '@/lib/auth';

const FAQ = [
  {
    q: 'How do I generate a FIRS-compliant invoice?',
    a: 'Navigate to Invoices → Create invoice. Fill in the buyer details, line items, and tax information. Once submitted, the invoice is validated against FIRS rules and queued for submission to the NRS platform via Interswitch.',
  },
  {
    q: 'What does "FIRS Rejected" mean and how do I fix it?',
    a: 'A rejected invoice failed FIRS validation rules — common reasons include invalid TIN, missing HSN codes, or incorrect tax amounts. Open the invoice detail page to see the exact rejection reason and follow the instructions to create a corrected invoice.',
  },
  {
    q: 'How do I invite team members?',
    a: 'Go to Team → Invite member. Enter the email address and select a role (Admin, Accountant, Viewer, or API Manager). The invitee receives an email to set their password and join your workspace.',
  },
  {
    q: 'How do API keys and webhooks work?',
    a: 'API keys authenticate your ERP or accounting system when calling the Billinx API directly. Webhooks deliver real-time notifications (e.g., invoice.accepted) to your endpoint via HMAC-signed POST requests. Both are managed under Settings → Integrations.',
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SupportPage() {
  useRequireAuth();

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="bg-white border-b border-border px-6 py-5 sticky top-0 z-10">
        <h1 className="text-xl font-bold text-dark">Support</h1>
        <p className="text-sm text-muted mt-0.5">Get help with Billinx</p>
      </header>

      <div className="p-6 max-w-4xl space-y-6">
        {/* Contact cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Documentation */}
          <a
            href="https://docs.billinx.ng"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white rounded-xl border border-border p-6 hover:shadow-sm transition-shadow group"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mb-4">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-dark mb-1 group-hover:text-green transition-colors">Documentation</h3>
            <p className="text-sm text-muted">API references, guides, and integration tutorials</p>
            <div className="mt-4 flex items-center gap-1 text-sm text-green font-medium">
              View docs
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </a>

          {/* Live chat */}
          <button
            onClick={() => {
              // Opens live chat widget if available
              if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).Intercom) {
                ((window as unknown as Record<string, unknown>).Intercom as (cmd: string) => void)('show');
              } else {
                window.location.href = 'mailto:support@billinx.ng?subject=Live%20Chat%20Request';
              }
            }}
            className="text-left bg-white rounded-xl border border-border p-6 hover:shadow-sm transition-shadow group"
          >
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center mb-4">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-dark mb-1 group-hover:text-green transition-colors">Live chat</h3>
            <p className="text-sm text-muted">Chat with our support team — available Mon–Fri 9am–6pm WAT</p>
            <div className="mt-4 flex items-center gap-1 text-sm text-green font-medium">
              Start chat
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Email support */}
          <a
            href="mailto:support@billinx.ng"
            className="bg-white rounded-xl border border-border p-6 hover:shadow-sm transition-shadow group"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center mb-4">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h3 className="font-semibold text-dark mb-1 group-hover:text-green transition-colors">Email support</h3>
            <p className="text-sm text-muted">Send us an email and we&apos;ll respond within 1 business day</p>
            <div className="mt-4 flex items-center gap-1 text-sm text-green font-medium">
              support@billinx.ng
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </a>
        </div>

        {/* FAQ */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-semibold text-dark">Frequently asked questions</h2>
          </div>
          <div className="divide-y divide-border">
            {FAQ.map((item, i) => (
              <details key={i} className="group">
                <summary className="flex items-center justify-between px-6 py-4 cursor-pointer list-none hover:bg-surface transition-colors">
                  <span className="text-sm font-medium text-dark pr-4">{item.q}</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-muted transition-transform group-open:rotate-180"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </summary>
                <div className="px-6 pb-4">
                  <p className="text-sm text-muted leading-relaxed">{item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
