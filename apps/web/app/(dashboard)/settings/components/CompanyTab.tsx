"use client";

import { useEffect, useState, FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api, referenceApi } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { sel } from "./shared";

interface TaxRepresentative {
  name?: string;
  tin?: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface TenantProfile {
  name?: string;
  tin?: string;
  industry?: string;
  registrationNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  lga?: string;
  postalZone?: string;
  country?: string;
  phone?: string;
  website?: string;
  telephone?: string;
  businessDescription?: string;
  bankName?: string;
  bankAccount?: string;
  bankAccountName?: string;
  taxRepresentative?: TaxRepresentative;
}

export function CompanyTab() {
  const [profile, setProfile] = useState<TenantProfile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [states, setStates] = useState<{ code: string; name: string }[]>([]);
  const [lgas, setLgas] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    referenceApi.states().then(setStates).catch(() => {});
    api.get<TenantProfile & { registeredAddress?: Record<string, string> }>("/v1/tenants/me")
      .then((data) => {
        const addr = data?.registeredAddress ?? {};
        setProfile({
          ...data,
          address: addr.street ?? "",
          city: addr.city ?? "",
          state: addr.state ?? "",
          lga: addr.lga ?? "",
          postalZone: addr.postalZone ?? "",
          country: addr.country ?? "",
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount pattern — not a bug. Refactor to shared data-fetching hook in a future PR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!profile.state) { setLgas([]); return; }
    referenceApi.lgas(profile.state).then(setLgas).catch(() => setLgas([]));
  }, [profile.state]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      // Backend addressFields: street, city, state, lga, postalZone, country
      // profile.address maps to the "street" field on the backend
      const { address, ...rest } = profile;
      await api.patch("/v1/tenants/me", { ...rest, street: address });
      setSuccess("Company profile saved.");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const uf = (field: keyof TenantProfile) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setProfile((p) => ({ ...p, [field]: e.target.value }));

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-xl border border-border p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0,1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}
      {success && <div className="p-3 bg-green-light border border-green/20 rounded-xl text-sm text-dark">{success}</div>}

      {/* Business information */}
      <div className="bg-white rounded-xl border border-border p-6">
        <h3 className="font-semibold text-dark mb-4">Business information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Business name" placeholder="Acme Limited" value={profile.name ?? ""}
            onChange={uf("name")} />
          <Input label="TIN" placeholder="12345678-0001" value={profile.tin ?? ""}
            onChange={uf("tin")} />
          <Input label="Industry" placeholder="e.g. Technology, Manufacturing" value={profile.industry ?? ""}
            onChange={uf("industry")} />
          <Input label="CAC registration number" placeholder="RC-000000" value={profile.registrationNumber ?? ""}
            onChange={uf("registrationNumber")} />
          <Input label="Phone" type="tel" placeholder="+234 800 000 0000" value={profile.phone ?? ""}
            onChange={uf("phone")} />
          <Input label="Website" type="url" placeholder="https://yourcompany.com" value={profile.website ?? ""}
            onChange={uf("website")} />
          <Input label="Telephone (for FIRS invoices)" type="tel" placeholder="+2348012345678" value={profile.telephone ?? ""}
            onChange={uf("telephone")} />
          <div className="md:col-span-2">
            <Input label="Business description (for FIRS invoices)" placeholder="e.g. Software services company"
              value={profile.businessDescription ?? ""} onChange={uf("businessDescription")} />
          </div>
          <div className="md:col-span-2 pt-2 border-t border-border">
            <p className="text-sm font-medium text-dark mb-3">Bank transfer details (shown on payment page)</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input label="Bank name" placeholder="e.g. GTBank, Access Bank" value={profile.bankName ?? ""}
                onChange={uf("bankName")} />
              <Input label="Account number" placeholder="0123456789" value={profile.bankAccount ?? ""}
                onChange={uf("bankAccount")} />
              <Input label="Account name" placeholder="Company name on account" value={profile.bankAccountName ?? ""}
                onChange={uf("bankAccountName")} />
            </div>
          </div>
        </div>
      </div>

      {/* Registered address */}
      <div className="bg-white rounded-xl border border-border p-6">
        <h3 className="font-semibold text-dark mb-4">Registered address</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Input label="Street address" placeholder="1 Broad Street" value={profile.address ?? ""}
              onChange={uf("address")} />
          </div>
          <Input label="City" placeholder="Lagos" value={profile.city ?? ""} onChange={uf("city")} />
          <div>
            <label className="block text-sm font-medium text-dark mb-1">State</label>
            <select className={sel()} value={profile.state ?? ""} onChange={uf("state")}>
              <option value="">Select state…</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">LGA</label>
            <select className={sel()} value={profile.lga ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, lga: e.target.value }))}
              disabled={!profile.state}>
              <option value="">{profile.state ? "Select LGA…" : "Select state first"}</option>
              {lgas.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <Input label="Postal zone" placeholder="e.g. 100001" value={profile.postalZone ?? ""}
            onChange={uf("postalZone")} />
          <Input label="Country" placeholder="Nigeria" value={profile.country ?? ""} onChange={uf("country")} />
        </div>
      </div>

      {/* Tax representative */}
      <TaxRepSection profile={profile} setProfile={setProfile} />

      <div className="flex justify-end">
        <Button type="submit" loading={saving}>Save changes</Button>
      </div>
    </form>
  );
}

function TaxRepSection({
  profile,
  setProfile,
}: {
  profile: TenantProfile;
  setProfile: React.Dispatch<React.SetStateAction<TenantProfile>>;
}) {
  const [open, setOpen] = useState(false);
  const tr = profile.taxRepresentative ?? {};

  function ufTr(field: keyof TaxRepresentative) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setProfile((p) => ({
        ...p,
        taxRepresentative: { ...(p.taxRepresentative ?? {}), [field]: e.target.value },
      }));
  }

  return (
    <div className="bg-white rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-sm font-semibold text-dark hover:bg-surface/50 transition-colors rounded-xl"
      >
        <span>Tax representative</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`transition-transform text-muted ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="px-6 pb-6 border-t border-border pt-4">
          <p className="text-xs text-muted mb-4">If set, this will pre-fill the tax representative on every new invoice. Leave blank if not applicable.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Representative name" placeholder="Full name or company" value={tr.name ?? ""} onChange={ufTr("name")} />
            <Input label="TIN" placeholder="12345678-0001" value={tr.tin ?? ""} onChange={ufTr("tin")} />
            <Input label="Email" type="email" placeholder="taxrep@company.com" value={tr.email ?? ""} onChange={ufTr("email")} />
            <Input label="Phone" type="tel" placeholder="+2348012345678" value={tr.phone ?? ""} onChange={ufTr("phone")} />
            <div className="md:col-span-2">
              <Input label="Address" placeholder="Street address" value={tr.address ?? ""} onChange={ufTr("address")} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
