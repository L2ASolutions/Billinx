"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api";

export default function RequestAccessPage() {
  const [form, setForm] = useState({
    companyName: "",
    tin: "",
    contactName: "",
    email: "",
    phone: "",
    useCase: "",
  });
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentNdpr, setConsentNdpr] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!consentTerms || !consentNdpr) {
      setError("You must agree to both consent statements before submitting.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await authApi.requestAccess(form);
      setSubmitted(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <AuthCard title="Request submitted" subtitle="We'll review and get back to you">
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-green-light rounded-lg border border-green/20">
            <p className="text-sm text-dark">
              Thank you, <strong>{form.contactName}</strong>! Your request for{" "}
              <strong>{form.companyName}</strong> has been submitted. Our team will review it and
              contact you at <strong>{form.email}</strong>.
            </p>
          </div>
          <Link href="/login">
            <Button variant="secondary" className="w-full">
              Back to sign in
            </Button>
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Request access" subtitle="Apply to use the Billinx FIRS e-invoicing platform">
      <form onSubmit={handleSubmit} className="space-y-4 mt-6">
        <Input
          label="Company name"
          placeholder="Acme Ltd"
          value={form.companyName}
          onChange={update("companyName")}
          required
          autoFocus
        />
        <Input
          label="Company TIN"
          placeholder="12345678-0001"
          value={form.tin}
          onChange={update("tin")}
          required
        />
        <Input
          label="Your full name"
          placeholder="Amaka Okonkwo"
          value={form.contactName}
          onChange={update("contactName")}
          required
        />
        <Input
          label="Work email"
          type="email"
          placeholder="you@company.com"
          value={form.email}
          onChange={update("email")}
          required
        />
        <Input
          label="Phone number (optional)"
          type="tel"
          placeholder="+234 800 000 0000"
          value={form.phone}
          onChange={update("phone")}
        />

        <div className="space-y-1">
          <label className="block text-sm font-medium text-dark">
            How will you use Billinx? (optional)
          </label>
          <textarea
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green transition-colors resize-none"
            rows={3}
            placeholder="Describe your use case..."
            value={form.useCase}
            onChange={update("useCase")}
          />
        </div>

        {/* Consent checkboxes */}
        <div className="space-y-3 pt-2 border-t border-border">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={consentTerms}
              onChange={(e) => setConsentTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-green focus:ring-green/30 cursor-pointer"
            />
            <span className="text-sm text-dark leading-snug">
              I agree to the{" "}
              <Link href="/terms" className="text-green font-medium hover:underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-green font-medium hover:underline">
                Privacy Policy
              </Link>{" "}
              of Billinx
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={consentNdpr}
              onChange={(e) => setConsentNdpr(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-green focus:ring-green/30 cursor-pointer"
            />
            <span className="text-sm text-dark leading-snug">
              I consent to Billinx processing my business data in accordance with the Nigeria Data
              Protection Regulation (NDPR) and NDPA 2023
            </span>
          </label>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" loading={loading} size="lg">
          Submit request
        </Button>

        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-green font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
