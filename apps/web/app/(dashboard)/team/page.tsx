"use client";

import { useEffect, useState, FormEvent } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { userApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLES = ["VIEWER", "ACCOUNTANT", "API_MANAGER", "ADMIN"] as const;

const ROLE_COLORS: Record<string, string> = {
  OWNER:       "bg-purple-50 text-purple-700",
  ADMIN:       "bg-blue-50 text-blue-700",
  ACCOUNTANT:  "bg-green-50 text-green-700",
  API_MANAGER: "bg-amber-50 text-amber-700",
  VIEWER:      "bg-gray-100 text-gray-600",
};

const ROLE_DESC: Record<string, string> = {
  VIEWER:      "Read-only access to invoices and reports",
  ACCOUNTANT:  "Create and manage invoices, record payments",
  API_MANAGER: "Manage API keys and webhook integrations",
  ADMIN:       "Full access except billing and owner settings",
  OWNER:       "Full access including billing and team management",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  isActive?: boolean;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt?: string;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Sk({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />;
}

// ── Invite modal ──────────────────────────────────────────────────────────────

function InviteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("VIEWER");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await userApi.invite(email, role);
      onSuccess(email);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-dark">Invite team member</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
            )}
            <Input
              label="Email address"
              type="email"
              placeholder="colleague@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <div>
              <label className="block text-sm font-medium text-dark mb-2">Role</label>
              <div className="space-y-2">
                {ROLES.map((r) => (
                  <label key={r}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      role === r ? "border-green bg-green-light" : "border-border hover:bg-surface"
                    }`}>
                    <input
                      type="radio"
                      name="role"
                      value={r}
                      checked={role === r}
                      onChange={() => setRole(r)}
                      className="mt-0.5 text-green focus:ring-green/30"
                    />
                    <div>
                      <p className="text-sm font-medium text-dark">{r.replace(/_/g, " ")}</p>
                      <p className="text-xs text-muted">{ROLE_DESC[r]}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="px-6 py-4 border-t border-border flex gap-3 justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading} disabled={!email}>Send invitation</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await userApi.list();
      // Backend returns { data: UserResponse[], total } where UserResponse has
      // fullName (not name) and roles: string[] (not role: string).
      const rawData = Array.isArray(res) ? res : ((res as any).data ?? []);
      const data: (Member & { status?: string })[] = (rawData as any[]).map((u: any) => ({
        id: u.id,
        name: u.fullName ?? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() ?? u.name ?? "",
        email: u.email ?? "",
        role: u.role ?? u.roles?.[0] ?? "VIEWER",
        createdAt: u.createdAt,
        isActive: u.isActive ?? true,
        status: u.status,
      }));
      setMembers(data.filter((u) => u.isActive !== false));
      // Surface pending invitations if backend returns them in the same list
      setInvitations(data.filter((u) => u.status === "PENDING") as unknown as Invitation[]);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRemove(id: string, name: string) {
    if (!confirm(`Remove ${name} from the team?`)) return;
    try {
      await userApi.remove(id);
      setMembers((m) => m.filter((x) => x.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  function handleInviteSuccess(email: string) {
    setShowInvite(false);
    setSuccessMsg(`Invitation sent to ${email}`);
    setTimeout(() => setSuccessMsg(""), 5000);
  }

  const activeMembers = members.filter((m) => m.isActive !== false);
  const inactiveMembers = members.filter((m) => m.isActive === false);

  return (
    <>
      <Topbar
        title="Team members"
        actions={
          <Button size="sm" onClick={() => setShowInvite(true)}>
            + Invite member
          </Button>
        }
      />

      <div className="p-6 space-y-6">
        {loadError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{loadError}</div>
        )}
        {successMsg && (
          <div className="p-3 bg-green-light border border-green/20 rounded-xl text-sm text-dark">{successMsg}</div>
        )}

        {/* Active members */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-dark">Active members</h2>
            {!loading && (
              <span className="text-sm text-muted">{activeMembers.length} member{activeMembers.length !== 1 ? "s" : ""}</span>
            )}
          </div>
          {loading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2].map((i) => <Sk key={i} className="h-14 w-full" />)}
            </div>
          ) : activeMembers.length === 0 ? (
            <div className="py-12 text-center text-muted text-sm">No active members.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Member", "Email", "Role", "Joined", ""].map((col, i) => (
                    <th key={col}
                      className={`px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide ${i === 4 ? "text-right" : "text-left"}`}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeMembers.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-green-light flex items-center justify-center text-green text-sm font-bold shrink-0">
                          {m.name?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <span className="text-sm font-medium text-dark">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">{m.email}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? "bg-gray-100 text-gray-600"}`}>
                        {m.role?.replace(/_/g, " ") ?? m.role}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">{formatDate(m.createdAt)}</td>
                    <td className="px-6 py-3 text-right">
                      {m.role !== "OWNER" && (
                        <button
                          onClick={() => handleRemove(m.id, m.name)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pending invitations */}
        {(invitations.length > 0 || (!loading && members.length === 0)) && (
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-dark">Pending invitations</h2>
            </div>
            {invitations.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted">No pending invitations</p>
                <button onClick={() => setShowInvite(true)}
                  className="mt-2 text-sm text-green hover:underline font-medium">
                  Invite someone →
                </button>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Email", "Role", "Sent", "Expires"].map((col) => (
                      <th key={col} className="px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide text-left">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="border-b border-border last:border-0">
                      <td className="px-6 py-3 text-sm text-dark">{inv.email}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[inv.role] ?? "bg-gray-100 text-gray-600"}`}>
                          {inv.role?.replace(/_/g, " ") ?? inv.role}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-muted">{formatDate(inv.createdAt)}</td>
                      <td className="px-6 py-3 text-sm text-muted">
                        {inv.expiresAt ? formatDate(inv.expiresAt) : "7 days"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Inactive / deactivated members */}
        {inactiveMembers.length > 0 && (
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-dark text-muted">Deactivated</h2>
            </div>
            <table className="w-full">
              <tbody>
                {inactiveMembers.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0 opacity-50">
                    <td className="px-6 py-3 text-sm text-dark">{m.name}</td>
                    <td className="px-6 py-3 text-sm text-muted">{m.email}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
                        {m.role?.replace(/_/g, " ") ?? m.role}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className="text-xs text-muted">Deactivated</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} onSuccess={handleInviteSuccess} />
      )}
    </>
  );
}
