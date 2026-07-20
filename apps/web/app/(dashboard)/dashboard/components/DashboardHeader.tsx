'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { NotificationBell } from '@/components/dashboard/NotificationBell';
import { Sk } from './Sk';
import { UserAvatarMenu } from './UserAvatarMenu';
import { canCustomize } from './visibility';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-NG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatRole(role: string): string {
  return role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

interface DashboardHeaderProps {
  authLoading: boolean;
  firstName: string;
  tenantName: string;
  role: string;
  displayFullName: string;
  onOpenPanel: () => void;
  onLogout: () => void;
}

export function DashboardHeader({
  authLoading,
  firstName,
  tenantName,
  role,
  displayFullName,
  onOpenPanel,
  onLogout,
}: DashboardHeaderProps) {
  return (
    <header className="bg-white border-b border-border px-6 py-5 flex items-start justify-between sticky top-0 z-10">
      <div>
        {authLoading ? (
          <>
            <Sk className="h-6 w-52 mb-2" />
            <Sk className="h-4 w-72" />
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-dark">
              {greeting()}, {firstName}
            </h1>
            <p className="text-sm text-muted mt-0.5">
              {todayLabel()}{tenantName ? ` · ${tenantName}` : ''}
            </p>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <NotificationBell />
        {canCustomize(role) && (
          <Button size="sm" variant="secondary" onClick={onOpenPanel}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Customize
          </Button>
        )}
        <Link href="/invoices/new">
          <Button size="sm">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" className="mr-1.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create invoice
          </Button>
        </Link>
        <UserAvatarMenu fullName={displayFullName} role={formatRole(role)} onLogout={onLogout} />
      </div>
    </header>
  );
}
