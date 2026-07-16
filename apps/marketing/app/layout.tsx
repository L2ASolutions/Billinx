import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Billinx — Nigeria's Smart E-Invoicing Platform",
  description: "FIRS-compliant e-invoicing for Nigerian businesses",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
