"use client";

import {
  PaperAirplaneIcon,
  CalculatorIcon,
  ChartBarIcon,
  UsersIcon,
  ClipboardDocumentCheckIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { FadeIn } from "./FadeIn";

const features = [
  {
    icon: PaperAirplaneIcon,
    title: "FIRS/NRS Submission",
    description:
      "Submit e-invoices directly to the NRS platform via certified access point",
  },
  {
    icon: CalculatorIcon,
    title: "VAT Return Assistant",
    description:
      "Auto-calculate VAT 002 returns and export to Excel in one click",
  },
  {
    icon: ChartBarIcon,
    title: "Real-time Dashboard",
    description:
      "Track outstanding receivables, overdue invoices, and cash position",
  },
  {
    icon: UsersIcon,
    title: "Role-Based Access",
    description: "Owner, Admin, Accountant, Viewer — control who sees what",
  },
  {
    icon: ClipboardDocumentCheckIcon,
    title: "Audit Trail",
    description: "Every action logged and hash-chained for compliance",
  },
  {
    icon: ShieldCheckIcon,
    title: "Nigerian Data Residency",
    description: "Your financial data stored in Nigeria. NDPA compliant.",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-16 bg-dark py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn className="text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Everything your business needs
          </h2>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => (
            <FadeIn key={feature.title} delay={(i % 3) * 0.08}>
              <div className="group h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[#16a34a]/60 hover:bg-white/[0.05]">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-[#16a34a]/15">
                  <feature.icon className="h-6 w-6 text-[#4ade80]" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  {feature.description}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
