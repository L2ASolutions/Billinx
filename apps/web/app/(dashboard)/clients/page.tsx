"use client";

import { useState, useEffect, useCallback } from "react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { clientApi, ClientRecord, referenceApi } from "@/lib/api";

function fmtCurrency(n: number) {
  return "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

interface ClientModalProps {
  client?: ClientRecord;
  onClose: () => void;
  onSave: () => void;
}

function ClientModal({ client, onClose, onSave }: ClientModalProps) {
  const [form, setForm] = useState({
    companyName: client?.companyName ?? "",
    tin: client?.tin ?? "",
    email: client?.email ?? "",
    telephone: client?.telephone ?? "",
    contactPerson: client?.contactPerson ?? "",
    notes: client?.notes ?? "",
    businessDescription: client?.businessDescription ?? "",
    streetName: (client?.postalAddress?.streetName as string) ?? "",
    cityName: (client?.postalAddress?.cityName as string) ?? "",
    state: (client?.postalAddress?.state as string) ?? "",
    lga: (client?.postalAddress?.lga as string) ?? "",
  });
  const [states, setStates] = useState<{ code: string; name: string }[]>([]);
  const [lgas, setLgas] = useState<{ code: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { referenceApi.states().then(setStates).catch(() => {}); }, []);
  useEffect(() => {
    if (!form.state) { setLgas([]); return; }
    referenceApi.lgas(form.state).then(setLgas).catch(() => setLgas([]));
  }, [form.state]);

  function uf(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const postalAddress = form.streetName || form.cityName || form.state
        ? { streetName: form.streetName, cityName: form.cityName, state: form.state, lga: form.lga, country: "NG" }
        : undefined;
      const payload = {
        companyName: form.companyName,
        tin: form.tin || undefined,
        email: form.email || undefined,
        telephone: form.telephone || undefined,
        contactPerson: form.contactPerson || undefined,
        notes: form.notes || undefined,
        businessDescription: form.businessDescription || undefined,
        postalAddress,
      };
      if (client) {
        await clientApi.update(client.id, payload);
      } else {
        await clientApi.create(payload);
      }
      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save client");
    } finally {
      setSaving(false);
    }
  }

  const inp = "w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green/30 focus:border-green";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-dark">{client ? "Edit client" : "Add client"}</h2>
          <button onClick={onClose} className="text-muted hover:text-dark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

          <Input label="Company name" value={form.companyName} onChange={uf("companyName")} required placeholder="Acme Ltd" />
          <Input label="TIN (optional)" value={form.tin} onChange={uf("tin")} placeholder="12345678-0001" />
          <Input label="Email (optional)" type="email" value={form.email} onChange={uf("email")} placeholder="accounts@company.com" />
          <Input label="Phone (optional)" type="tel" value={form.telephone} onChange={uf("telephone")} placeholder="+2348012345678" />
          <Input label="Contact person (optional)" value={form.contactPerson} onChange={uf("contactPerson")} placeholder="John Doe" />

          <div>
            <label className="block text-sm font-medium text-dark mb-1">Business description (optional)</label>
            <textarea className={inp + " resize-none"} rows={2} value={form.businessDescription} onChange={uf("businessDescription")} placeholder="e.g. Manufacturing company" />
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Address</p>
            <div className="space-y-3">
              <Input label="Street address" value={form.streetName} onChange={uf("streetName")} placeholder="1 Marina Street" />
              <Input label="City" value={form.cityName} onChange={uf("cityName")} placeholder="Lagos" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-dark mb-1">State</label>
                  <select className={inp} value={form.state} onChange={uf("state")}>
                    <option value="">Select state…</option>
                    {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark mb-1">LGA</label>
                  <select className={inp} value={form.lga} onChange={uf("lga")} disabled={!form.state}>
                    <option value="">{form.state ? "Select LGA…" : "Select state first"}</option>
                    {lgas.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark mb-1">Notes (optional)</label>
            <textarea className={inp + " resize-none"} rows={2} value={form.notes} onChange={uf("notes")} placeholder="Internal notes about this client" />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? "Saving…" : client ? "Save changes" : "Add client"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState<ClientRecord | undefined>();

  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await clientApi.list({ search: search || undefined, page, limit });
      setClients(res.data);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  function openAdd() { setEditClient(undefined); setShowModal(true); }
  function openEdit(c: ClientRecord) { setEditClient(c); setShowModal(true); }
  function closeModal() { setShowModal(false); setEditClient(undefined); }
  function afterSave() { closeModal(); load(); }

  const totalPages = Math.ceil(total / limit);

  return (
    <>
      <Topbar title="Customers" />
      {showModal && <ClientModal client={editClient} onClose={closeModal} onSave={afterSave} />}

      <div className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-dark">Customers</h1>
            <p className="text-sm text-muted mt-0.5">Your buyer profiles</p>
          </div>
          <Button onClick={openAdd}>+ Add client</Button>
        </div>

        <div className="max-w-sm">
          <Input
            placeholder="Search by name or TIN…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>}

        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-4 py-3 font-medium text-muted">Company</th>
                <th className="text-left px-4 py-3 font-medium text-muted">Contact</th>
                <th className="text-center px-4 py-3 font-medium text-muted">Invoices</th>
                <th className="text-right px-4 py-3 font-medium text-muted">Total billed</th>
                <th className="text-left px-4 py-3 font-medium text-muted">Last invoice</th>
                <th className="text-right px-4 py-3 font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="text-center py-12 text-muted">Loading…</td></tr>
              )}
              {!loading && clients.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="py-14 flex flex-col items-center text-center">
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted mb-3">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                        <line x1="23" y1="11" x2="17" y2="11" /><line x1="20" y1="8" x2="20" y2="14" />
                      </svg>
                      <p className="text-sm font-semibold text-dark mb-1">No clients yet</p>
                      <p className="text-sm text-muted mb-4">Clients are auto-created when you send your first invoice.</p>
                      <button
                        onClick={openAdd}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-green text-white text-sm font-medium rounded-lg hover:bg-green/90 transition-colors"
                      >
                        + Add client
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && clients.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-dark">{c.companyName}</p>
                    {c.tin && <p className="text-xs text-muted mt-0.5">TIN: {c.tin}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {c.email && <p className="text-dark">{c.email}</p>}
                    {c.telephone && <p className="text-xs text-muted">{c.telephone}</p>}
                    {!c.email && !c.telephone && <span className="text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center bg-green/10 text-green font-semibold text-xs px-2 py-0.5 rounded-full min-w-[28px]">
                      {c.totalInvoices}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-dark">{fmtCurrency(c.totalBilled)}</td>
                  <td className="px-4 py-3 text-muted">{fmtDate(c.lastInvoiceAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(c)}
                        className="text-xs text-green hover:underline font-medium"
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted">
            <span>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-40 hover:bg-surface"
              >
                Previous
              </button>
              <button
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-40 hover:bg-surface"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
