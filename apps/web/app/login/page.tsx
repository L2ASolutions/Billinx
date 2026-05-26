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
  const [keepSignedIn, setKeepSignedIn] = useState(false);
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
        localStorage.setItem("accessToken", res.accessToken ?? "");
        router.push("/mfa/setup");
        return;
      }

      if (res.mfaRequired) {
        localStorage.setItem("mfaToken", res.mfaToken ?? "");
        if (keepSignedIn) localStorage.setItem("keepSignedIn", "true");
        router.push("/mfa");
        return;
      }

      if (res.accessToken) {
        if (keepSignedIn) localStorage.setItem("keepSignedIn", "true");
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
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-green flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <span className="text-xl font-bold text-dark">Billinx</span>
          </div>
          <p className="text-sm text-muted">FIRS E-Invoicing Platform</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
          <h1 className="text-2xl font-bold text-dark mb-1">Welcome back</h1>
          <p className="text-muted text-sm mb-6">Sign in to your Billinx account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            {/* Keep me signed in */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(e) => setKeepSignedIn(e.target.checked)}
                className="h-4 w-4 rounded border-border text-green focus:ring-green/30 cursor-pointer"
              />
              <span className="text-sm text-dark">Keep me signed in for 7 days</span>
            </label>

            <div className="flex items-center justify-end">
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
              Request access →
            </Link>
          </p>
        </div>

        {/* Security footer */}
        <p className="mt-5 text-center text-xs text-muted">
          🔒 Protected by TLS 1.3 &nbsp;·&nbsp; NDPA 2023 compliant &nbsp;·&nbsp; FIRS certified
        </p>
      </div>
    </div>
  );
}
