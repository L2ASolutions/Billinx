"use client";

import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";

export function SecurityTab() {
  const { user } = useAuth();

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-border p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-dark">Profile</p>
            <p className="text-xs text-muted mt-0.5">{user?.email} · {user?.role}</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-green-light flex items-center justify-center text-green font-bold">
            {user?.name?.[0]?.toUpperCase() ?? "U"}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-border p-5">
        <p className="text-sm font-semibold text-dark mb-1">Two-factor authentication</p>
        <p className="text-xs text-muted mb-3">TOTP MFA is required for Owner and Admin roles.</p>
        <Button size="sm" variant="secondary">Manage MFA →</Button>
      </div>
      <div className="bg-white rounded-xl border border-border p-5">
        <p className="text-sm font-semibold text-dark mb-1">Change password</p>
        <p className="text-xs text-muted mb-3">Send yourself a password reset email.</p>
        <Button size="sm" variant="secondary">Send reset email →</Button>
      </div>
      <div className="bg-white rounded-xl border border-border p-5">
        <p className="text-sm font-semibold text-dark mb-1">Active sessions</p>
        <p className="text-xs text-muted mb-3">Revoke all other sessions if you think your account has been compromised.</p>
        <Button size="sm" variant="danger">Revoke all other sessions</Button>
      </div>
    </div>
  );
}
