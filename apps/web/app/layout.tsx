import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ErrorBoundary } from "@/components/ErrorReporting/ErrorBoundary";
import { GlobalErrorListeners } from "@/components/ErrorReporting/GlobalErrorListeners";

export const metadata: Metadata = {
  title: "Billinx Solutions — E-Invoicing Platform",
  description: "FIRS-compliant e-invoicing for Nigerian businesses",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <GlobalErrorListeners />
        <ErrorBoundary>
          <AuthProvider>{children}</AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
