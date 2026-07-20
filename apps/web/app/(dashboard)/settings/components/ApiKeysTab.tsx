"use client";

import { useEffect, useState, FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiKeyApi } from "@/lib/api";
import { SkeletonTableRow } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/utils";
import { sel } from "./shared";

interface ApiKey {
  id: string;
  name: string;
  environment: string;
  keyPrefix: string;
  scopes?: string[];
  requestCount: number;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

function isFullAccess(scopes?: string[]): boolean {
  return !scopes || scopes.length === 0 || scopes.includes("*");
}

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newEnv, setNewEnv] = useState("test");
  const [newAccess, setNewAccess] = useState<"full" | "read">("full");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [rotatedKey, setRotatedKey] = useState<{ id: string; key: string } | null>(null);
  const [keyError, setKeyError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [rotatingId, setRotatingId] = useState<string | null>(null);

  async function loadKeys() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await apiKeyApi.list();
      // Backend returns ApiKey[] directly (not { data: [] }) — handle both shapes.
      const arr = (Array.isArray(res) ? res : (res as unknown as { data?: unknown[] }).data ?? []) as ApiKey[];
      setKeys(arr);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }

  // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadKeys(); }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setKeyError("");
    setCreating(true);
    try {
      const res = await apiKeyApi.create(newLabel, newEnv, newAccess);
      setNewKey(res.key);
      setNewLabel("");
      loadKeys();
    } catch (err: unknown) {
      setKeyError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRotate(id: string) {
    if (!confirm("Rotate this key? The old key will have a 24-hour grace period.")) return;
    setRotatingId(id);
    try {
      const res = await apiKeyApi.rotate(id);
      setRotatedKey({ id, key: res.key });
      loadKeys();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Rotate failed");
    } finally {
      setRotatingId(null);
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`Revoke key "${name}"? This cannot be undone.`)) return;
    try {
      await apiKeyApi.revoke(id);
      setKeys((k) => k.filter((x) => x.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Revoke failed");
    }
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{loadError}</div>
      )}

      {(newKey || rotatedKey) && (
        <div className="p-4 bg-green-light border border-green/20 rounded-xl">
          <p className="text-xs font-medium text-dark mb-1">
            {rotatedKey ? "Rotated API key — copy now, won't be shown again:" : "New API key — copy it now, it won't be shown again:"}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm text-dark bg-white px-3 py-2 rounded-lg border border-border break-all">
              {newKey || rotatedKey?.key}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(newKey || rotatedKey?.key || "")}
              className="text-green hover:text-green-dark text-sm font-medium shrink-0"
            >
              Copy
            </button>
          </div>
          <button onClick={() => { setNewKey(""); setRotatedKey(null); }}
            className="text-xs text-muted mt-2 hover:text-dark">Dismiss</button>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-48">
          <Input label="Label" placeholder="e.g. Production App" value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-dark mb-1">Environment</label>
          <select className={sel("w-auto")} value={newEnv} onChange={(e) => setNewEnv(e.target.value)}>
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-dark mb-1">Access</label>
          <select className={sel("w-auto")} value={newAccess} onChange={(e) => setNewAccess(e.target.value as "full" | "read")}>
            <option value="full">Full access</option>
            <option value="read">Read only</option>
          </select>
        </div>
        <Button type="submit" loading={creating}>Create key</Button>
      </form>
      <p className="text-xs text-muted -mt-3">
        Read only keys can view invoices, submissions, products, and reports but cannot create, submit, or modify anything.
      </p>
      {keyError && <p className="text-sm text-red-500">{keyError}</p>}

      {loading ? (
        <div className="space-y-3 py-2">
          {[0,1,2].map(i => <SkeletonTableRow key={i} />)}
        </div>
      ) : keys.length === 0 ? (
        <div className="p-8 text-center bg-surface rounded-xl border border-border">
          <p className="text-sm text-muted">No API keys yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div key={key.id} className="p-4 bg-surface rounded-xl border border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-dark">{key.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${key.environment === "live" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {key.environment}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${isFullAccess(key.scopes) ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
                      {isFullAccess(key.scopes) ? "Full access" : "Read only"}
                    </span>
                    {key.expiresAt && new Date(key.expiresAt) < new Date() && (
                      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-50 text-red-600">Expired</span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    <span className="font-mono">{key.keyPrefix}••••</span>
                    {" · "}{(key.requestCount ?? 0).toLocaleString()} requests
                    {" · "}Created {formatDate(key.createdAt)}
                    {key.lastUsedAt && ` · Last used ${formatDate(key.lastUsedAt)}`}
                    {key.expiresAt && ` · Expires ${formatDate(key.expiresAt)}`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" size="sm" loading={rotatingId === key.id}
                    onClick={() => handleRotate(key.id)}>Rotate</Button>
                  <Button variant="danger" size="sm"
                    onClick={() => handleRevoke(key.id, key.name)}>Revoke</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
