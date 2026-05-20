"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Request failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle="We've sent a password reset link">
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-green-light rounded-lg border border-green/20">
            <p className="text-sm text-dark">
              If an account exists for <strong>{email}</strong>, you&apos;ll receive a reset link within a few minutes.
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
    <AuthCard title="Reset your password" subtitle="Enter your email to receive a reset link">
      <form onSubmit={handleSubmit} className="space-y-4 mt-6">
        <Input
          label="Email address"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" loading={loading} size="lg">
          Send reset link
        </Button>

        <Link href="/login" className="block text-center text-sm text-muted hover:text-dark">
          ← Back to sign in
        </Link>
      </form>
    </AuthCard>
  );
}
