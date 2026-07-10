"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useAuth } from "@/lib/auth";
import { userApi, invoiceApi, incomingInvoiceApi, api } from "@/lib/api";
import { UserProfileProvider, type UserProfile } from "@/lib/userProfile";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sentPendingBadge, setSentPendingBadge] = useState(0);
  const [receivedBadge, setReceivedBadge] = useState(0);
  const [inventoryEnabled, setInventoryEnabled] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    userApi.me()
      .then((data) => setProfile(data as UserProfile))
      .catch(() => {});
    invoiceApi.stats()
      .then((raw: unknown) => {
        const s = raw as { firsAwaiting?: number; pending?: number };
        setSentPendingBadge(s.firsAwaiting ?? s.pending ?? 0);
      })
      .catch(() => {});
    incomingInvoiceApi.stats()
      .then((s) => setReceivedBadge(s.received ?? 0))
      .catch(() => {});
    api.get<{ inventoryEnabled?: boolean }>('/v1/tenants/me')
      .then((t) => setInventoryEnabled(!!t?.inventoryEnabled))
      .catch(() => {});
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <UserProfileProvider
      profile={profile}
      inventoryEnabled={inventoryEnabled}
      setInventoryEnabled={setInventoryEnabled}
    >
      <div className="flex min-h-screen bg-surface">
        <Sidebar
          invoiceBadge={sentPendingBadge}
          receivedBadge={receivedBadge}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />
        {/* Mobile hamburger button */}
        <button
          className="md:hidden fixed top-0 left-0 h-16 w-16 flex items-center justify-center z-30 text-dark"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <main className="flex-1 md:ml-64 min-h-screen">
          {children}
        </main>
      </div>
    </UserProfileProvider>
  );
}
