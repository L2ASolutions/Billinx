"use client";

import { useState, type FormEvent } from "react";
import { FadeIn } from "./FadeIn";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STORAGE_KEY = "billinx_waitlist_submissions";

type Status = "idle" | "error" | "success";

export function WaitlistCTA() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmed = email.trim();
    if (!EMAIL_REGEX.test(trimmed)) {
      setStatus("error");
      return;
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const existing: Array<{ email: string; submittedAt: string }> = raw
        ? JSON.parse(raw)
        : [];
      existing.push({ email: trimmed, submittedAt: new Date().toISOString() });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch {
      // localStorage unavailable (private browsing, etc.) — still show success,
      // this is a pre-launch waitlist capture, not a durable record.
    }

    setStatus("success");
  }

  return (
    <section
      id="early-access"
      className="scroll-mt-16 bg-gradient-to-br from-dark to-[#0f3460] py-20 sm:py-28"
    >
      <div className="mx-auto max-w-2xl px-6 text-center">
        <FadeIn>
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Be first to modernise your invoicing
          </h2>
          <p className="mt-4 text-lg text-white/70">
            Join Nigerian businesses getting early access to Billinx. No
            credit card required.
          </p>

          <div className="mt-8">
            {status === "success" ? (
              <div
                role="status"
                className="rounded-lg border border-[#16a34a]/40 bg-[#16a34a]/10 px-6 py-4 text-base font-medium text-[#4ade80]"
              >
                You&apos;re on the list! We&apos;ll be in touch soon.
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                noValidate
                className="flex flex-col gap-3 sm:flex-row"
              >
                <div className="flex-1 text-left">
                  <label htmlFor="waitlist-email" className="sr-only">
                    Email address
                  </label>
                  <input
                    id="waitlist-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (status === "error") setStatus("idle");
                    }}
                    aria-invalid={status === "error"}
                    aria-describedby={
                      status === "error" ? "waitlist-email-error" : undefined
                    }
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-white/40 outline-none transition-colors focus:border-[#16a34a]"
                  />
                  {status === "error" && (
                    <p id="waitlist-email-error" className="mt-2 text-sm text-red-300">
                      Enter a valid email address.
                    </p>
                  )}
                </div>
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-[#16a34a] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#15803d]"
                >
                  Join Waitlist
                </button>
              </form>
            )}
          </div>

          <p className="mt-4 text-sm text-white/50">
            We&apos;ll notify you when your account is ready. Early access
            users get 3 months free.
          </p>

          <p className="mt-6 text-sm font-medium text-white/70">
            127 businesses already on the waitlist
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
