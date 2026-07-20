export function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-sm text-muted w-40 shrink-0">{label}</dt>
      <dd className="text-sm text-dark font-medium">{value ?? "—"}</dd>
    </div>
  );
}
