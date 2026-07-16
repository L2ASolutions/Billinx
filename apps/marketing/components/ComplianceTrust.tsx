"use client";

import { CheckBadgeIcon } from "@heroicons/react/24/solid";
import { FadeIn } from "./FadeIn";

const badges = [
  {
    title: "FIRS Certified",
    description: "Invoices formatted to FIRS BIS Billing 3.0 standard",
  },
  {
    title: "NRS Integration",
    description:
      "Direct submission via Interswitch certified access point",
  },
  {
    title: "NDPA Compliant",
    description: "Data stored in Nigeria. Lagos Local Zone. 6-year retention.",
  },
];

export function ComplianceTrust() {
  return (
    <section id="compliance" className="scroll-mt-16 bg-dark py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn className="text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Built for Nigerian compliance from day one
          </h2>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {badges.map((badge, i) => (
            <FadeIn key={badge.title} delay={i * 0.1}>
              <div className="relative h-full rounded-2xl border border-white/15 bg-white/[0.03] p-8 text-center">
                <div className="absolute inset-x-0 -top-5 flex justify-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1a1a2e] ring-4 ring-[#16a34a]/30">
                    <CheckBadgeIcon className="h-8 w-8 text-[#16a34a]" aria-hidden="true" />
                  </div>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-white">
                  {badge.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/60">
                  {badge.description}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
