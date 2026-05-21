"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api";

function AcceptForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentNdpr, setConsentNdpr] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!consentTerms || !consentNdpr) {
      setError("You must agree to both consent statements before activating your account.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await authApi.acceptInvitation(token, password, name) as {
        accessToken?: string;
      };
      if (res.accessToken) {
        localStorage.setItem("accessToken", res.accessToken);
        router.push("/dashboard");
      } else {
        router.push("/login");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to accept invitation";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Invalid invitation" subtitle="This invitation link is missing or has expired">
        <div className="mt-6 text-sm text-muted text-center">
          Contact your administrator for a new invitation.
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Accept invitation" subtitle="Set up your account to join your team on Billinx">
      <form onSubmit={handleSubmit} className="space-y-4 mt-6">
        <Input
          label="Your full name"
          placeholder="Amaka Okonkwo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <Input
          label="Password"
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Input
          label="Confirm password"
          type="password"
          placeholder="Repeat your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />

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
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptForm />
    </Suspense>
  );
}
