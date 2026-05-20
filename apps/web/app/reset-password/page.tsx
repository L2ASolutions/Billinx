"use client";

import { useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api";
import { Suspense } from "react";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      router.push("/login?reset=1");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Reset failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Invalid link" subtitle="This reset link is missing or has expired">
        <div className="mt-6">
          <Link href="/forgot-password">
            <Button variant="secondary" className="w-full">Request a new link</Button>
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set new password" subtitle="Choose a strong password for your account">
      <form onSubmit={handleSubmit} className="space-y-4 mt-6">
        <Input
          label="New password"
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
        <Input
          label="Confirm password"
          type="password"
          placeholder="Repeat your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" loading={loading} size="lg">
          Reset password
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
