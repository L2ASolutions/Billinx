import { formatDateTime } from "@/lib/utils";
import type { InvoiceDetail } from "./types";

export function AcceptedBanner({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <div className="bg-green-50 border border-green/20 rounded-xl p-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 space-y-3 min-w-0">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" className="text-green-600 shrink-0">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="text-sm font-semibold text-green-700" data-testid="invoice-status-badge">FIRS Accepted</span>
            {invoice.acceptedAt && (
              <span className="text-xs text-green-600">{formatDateTime(invoice.acceptedAt)}</span>
            )}
          </div>
          <div>
            <p className="text-xs text-green-600 mb-0.5 font-medium uppercase tracking-wide">Invoice Reference Number (IRN)</p>
            <p className="font-mono text-sm text-green-800 font-semibold break-all" data-testid="invoice-irn">{invoice.platformIrn}</p>
          </div>
          {invoice.firsConfirmedIrn && (
            <div>
              <p className="text-xs text-green-600 mb-0.5 font-medium uppercase tracking-wide">FIRS Reference</p>
              <p className="font-mono text-sm text-green-800 break-all" data-testid="firs-reference">{invoice.firsConfirmedIrn}</p>
            </div>
          )}
          {invoice.csid && (
            <div>
              <p className="text-xs text-green-600 mb-0.5 font-medium uppercase tracking-wide">CSID</p>
              <p className="font-mono text-sm text-green-800 break-all">{invoice.csid}</p>
            </div>
          )}
        </div>
        {(invoice.qrCode ?? invoice.qrCodeBase64) && invoice.status === 'ACCEPTED' && (
          <div className="shrink-0">
            <p className="text-xs text-green-600 mb-1 text-center font-medium uppercase tracking-wide">QR Code</p>
            <div className="p-2 bg-white border border-green/20 rounded-lg">
              {(() => {
                const raw = invoice.qrCode ?? invoice.qrCodeBase64!;
                const src = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="FIRS QR Code" width={150} height={150} className="block" />
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
