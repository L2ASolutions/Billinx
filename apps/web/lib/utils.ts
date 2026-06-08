export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function formatCurrency(amount: number, currency = 'NGN'): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatCurrencyShort(amount: number, currency = 'NGN'): string {
  const symbol = currency === 'NGN' ? '₦' : currency + ' ';
  if (amount >= 1_000_000) return `${symbol}${(amount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (amount >= 1_000) return `${symbol}${Math.round(amount / 1_000)}K`;
  return formatCurrency(amount, currency);
}

export function formatInvoiceNumber(inv: {
  invoiceNumber?: string;
  platformIrn?: string;
  irn?: string;
  id?: string;
}): string {
  if (inv.invoiceNumber) return inv.invoiceNumber;
  const irnRaw = inv.platformIrn ?? inv.irn;
  if (irnRaw) {
    const part = irnRaw.split('-')[0];
    const match = part.match(/^INV(\d{4})(\d{4})$/);
    if (match) return `INV-${match[1]}-${match[2]}`;
    if (part.startsWith('INV')) return part;
  }
  if (inv.id) return `INV-${inv.id.slice(0, 8).toUpperCase()}`;
  return '—';
}
