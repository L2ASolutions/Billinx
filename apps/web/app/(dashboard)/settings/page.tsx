"use client";

import { useEffect, useState, FormEvent } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiKeyApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";

interface ApiKey {
  id: string;
  label: string;
  environment: string;
  keyPrefix: string;
  requestCount: number;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState("test");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [loadError, setLoadError] = useState("");

  async function loadKeys() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await apiKeyApi.list();
      setKeys(res.data as ApiKey[]);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadKeys(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setKeyError("");
    setCreating(true);
    try {
      const res = await apiKeyApi.create(newKeyLabel, newKeyEnv);
      setNewKey(res.key);
      setNewKeyLabel("");
      loadKeys();
    } catch (err: unknown) {
      setKeyError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string, label: string) {
    if (!confirm(`Revoke key "${label}"? This cannot be undone.`)) return;
    try {
      await apiKeyApi.revoke(id);
      setKeys((k) => k.filter((x) => x.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Revoke failed");
    }
  }

  return (
    <>
      <Topbar title="Settings" />

      <div className="p-6 space-y-6 max-w-3xl">
        {loadError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {loadError}
          </div>
        )}

        {/* Profile */}
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="font-semibold text-dark mb-4">Profile</h2>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-green-light flex items-center justify-center text-green text-2xl font-bold">
              {user?.name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div>
              <p className="text-base font-semibold text-dark">{user?.name}</p>
              <p className="text-sm text-muted">{user?.email}</p>
              <span className="inline-block mt-1 px-2 py-0.5 bg-surface border border-border rounded text-xs text-muted">
                {user?.role}
              </span>
            </div>
          </div>
        </div>

        {/* API Keys */}
        <div className="bg-white rounded-xl border border-border p-6">
          <h2 className="font-semibold text-dark mb-4">API Keys</h2>

          {newKey && (
            <div className="mb-4 p-4 bg-green-light border border-green/20 rounded-xl">
              <p className="text-xs font-medium text-dark mb-1">Your new API key (copy it now &mdash; it won&apos;t be shown again):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm text-dark bg-white px-3 py-2 rounded-lg border border-border break-all">
                  {newKey}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(newKey)}
                  className="text-green hover:text-green-dark text-sm font-medium"
                >
                  Copy
                </button>
              </div>
              <button onClick={() => setNewKey("")} className="text-xs text-muted mt-2 hover:text-dark">Dismiss</button>
            </div>
          )}

          {/* Create key form */}
          <form onSubmit={handleCreate} className="flex gap-3 items-end mb-6">
            <div className="flex-1">
              <Input
                label="Label"
                placeholder="e.g. Production App"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Environment</label>
              <select
                className="px-3 py-2.5 rounded-lg border border-border bg-white text-dark text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green"
                value={newKeyEnv}
                onChange={(e) => setNewKeyEnv(e.target.value)}
              >
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </div>
            <Button type="submit" loading={creating}>Create</Button>
          </form>
          {keyError && <p className="text-sm text-red-500 mb-4">{keyError}</p>}

          {/* Keys list */}
          {loading ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">No API keys yet.</p>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-dark">{key.label}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${key.environment === "live" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {key.environment}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-0.5">
                      {key.keyPrefix}•••• &middot; {key.requestCount.toLocaleString()} requests &middot; Created {formatDate(key.createdAt)}
                      {key.lastUsedAt && ` · Last used ${formatDate(key.lastUsedAt)}`}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRevoke(key.id, key.label)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
