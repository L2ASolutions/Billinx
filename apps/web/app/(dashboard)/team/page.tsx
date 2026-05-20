"use client";

import { useEffect, useState, FormEvent } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { userApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";

const ROLES = ["VIEWER", "ACCOUNTANT", "API_MANAGER", "ADMIN", "OWNER"];

const ROLE_COLORS: Record<string, string> = {
  OWNER: "bg-purple-50 text-purple-700",
  ADMIN: "bg-blue-50 text-blue-700",
  ACCOUNTANT: "bg-green-50 text-green-700",
  API_MANAGER: "bg-yellow-50 text-yellow-700",
  VIEWER: "bg-gray-100 text-gray-600",
};

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  isActive?: boolean;
}

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("VIEWER");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await userApi.list();
      setMembers(res.data as Member[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    setInviting(true);
    try {
      await userApi.invite(inviteEmail, inviteRole);
      setInviteSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      setShowInvite(false);
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(id: string, name: string) {
    if (!confirm(`Remove ${name} from the team?`)) return;
    try {
      await userApi.remove(id);
      setMembers((m) => m.filter((x) => x.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  return (
    <>
      <Topbar
        title="Team"
        actions={
          <Button size="sm" onClick={() => setShowInvite(!showInvite)}>
            + Invite member
          </Button>
        }
      />

      <div className="p-6 space-y-4">
        {inviteSuccess && (
          <div className="p-3 bg-green-light border border-green/20 rounded-xl text-sm text-dark">
            {inviteSuccess}
          </div>
        )}

        {showInvite && (
          <div className="bg-white rounded-xl border border-border p-6">
            <h2 className="font-semibold text-dark mb-4">Invite team member</h2>
            <form onSubmit={handleInvite} className="flex gap-3 items-end">
              <div className="flex-1">
                <Input
                  label="Email address"
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark mb-1">Role</label>
                <select
                  className="px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <Button type="submit" loading={inviting}>Send invite</Button>
              <Button type="button" variant="ghost" onClick={() => setShowInvite(false)}>Cancel</Button>
            </form>
            {inviteError && (
              <p className="text-sm text-red-500 mt-2">{inviteError}</p>
            )}
          </div>
        )}

        <div className="bg-white rounded-xl border border-border">
          {loading ? (
            <div className="p-12 flex justify-center">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Name</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Email</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Role</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide">Joined</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-green-light flex items-center justify-center text-green text-sm font-bold">
                          {m.name?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <span className="text-sm font-medium text-dark">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">{m.email}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[m.role] ?? "bg-gray-100 text-gray-600"}`}>
                        {m.role}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">{formatDate(m.createdAt)}</td>
                    <td className="px-6 py-3 text-right">
                      {m.role !== "OWNER" && (
                        <button
                          onClick={() => handleRemove(m.id, m.name)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors"
                        >
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
      </div>
    </>
  );
}
