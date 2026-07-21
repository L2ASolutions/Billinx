// ── Section keys ──────────────────────────────────────────────────────────────

export const SECTION_LABELS: Record<string, string> = {
  receivables:     'Outstanding Receivables & Payables',
  vat_strip:       'VAT Summary',
  revenue_chart:   'Monthly Revenue chart',
  pipeline_chart:  'Invoice Pipeline chart',
  activity_chart:  'Invoice Activity chart',
  needs_attention: 'Needs Attention',
};

export const FINANCIAL_SECTIONS = new Set(['receivables', 'vat_strip', 'revenue_chart']);

// ── Role helpers ──────────────────────────────────────────────────────────────

export function canSeeFinancials(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role);
}

export function canCustomize(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role);
}

// Matches the backend's invoice-creation RolesGuard (OWNER/ADMIN/ACCOUNTANT).
export function canCreateInvoice(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(role);
}

export function isSectionVisible(
  sectionKey: string,
  role: string,
  tenantVisibility: Record<string, boolean> | undefined,
  userHidden: string[],
): boolean {
  if (['OWNER', 'ADMIN'].includes(role)) return true;
  if (tenantVisibility && tenantVisibility[sectionKey] === false) return false;
  if (userHidden.includes(sectionKey)) return false;
  return true;
}
