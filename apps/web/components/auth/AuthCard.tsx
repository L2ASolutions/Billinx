"use client";

import { ReactNode } from "react";
import Image from "next/image";

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'radial-gradient(ellipse at 65% 35%, rgba(29,158,117,0.07) 0%, rgba(255,255,255,0) 55%), #F9FAFB' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Image src="/billinx-wordmark.svg" alt="Billinx Solutions" width={320} height={60} unoptimized className="h-12 w-auto mx-auto mb-3" />
          <p className="text-sm text-muted">E-invoicing compliance for Nigerian businesses</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-border shadow-card-login p-8">
          <h1 className="text-2xl font-bold text-dark mb-1">{title}</h1>
          {subtitle && <p className="text-muted text-sm mb-6">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
