"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function MfaSetupPage() {
  const router = useRouter();
  const { setTokens } = useAuth();

  // Capture the access token synchronously at mount time — before any API call
  // can wipe localStorage.  This is the source of truth for Skip for now.
  const [savedToken] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem("accessToken") : null
  );

  const [setup, setSetup] = useState<{ qrCodeBase64: string; manualKey: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // setupMfa uses skipAuthRedirect=true so a 401 from this endpoint will NOT
    // clear localStorage or redirect — the user can still click Skip for now.
    authApi.setupMfa().then(setSetup).catch(() => {
      setError("Could not load MFA setup. You can skip and set it up later.");
    });
  }, []);

  async function handleEnable(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authApi.enableMfa(code);
      // enableMfa uses skipAuthRedirect=true too.
      // After enabling, the token in localStorage is still valid for the dashboard.
      const token = localStorage.getItem("accessToken") || savedToken;
      if (token) setTokens(token);
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid code";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    // Use savedToken (captured at mount) as fallback in case setupMfa's error
    // handler cleared localStorage.  setTokens updates both localStorage AND
    // the AuthProvider context so the dashboard layout sees isAuthenticated:true
    // immediately on the next client-side navigation.
    const token = localStorage.getItem("accessToken") || savedToken;
    if (token) {
      setTokens(token);
      router.push("/dashboard");
    } else {
      router.push("/login");
    }
  }

  return (
    <AuthCard
      title="Set up two-factor authentication"
      subtitle="Scan the QR code with your authenticator app, then enter the 6-digit code"
    >
      <div className="mt-6 space-y-6">
        {setup ? (
          <>
            <div className="flex justify-center">
              <div className="p-3 bg-white border border-border rounded-xl">
                {/* BUG-022: backend may return raw base64 without the data URI
                    prefix; normalise so <Image> always receives a valid src. */}
                <Image
                  src={
                    setup.qrCodeBase64.startsWith("data:")
                      ? setup.qrCodeBase64
                      : `data:image/png;base64,${setup.qrCodeBase64}`
                  }
                  alt="MFA QR Code"
                  width={180}
                  height={180}
                />
              </div>
            </div>

            <div className="p-3 bg-surface rounded-lg border border-border">
              <p className="text-xs text-muted mb-1">Or enter code manually:</p>
              <p className="font-mono text-sm text-dark tracking-widest">{setup.manualKey}</p>
            </div>

            <form onSubmit={handleEnable} className="space-y-4">
              <Input
                label="Verification code"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
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
                Enable two-factor authentication
              </Button>
            </form>
          </>
        ) : error ? (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {error}
          </div>
        ) : (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-2 border-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <div className="text-center">
          <button
            type="button"
            onClick={handleSkip}
            className="text-sm text-muted hover:text-dark underline"
          >
            Skip for now
          </button>
        </div>
      </div>
    </AuthCard>
  );
}
