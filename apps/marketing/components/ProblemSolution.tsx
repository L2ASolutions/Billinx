"use client";

import {
  ClockIcon,
  ExclamationTriangleIcon,
  EyeSlashIcon,
  ArrowDownIcon,
} from "@heroicons/react/24/outline";
import { FadeIn } from "./FadeIn";

const painPoints = [
  {
    icon: ClockIcon,
    text: "Spending hours on manual FIRS submissions every month",
  },
  {
    icon: ExclamationTriangleIcon,
    text: "VAT calculation errors putting you at risk of penalties",
  },
  {
    icon: EyeSlashIcon,
    text: "Non-compliant invoices getting rejected by the NRS",
  },
];

export function ProblemSolution() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            Is your business facing invoicing challenges?
          </h2>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {painPoints.map((point, i) => (
            <FadeIn key={point.text} delay={i * 0.1}>
              <div className="h-full rounded-2xl border border-border bg-surface p-8 text-center shadow-card">
                <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <point.icon className="h-6 w-6 text-red-600" aria-hidden="true" />
                </div>
                <p className="text-base font-medium leading-relaxed text-gray-900">
                  {point.text}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.35} className="mt-14 flex flex-col items-center gap-4">
          <ArrowDownIcon className="h-6 w-6 text-gray-400" aria-hidden="true" />
          <p className="text-2xl font-semibold text-gray-900 sm:text-3xl">
            Billinx solves all of these challenges for you
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
