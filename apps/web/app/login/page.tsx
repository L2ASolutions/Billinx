"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { setTokens } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // BUG-021: Show session-expired message if the API client redirected here
  // after a 401 rather than silently clearing state.
  useEffect(() => {
    const authError = sessionStorage.getItem("authError");
    if (authError) {
      setError(authError);
      sessionStorage.removeItem("authError");
    }
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await authApi.login(email, password);

      if (res.mfaSetupRequired) {
        // Store token so /mfa/setup can call the setup API with it.
        // We do not call setTokens here because the user is not fully
        // authenticated until they complete or skip MFA setup.
        localStorage.setItem("accessToken", res.accessToken ?? "");
        router.push("/mfa/setup");
        return;
      }

      if (res.mfaRequired) {
        localStorage.setItem("mfaToken", res.mfaToken ?? "");
        router.push("/mfa");
        return;
      }

      if (res.accessToken) {
        // setTokens writes to localStorage AND updates the AuthProvider context
        // so the dashboard layout sees isAuthenticated:true immediately on the
        // next client-side navigation — no full-page reload required.
        setTokens(res.accessToken);
        router.push("/dashboard");
        return;
      }

      setError("Login succeeded but no token received. Contact support.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed. Check your credentials.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to your Billinx account">
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
        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <Link href="/forgot-password" className="text-sm text-green hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="w-full" loading={loading} size="lg">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/request-access" className="text-green font-medium hover:underline">
          Request access
        </Link>
      </p>
    </AuthCard>
  );
}
