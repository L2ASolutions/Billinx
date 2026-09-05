import { supportTicketApi } from "./api";

// Auto-capture cooldown — a render-error loop or a repeatedly-thrown async
// error can otherwise fire this many times a second; the backend also rate
// limits (10 / 10 min per tenant/IP), but there's no reason to even attempt
// more than one auto-report in a short window client-side.
const AUTO_CAPTURE_COOLDOWN_MS = 30_000;
let lastAutoCaptureAt = 0;

interface ReportOptions {
  errorMessage: string;
  stackTrace?: string;
  userDescription?: string;
}

function getBrowserInfo(): string {
  if (typeof navigator === "undefined") return "unknown";
  return `${navigator.userAgent} | ${navigator.platform ?? "unknown platform"}`;
}

// A 1x1 transparent PNG — used only if html2canvas itself throws, so the
// required multipart "screenshot" field is always present and ticket
// creation never depends on the capture succeeding.
function placeholderScreenshotBlob(): Blob {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

async function captureScreenshot(): Promise<Blob> {
  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(document.body, {
      logging: false,
      useCORS: true,
      // Full page/viewport as currently rendered — not the whole scrollable
      // document, which can be enormous on long list pages.
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
    });
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    return blob ?? placeholderScreenshotBlob();
  } catch {
    return placeholderScreenshotBlob();
  }
}

async function submitReport(opts: ReportOptions): Promise<void> {
  const screenshot = await captureScreenshot();

  // tenantId/userId are deliberately NOT sent here — the backend's
  // CreateSupportTicketDto whitelist would reject the whole request
  // (forbidNonWhitelisted) if we did, and it ignores client-supplied ids
  // anyway: an authenticated request already carries the accessToken
  // (attached by requestMultipart), which the backend re-derives tenantId/
  // userId from server-side rather than trusting the body.
  const fd = new FormData();
  fd.append("screenshot", screenshot, "screenshot.png");
  fd.append("errorMessage", opts.errorMessage.slice(0, 2000));
  if (opts.stackTrace) fd.append("stackTrace", opts.stackTrace.slice(0, 20000));
  fd.append("pageUrl", window.location.href);
  fd.append("browserInfo", getBrowserInfo());
  if (opts.userDescription) {
    fd.append("userDescription", opts.userDescription.slice(0, 2000));
  }

  await supportTicketApi.report(fd);
}

// Fire-and-forget by design (spec: never block the caller on the upload).
// Errors from the report pipeline itself are swallowed — reporting a crash
// must never itself throw a second one.
export function reportError(opts: ReportOptions): void {
  void submitReport(opts).catch((err) => {
    console.warn("[Billinx] Failed to submit error report:", err);
  });
}

// Used by the manual "Report an issue" button, which has its own explicit
// user action and therefore isn't subject to the auto-capture cooldown.
export function reportIssueManually(opts: ReportOptions): void {
  reportError(opts);
}

export function reportUnhandledError(opts: ReportOptions): void {
  const now = Date.now();
  if (now - lastAutoCaptureAt < AUTO_CAPTURE_COOLDOWN_MS) return;
  lastAutoCaptureAt = now;
  reportError(opts);
}

let listenersInstalled = false;

// Registered once (see GlobalErrorListeners) to catch runtime errors that
// never reach a React error boundary — a thrown error outside render (e.g.
// in an event handler or a timer) and a rejected promise nobody awaited.
export function installGlobalErrorListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;

  window.addEventListener("error", (event) => {
    reportUnhandledError({
      errorMessage: event.message || "Unknown runtime error",
      stackTrace: event.error?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportUnhandledError({
      errorMessage:
        reason instanceof Error
          ? reason.message
          : `Unhandled promise rejection: ${String(reason)}`,
      stackTrace: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
