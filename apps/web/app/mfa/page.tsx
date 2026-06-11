"use client";

import { useState, FormEvent, useRef, useEffect, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// ── TOTP countdown timer ──────────────────────────────────────────────────────

function TotpTimer() {
  const [secondsLeft, setSecondsLeft] = useState(() => 30 - (Math.floor(Date.now() / 1000) % 30));

  useEffect(() => {
    const tick = () => setSecondsLeft(30 - (Math.floor(Date.now() / 1000) % 30));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const pct = (secondsLeft / 30) * 100;
  const urgent = secondsLeft <= 5;

  return (
    <div className="flex items-center gap-2 justify-center mb-5">
      <svg width="22" height="22" viewBox="0 0 36 36" className="shrink-0 -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="15.9"
          fill="none"
          stroke={urgent ? "#dc2626" : "#16a34a"}
          strokeWidth="3"
          strokeDasharray={`${pct} 100`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`text-sm font-mono font-semibold tabular-nums ${urgent ? "text-red-600" : "text-muted"}`}>
        {secondsLeft}s
      </span>
      <span className="text-xs text-muted">Code refreshes in {secondsLeft}s</span>
    </div>
  );
}

// ── Backup code input ─────────────────────────────────────────────────────────

function BackupCodeForm({ onVerified }: { onVerified: (token: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const mfaToken = typeof window !== "undefined"
    ? (localStorage.getItem("mfaToken") ?? "")
    : "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await authApi.verifyMfa(mfaToken, code.trim(), true);
      onVerified(res.accessToken);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid backup code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Backup code"
        placeholder="xxxx-xxxx"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
      />
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">{error}</div>
      )}
      <Button type="submit" className="w-full" loading={loading} disabled={!code.trim()} size="lg">
        Verify backup code
      </Button>
    </form>
  );
}

// ── Main MFA form ─────────────────────────────────────────────────────────────

type View = "totp" | "backup";

function MfaForm() {
  const router = useRouter();
  const { setTokens } = useAuth();
  const mfaToken = typeof window !== "undefined"
    ? (localStorage.getItem("mfaToken") ?? "")
    : "";

  const [view, setView] = useState<View>("totp");
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState("");
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join("");

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  const handleVerified = useCallback((accessToken: string) => {
    localStorage.removeItem("mfaToken");
    setTokens(accessToken);
    router.push("/dashboard");
  }, [router, setTokens]);

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

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      setDigits(text.split(""));
      refs.current[5]?.focus();
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (code.length !== 6) return;
    setError("");
    setLoading(true);
    try {
      const res = await authApi.verifyMfa(mfaToken, code);
      handleVerified(res.accessToken);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid code";
      setError(msg);
      setDigits(["", "", "", "", "", ""]);
      refs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    try {
      await authApi.resendMfa(mfaToken);
      setResendMessage("New code sent to your email.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not resend code.";
      setResendMessage(msg);
    }
    setResendSent(true);
    setResendCooldown(60);
  }

  if (view === "backup") {
    return (
      <AuthCard
        title="Use backup code"
        subtitle="Enter one of your 8-character backup codes"
      >
        <div className="mt-6 space-y-4">
          <BackupCodeForm onVerified={handleVerified} />
          <button
            onClick={() => setView("totp")}
            className="w-full text-center text-sm text-green hover:underline mt-2"
          >
            ← Back to authenticator code
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Two-factor authentication"
      subtitle="Enter the 6-digit code from your authenticator app"
    >
      <form onSubmit={handleSubmit} className="mt-6">
        {/* Countdown */}
        <TotpTimer />

        {/* 6-digit input */}
        <div className="flex gap-2 justify-center mb-6" onPaste={handlePaste}>
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

      {/* Other options */}
      <div className="mt-5 pt-4 border-t border-border space-y-3 text-center">
        {/* Resend */}
        <div>
          {resendSent ? (
            <p className="text-sm text-muted">
              {resendMessage || "Code sent!"}{resendCooldown > 0 ? ` (${resendCooldown}s)` : ""}
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0}
              className="text-sm text-green hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Didn't receive a code? Resend"}
            </button>
          )}
        </div>

        {/* Other verification options */}
        <p className="text-sm text-muted">
          Other verification options:{" "}
          <button
            type="button"
            onClick={() => setView("backup")}
            className="text-green hover:underline font-medium"
          >
            Use backup code
          </button>
        </p>
      </div>
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
