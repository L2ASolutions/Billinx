"use client";

import { FadeIn } from "./FadeIn";

const trustItems = [
  "FIRS Approved",
  "NRS Compliant",
  "Nigerian Data Residency",
  "Built for SMEs",
];

function DashboardMockup() {
  const bars = [40, 65, 50, 80, 60, 95, 70];
  const rows = [
    { label: "Kaduna Foods Ltd", status: "Accepted", tone: "bg-[#16a34a]/20 text-[#4ade80]" },
    { label: "Lekki Textiles", status: "Pending", tone: "bg-amber-400/20 text-amber-300" },
    { label: "Abuja Logistics", status: "Accepted", tone: "bg-[#16a34a]/20 text-[#4ade80]" },
  ];

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl backdrop-blur-sm sm:p-6">
      <div className="mb-4 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="ml-3 h-2 w-24 rounded-full bg-white/10" />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {["Outstanding", "Overdue", "Accepted"].map((label, i) => (
          <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-wide text-white/40">{label}</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {i === 0 ? "₦2.4M" : i === 1 ? "₦310K" : "184"}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex h-24 items-end gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm bg-gradient-to-t from-[#16a34a] to-[#4ade80]"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
          >
            <span className="text-xs text-white/70">{row.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${row.tone}`}>
              {row.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section
      id="top"
      className="relative flex min-h-screen flex-col justify-center overflow-hidden bg-gradient-to-br from-dark to-[#0f3460] pt-16"
    >
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:gap-8 lg:py-24">
        <FadeIn>
          <h1 className="text-balance text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
            Nigeria&apos;s Smart E-Invoicing Platform
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/70 sm:text-xl">
            FIRS-compliant invoicing built for Nigerian businesses. Submit to
            NRS, track VAT, get paid faster.
          </p>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <a
              href="#early-access"
              className="rounded-lg bg-[#16a34a] px-6 py-3 text-center text-base font-semibold text-white transition-colors hover:bg-[#15803d]"
            >
              Join the Waitlist
            </a>
            <a
              href="#how-it-works"
              className="rounded-lg border border-white/30 px-6 py-3 text-center text-base font-semibold text-white transition-colors hover:border-white hover:bg-white/5"
            >
              See How It Works
            </a>
          </div>

          <p className="mt-8 text-sm text-white/50">
            {trustItems.join(" · ")}
          </p>
        </FadeIn>

        <FadeIn delay={0.15} className="flex justify-center lg:justify-end">
          <DashboardMockup />
        </FadeIn>
      </div>
    </section>
  );
}
