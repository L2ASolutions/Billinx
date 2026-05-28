"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useAuth } from "@/lib/auth";
import { userApi } from "@/lib/api";
import { UserProfileProvider, type UserProfile } from "@/lib/userProfile";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);

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
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const fullName = profile?.fullName
    ?? (profile?.firstName && profile?.lastName ? `${profile.firstName} ${profile.lastName}` : undefined);
  const role = profile?.roles?.[0];

  return (
    <UserProfileProvider profile={profile}>
      <div className="flex min-h-screen bg-surface">
        <Sidebar fullName={fullName} role={role} />
        <main className="flex-1 ml-64 min-h-screen">
          {children}
        </main>
      </div>
    </UserProfileProvider>
  );
}
