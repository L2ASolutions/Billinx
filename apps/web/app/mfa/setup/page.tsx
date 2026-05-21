"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api";

export default function MfaSetupPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<{ qrCodeBase64: string; manualKey: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    authApi.setupMfa().then(setSetup).catch(() => {
      setError("Failed to load MFA setup. Please try again.");
    });
  }, []);

  async function handleEnable(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authApi.enableMfa(code);
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid code";
      setError(msg);
    } finally {
      setLoading(false);
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
                <Image src={setup.qrCodeBase64} alt="MFA QR Code" width={180} height={180} />
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
          <Link href="/dashboard" className="text-sm text-muted hover:text-dark underline">
            Skip for now
          </Link>
        </div>
      </div>
    </AuthCard>
  );
}
