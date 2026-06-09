"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { userApi, tenantApi, type DashboardVisibility } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useRequireAuth } from "@/lib/auth";

// ── Constants ─────────────────────────────────────────────────────────────────

const INVITE_ROLES = ["ADMIN", "ACCOUNTANT", "API_MANAGER", "VIEWER"] as const;

const ROLE_COLORS: Record<string, string> = {
  OWNER:       "bg-emerald-50 text-emerald-700 border border-emerald-200",
  ADMIN:       "bg-blue-50 text-blue-700 border border-blue-200",
  ACCOUNTANT:  "bg-amber-50 text-amber-700 border border-amber-200",
  API_MANAGER: "bg-purple-50 text-purple-700 border border-purple-200",
  VIEWER:      "bg-gray-100 text-gray-600 border border-gray-200",
};

const ROLE_DISPLAY: Record<string, string> = {
  OWNER:       "Owner",
  ADMIN:       "Admin",
  ACCOUNTANT:  "Invoice Creator",
  API_MANAGER: "API Manager",
  VIEWER:      "Viewer",
};

const ROLE_DESC: Record<string, string> = {
  ADMIN:       "Full access except API keys and account deletion",
  ACCOUNTANT:  "Can create and manage invoices. Cannot access settings or payments",
  API_MANAGER: "Manage API keys and webhook integrations only",
  VIEWER:      "Read-only access to invoices and reports",
};

// ── Dashboard visibility ──────────────────────────────────────────────────────

const VISIBILITY_SECTIONS: Array<{ key: keyof DashboardVisibility; label: string }> = [
  { key: "receivables",     label: "Financial Cards (Receivables, Payables, Net Cash)" },
  { key: "vat_strip",       label: "VAT Summary" },
  { key: "revenue_chart",   label: "Monthly Revenue Chart" },
  { key: "pipeline_chart",  label: "Invoice Pipeline Chart" },
  { key: "activity_chart",  label: "Invoice Activity Chart" },
  { key: "needs_attention", label: "Needs Attention" },
];

// ── Permission matrix ─────────────────────────────────────────────────────────

const PERMISSIONS: Array<{
  label: string;
  owner: boolean;
  admin: boolean;
  accountant: boolean;
  viewer: boolean;
}> = [
  { label: "Create invoices",       owner: true,  admin: true,  accountant: true,  viewer: false },
  { label: "View all invoices",     owner: true,  admin: true,  accountant: true,  viewer: true  },
  { label: "Cancel invoices",       owner: true,  admin: true,  accountant: false, viewer: false },
  { label: "Record payments",       owner: true,  admin: true,  accountant: false, viewer: false },
  { label: "Manage team members",   owner: true,  admin: true,  accountant: false, viewer: false },
  { label: "Manage API keys",       owner: true,  admin: false, accountant: false, viewer: false },
  { label: "Manage webhooks",       owner: true,  admin: true,  accountant: false, viewer: false },
  { label: "View activity reports", owner: true,  admin: true,  accountant: false, viewer: true  },
  { label: "Manage account settings", owner: true, admin: true, accountant: false, viewer: false },
  { label: "Manage products",       owner: true,  admin: true,  accountant: true,  viewer: false },
  { label: "Export reports",        owner: true,  admin: true,  accountant: false, viewer: true  },
  { label: "View VAT reports",      owner: true,  admin: true,  accountant: false, viewer: true  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "members" | "invitations" | "permissions";

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

// ── Permission cell ───────────────────────────────────────────────────────────

function PermCell({ allowed }: { allowed: boolean }) {
  if (allowed) {
    return (
      <td className="px-4 py-3 text-center">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-50">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="#059669" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </td>
    );
  }
  return (
    <td className="px-4 py-3 text-center">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-50">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 2l6 6M8 2l-6 6" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    </td>
  );
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
                {INVITE_ROLES.map((r) => (
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
                      className="mt-0.5 text-green focus:ring-green/30 shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-dark">{ROLE_DISPLAY[r]}</p>
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
  const { user } = useRequireAuth();
  const currentRole = user?.role ?? "VIEWER";
  const canManageVisibility = ["OWNER", "ADMIN"].includes(currentRole);

  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // ── Dashboard visibility state ────────────────────────────────────────────
  const [visibility, setVisibility] = useState<{ VIEWER: DashboardVisibility; ACCOUNTANT: DashboardVisibility } | null>(null);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [visToast, setVisToast] = useState("");

  const loadVisibility = useCallback(async () => {
    if (!canManageVisibility) return;
    setVisibilityLoading(true);
    try {
      const data = await tenantApi.getDashboardVisibility();
      setVisibility(data);
    } finally {
      setVisibilityLoading(false);
    }
  }, [canManageVisibility]);

  useEffect(() => {
    if (tab === "permissions" && canManageVisibility && !visibility) {
      void loadVisibility();
    }
  }, [tab, canManageVisibility, visibility, loadVisibility]);

  async function handleVisibilityToggle(role: "VIEWER" | "ACCOUNTANT", section: keyof DashboardVisibility, newValue: boolean) {
    if (!visibility) return;
    const prev = visibility;
    // Optimistic update
    setVisibility({
      ...visibility,
      [role]: { ...visibility[role], [section]: newValue },
    });
    try {
      await tenantApi.updateDashboardVisibility(role, section, newValue);
      setVisToast("Visibility updated");
      setTimeout(() => setVisToast(""), 3000);
    } catch {
      setVisibility(prev);
      setVisToast("Failed to update — please try again");
      setTimeout(() => setVisToast(""), 4000);
    }
  }

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await userApi.list();
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

  const TABS: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "members",     label: "Active members",      count: activeMembers.length },
    { key: "invitations", label: "Pending invitations", count: invitations.length   },
    { key: "permissions", label: "Role permissions"                                  },
  ];

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

      {visToast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 text-sm px-5 py-2.5 rounded-xl shadow-lg ${
          visToast.startsWith("Failed") ? "bg-red-600 text-white" : "bg-dark text-white"
        }`}>
          {visToast}
        </div>
      )}

      <div className="p-6 space-y-6">
        {loadError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{loadError}</div>
        )}
        {successMsg && (
          <div className="p-3 bg-green-light border border-green/20 rounded-xl text-sm text-dark">{successMsg}</div>
        )}

        {/* Tab bar */}
        <div className="border-b border-border">
          <nav className="flex gap-1 -mb-px">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key
                    ? "border-green text-green"
                    : "border-transparent text-muted hover:text-dark hover:border-gray-300"
                }`}
              >
                {t.label}
                {t.count !== undefined && !loading && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                    tab === t.key ? "bg-green-light text-green" : "bg-gray-100 text-muted"
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Active members tab ─────────────────────────────────────────── */}
        {tab === "members" && (
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
                          {ROLE_DISPLAY[m.role] ?? m.role?.replace(/_/g, " ") ?? m.role}
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

            {/* Deactivated members */}
            {inactiveMembers.length > 0 && (
              <div className="border-t border-border">
                <div className="px-6 py-3 bg-gray-50">
                  <span className="text-xs font-medium text-muted uppercase tracking-wide">Deactivated</span>
                </div>
                <table className="w-full">
                  <tbody>
                    {inactiveMembers.map((m) => (
                      <tr key={m.id} className="border-b border-border last:border-0 opacity-50">
                        <td className="px-6 py-3 text-sm text-dark">{m.name}</td>
                        <td className="px-6 py-3 text-sm text-muted">{m.email}</td>
                        <td className="px-6 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
                            {ROLE_DISPLAY[m.role] ?? m.role?.replace(/_/g, " ") ?? m.role}
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
        )}

        {/* ── Pending invitations tab ────────────────────────────────────── */}
        {tab === "invitations" && (
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-dark">Pending invitations</h2>
            </div>
            {loading ? (
              <div className="p-6 space-y-3">
                {[0, 1].map((i) => <Sk key={i} className="h-12 w-full" />)}
              </div>
            ) : invitations.length === 0 ? (
              <div className="py-12 text-center">
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
                          {ROLE_DISPLAY[inv.role] ?? inv.role?.replace(/_/g, " ") ?? inv.role}
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

        {/* ── Role permissions tab ───────────────────────────────────────── */}
        {tab === "permissions" && (
          <>
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="px-6 py-5 border-b border-border">
              <h2 className="font-semibold text-dark">Role permissions</h2>
              <p className="mt-0.5 text-sm text-muted">What each role can access in your Billinx account</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-gray-50">
                    <th className="px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide text-left w-64">
                      Permission
                    </th>
                    {[
                      { label: "Owner",           color: "bg-emerald-100 text-emerald-700" },
                      { label: "Admin",            color: "bg-blue-100 text-blue-700"      },
                      { label: "Invoice Creator",  color: "bg-amber-100 text-amber-700"    },
                      { label: "Viewer",           color: "bg-gray-100 text-gray-600"      },
                    ].map(({ label, color }) => (
                      <th key={label} className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${color}`}>
                          {label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((perm, idx) => (
                    <tr key={perm.label} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                      <td className="px-6 py-3 text-sm text-dark font-medium">{perm.label}</td>
                      <PermCell allowed={perm.owner}      />
                      <PermCell allowed={perm.admin}      />
                      <PermCell allowed={perm.accountant} />
                      <PermCell allowed={perm.viewer}     />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-border">
              <p className="text-xs text-muted">
                Permissions are determined by role. To change a team member&apos;s permissions, update their role in the{" "}
                <button onClick={() => setTab("members")} className="text-green hover:underline font-medium">
                  Active members
                </button>{" "}
                section.
              </p>
            </div>
          </div>

          {/* ── Dashboard Visibility (OWNER/ADMIN only) ────────────────────── */}
          {canManageVisibility && (
            <div className="bg-white rounded-xl border border-border overflow-hidden mt-6">
              <div className="px-6 py-5 border-b border-border">
                <h2 className="font-semibold text-dark">Dashboard Visibility</h2>
                <p className="mt-0.5 text-sm text-muted">
                  Control which dashboard sections each role can see by default. These settings apply to all team members with that role. Changes take effect immediately.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-gray-50">
                      <th className="px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide text-left w-72">
                        Dashboard section
                      </th>
                      {[
                        { label: "Owner",           color: "bg-emerald-100 text-emerald-700" },
                        { label: "Admin",            color: "bg-blue-100 text-blue-700"      },
                        { label: "Invoice Creator",  color: "bg-amber-100 text-amber-700"    },
                        { label: "Viewer",           color: "bg-gray-100 text-gray-600"      },
                      ].map(({ label, color }) => (
                        <th key={label} className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${color}`}>
                            {label}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {VISIBILITY_SECTIONS.map(({ key, label }, idx) => (
                      <tr key={key} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                        <td className="px-6 py-3 text-sm text-dark font-medium">{label}</td>

                        {/* Owner — always on, locked */}
                        <td className="px-4 py-3 text-center">
                          <div className="relative group inline-flex items-center justify-center">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-50">
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="#059669" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                            <span className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-dark text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              Always visible — cannot be restricted
                            </span>
                          </div>
                        </td>

                        {/* Admin — always on, locked */}
                        <td className="px-4 py-3 text-center">
                          <div className="relative group inline-flex items-center justify-center">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-50">
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="#059669" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                            <span className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-dark text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                              Always visible — cannot be restricted
                            </span>
                          </div>
                        </td>

                        {/* Accountant — toggleable */}
                        <td className="px-4 py-3 text-center">
                          {visibilityLoading || !visibility ? (
                            <div className="inline-block w-9 h-5 rounded-full bg-gray-100 animate-pulse" />
                          ) : (
                            <button
                              onClick={() => handleVisibilityToggle("ACCOUNTANT", key, !visibility.ACCOUNTANT[key])}
                              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none mx-auto ${visibility.ACCOUNTANT[key] ? "bg-green" : "bg-gray-200"}`}
                              role="switch"
                              aria-checked={visibility.ACCOUNTANT[key]}
                              aria-label={`${label} for Invoice Creator`}
                            >
                              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm mt-0.5 transition-transform duration-200 ${visibility.ACCOUNTANT[key] ? "translate-x-4" : "translate-x-0.5"}`} />
                            </button>
                          )}
                        </td>

                        {/* Viewer — toggleable */}
                        <td className="px-4 py-3 text-center">
                          {visibilityLoading || !visibility ? (
                            <div className="inline-block w-9 h-5 rounded-full bg-gray-100 animate-pulse" />
                          ) : (
                            <button
                              onClick={() => handleVisibilityToggle("VIEWER", key, !visibility.VIEWER[key])}
                              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none mx-auto ${visibility.VIEWER[key] ? "bg-green" : "bg-gray-200"}`}
                              role="switch"
                              aria-checked={visibility.VIEWER[key]}
                              aria-label={`${label} for Viewer`}
                            >
                              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm mt-0.5 transition-transform duration-200 ${visibility.VIEWER[key] ? "translate-x-4" : "translate-x-0.5"}`} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-6 py-4 bg-gray-50 border-t border-border">
                <p className="text-xs text-muted">
                  Changes take effect immediately for all team members with that role. Individual members can further customise their own view within the sections you allow.
                </p>
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} onSuccess={handleInviteSuccess} />
      )}
    </>
  );
}
