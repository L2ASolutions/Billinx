"use client";

import { useState, FormEvent, useRef, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function MfaForm() {
  const router = useRouter();
  const { setTokens } = useAuth();
  // mfaToken is stored in localStorage by the login page (not passed in the URL
  // so it is never exposed in browser history or server logs).
  const mfaToken = typeof window !== "undefined"
    ? (localStorage.getItem("mfaToken") ?? "")
    : "";

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join("");

  function handleChange(index: number, value: string) {
    const cleaned = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);
    if (cleaned && index < 5) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (code.length !== 6) return;
    setError("");
    setLoading(true);
    try {
      const res = await authApi.verifyMfa(mfaToken, code);
      localStorage.removeItem("mfaToken"); // consumed — remove to avoid stale state
      // setTokens writes to localStorage AND updates AuthProvider context so the
      // dashboard layout sees isAuthenticated:true on the next client-side nav.
      setTokens(res.accessToken);
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid code";
      setError(msg);
      setDigits(["", "", "", "", "", ""]);
      refs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  return (
    <AuthCard
      title="Two-factor authentication"
      subtitle="Enter the 6-digit code from your authenticator app"
    >
      <form onSubmit={handleSubmit} className="mt-6">
        <div className="flex gap-2 justify-center mb-6">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="w-12 h-14 text-center text-xl font-bold rounded-lg border border-border bg-white text-dark focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green transition-colors"
            />
          ))}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600 mb-4">
            {error}
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          loading={loading}
          disabled={code.length !== 6}
          size="lg"
        >
          Verify
        </Button>
      </form>
    </AuthCard>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
