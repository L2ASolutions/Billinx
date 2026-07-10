"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useInventoryEnabled } from "@/lib/userProfile";
import { cn } from "@/lib/utils";

// ── Icons ─────────────────────────────────────────────────────────────────────

const DashboardIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);

const InvoiceIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const PurchasesIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><polyline points="12 12 9 15 12 18" /><line x1="15" y1="15" x2="9" y2="15" />
  </svg>
);

const WebhooksIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 16.016c.27.15.54.3.81.45M9 9c.27-.15.54-.3.81-.45" />
    <circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><circle cx="12" cy="5" r="2" />
    <path d="M5 17v-1a7 7 0 0 1 7-7" />
    <path d="M21 17v-1a7 7 0 0 0-4.17-6.4" />
    <path d="M11 7.07A7 7 0 0 1 19 14" />
  </svg>
);

const PaymentsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const CustomersIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <line x1="23" y1="11" x2="17" y2="11" /><line x1="20" y1="8" x2="20" y2="14" />
  </svg>
);

const VatReturnIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="9" x2="9" y2="21" />
  </svg>
);

const SubmissionsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const AuditIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

const ProductsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const InventoryIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M12 22V12" /><path d="M3.3 7l8.7 5 8.7-5" />
  </svg>
);

const ReportsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
  </svg>
);

const TeamIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const SupportIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function formatRole(role: string): string {
  return role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// ── Nav structure ─────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: "invoices" | "payments";
  exact?: boolean;
}

interface NavSection {
  label: string | null;
  items: NavItem[];
}

function buildNavSections(inventoryEnabled: boolean): NavSection[] {
  return [
    {
      label: null,
      items: [
        { label: "Dashboard", href: "/dashboard", icon: <DashboardIcon />, exact: true },
      ],
    },
    {
      label: "Finance",
      items: [
        { label: "Sales Invoices", href: "/invoices", icon: <InvoiceIcon />, badge: "invoices" },
        { label: "Payments",       href: "/payments", icon: <PaymentsIcon />, badge: "payments" },
        { label: "Clients",        href: "/clients",  icon: <CustomersIcon /> },
      ],
    },
    {
      label: "Purchases",
      items: [
        { label: "Purchase Invoices", href: "/purchases", icon: <PurchasesIcon /> },
      ],
    },
    {
      label: "Compliance",
      items: [
        { label: "VAT Return",  href: "/vat-return",  icon: <VatReturnIcon /> },
        { label: "Submissions", href: "/submissions", icon: <SubmissionsIcon /> },
        { label: "Audit log",   href: "/audit-log",   icon: <AuditIcon /> },
      ],
    },
    {
      label: "Operations",
      items: [
        { label: "Products", href: "/products", icon: <ProductsIcon /> },
        ...(inventoryEnabled ? [{ label: "Inventory", href: "/inventory", icon: <InventoryIcon /> }] : []),
        { label: "Reports",  href: "/reports",  icon: <ReportsIcon /> },
      ],
    },
    {
      label: "Settings",
      items: [
        { label: "Team",     href: "/team",     icon: <TeamIcon /> },
        { label: "Settings", href: "/settings", icon: <SettingsIcon /> },
        { label: "Webhooks", href: "/webhooks", icon: <WebhooksIcon /> },
        { label: "Support",  href: "/support",  icon: <SupportIcon /> },
      ],
    },
  ];
}

// ── Shared nav content ────────────────────────────────────────────────────────

function NavContent({
  sections,
  isActive,
  combinedInvoiceBadge,
  overdueBadge,
  onNavClick,
}: {
  sections: NavSection[];
  isActive: (item: NavItem) => boolean;
  combinedInvoiceBadge: number;
  overdueBadge: number;
  onNavClick?: () => void;
}) {
  return (
    <nav className="flex-1 px-3 py-3 overflow-y-auto">
      {sections.map((section, si) => (
        <div key={section.label ?? "__root"} className={si > 0 ? "mt-4" : ""}>
          {section.label && (
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/30">
              {section.label}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  onClick={onNavClick}
                  className={cn(
                    "flex items-center gap-3 py-2.5 rounded-r-md text-sm font-medium transition-colors",
                    active
                      ? "bg-white/[0.08] text-white border-l-[3px] border-l-[#1D9E75] pl-[9px] pr-3"
                      : "text-[#9CA3AF] hover:text-white hover:bg-white/[0.04] pl-3 pr-3"
                  )}
                >
                  <span className={active ? "text-[#1D9E75]" : ""}>{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge === "invoices" && combinedInvoiceBadge > 0 && (
                    <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">
                      {combinedInvoiceBadge > 99 ? "99+" : combinedInvoiceBadge}
                    </span>
                  )}
                  {item.badge === "payments" && overdueBadge > 0 && (
                    <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">
                      {overdueBadge > 99 ? "99+" : overdueBadge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Sidebar({
  invoiceBadge = 0,
  receivedBadge = 0,
  overdueBadge = 0,
  fullName,
  role: roleProp,
  mobileOpen = false,
  onMobileClose,
}: {
  invoiceBadge?: number;
  receivedBadge?: number;
  overdueBadge?: number;
  fullName?: string;
  role?: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [inventoryEnabled] = useInventoryEnabled();

  function handleLogout() {
    logout();
    router.push('/login');
  }

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href || pathname + (typeof window !== 'undefined' ? window.location.search : '') === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/") || pathname.startsWith(item.href + "?");
  }

  const combinedInvoiceBadge = invoiceBadge + receivedBadge;

  const displayName = fullName ?? user?.name ?? '';
  const nameParts = displayName.trim().split(/\s+/).filter(Boolean);
  const initials = nameParts.length >= 2
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : (nameParts[0]?.[0]?.toUpperCase() ?? 'U');
  const rawRole = roleProp ?? user?.role ?? '';
  const displayRole = rawRole ? formatRole(rawRole) : '';

  const sections = buildNavSections(inventoryEnabled);

  const userArea = (
    <div className="flex-shrink-0 border-t border-white/10 p-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)' }}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-bold truncate">{displayName || "—"}</p>
          <p className="text-white/40 text-xs truncate">{displayRole}</p>
        </div>
        <button
          onClick={handleLogout}
          className="text-white/40 hover:text-white transition-colors shrink-0"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogoutIcon />
        </button>
      </div>
    </div>
  );

  const logo = (
    <div className="px-6 py-5 border-b border-white/10 flex-shrink-0">
      <Image src="/billinx-wordmark-dark.svg" alt="Billinx Solutions" width={320} height={60} unoptimized className="h-9 w-auto" />
      {user?.tenantName && (
        <p className="text-white/40 text-xs mt-1.5 truncate">{user.tenantName}</p>
      )}
    </div>
  );

  return (
    <>
      {/* ── Desktop sidebar (md+) ─────────────────────────────────────────────── */}
      <aside className="w-64 bg-dark hidden md:flex flex-col h-screen fixed left-0 top-0 z-20">
        {logo}
        <NavContent
          sections={sections}
          isActive={isActive}
          combinedInvoiceBadge={combinedInvoiceBadge}
          overdueBadge={overdueBadge}
        />
        {userArea}
      </aside>

      {/* ── Mobile drawer ─────────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          {/* Drawer */}
          <div className="relative w-72 bg-dark flex flex-col h-full shadow-2xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 flex-shrink-0">
              <Image src="/billinx-wordmark-dark.svg" alt="Billinx Solutions" width={320} height={60} unoptimized className="h-9 w-auto" />
              <button
                onClick={onMobileClose}
                className="text-white/40 hover:text-white transition-colors p-1"
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>
            {user?.tenantName && (
              <p className="text-white/40 text-xs px-6 pb-2 truncate">{user.tenantName}</p>
            )}
            <NavContent
              sections={sections}
              isActive={isActive}
              combinedInvoiceBadge={combinedInvoiceBadge}
              overdueBadge={overdueBadge}
              onNavClick={onMobileClose}
            />
            {userArea}
          </div>
        </div>
      )}
    </>
  );
}
