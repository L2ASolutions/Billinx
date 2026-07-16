"use client";

import { FadeIn } from "./FadeIn";

const steps = [
  "Create your account and verify your TIN",
  "Add your products and customers",
  "Create and send FIRS-compliant invoices",
  "Submit to NRS and track payments",
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <FadeIn className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            Up and running in minutes
          </h2>
        </FadeIn>

        {/* Mobile: vertical timeline */}
        <div className="mt-14 flex flex-col gap-8 md:hidden">
          {steps.map((step, i) => (
            <FadeIn key={step} delay={i * 0.08}>
              <div className="relative flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-[#16a34a] bg-white text-base font-bold text-[#16a34a]">
                    {i + 1}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="mt-2 w-0.5 flex-1 bg-border" aria-hidden="true" />
                  )}
                </div>
                <p className="pt-2.5 text-base font-medium text-gray-900">{step}</p>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* Desktop: horizontal timeline */}
        <div className="relative mt-16 hidden md:grid md:grid-cols-4 md:gap-6">
          <div
            className="pointer-events-none absolute top-6 h-0.5 bg-border"
            style={{ left: "12.5%", right: "12.5%" }}
            aria-hidden="true"
          />
          {steps.map((step, i) => (
            <FadeIn key={step} delay={i * 0.08}>
              <div className="flex flex-col items-center text-center">
                <div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#16a34a] bg-white text-lg font-bold text-[#16a34a]">
                  {i + 1}
                </div>
                <p className="mt-5 max-w-[14rem] text-sm font-medium text-gray-900">
                  {step}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
