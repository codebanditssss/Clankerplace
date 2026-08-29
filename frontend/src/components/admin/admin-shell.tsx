"use client";

// Admin-side chrome. Mirrors the (app) AppShell but with admin-specific
// nav, a SignalRed accent strip across the top (visual reminder that you
// are in the privileged surface), and an impersonation banner that
// renders when admin_impersonations has an active session for the
// current admin.

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import {
  Activity,
  Users,
  Boxes,
  Receipt,
  Shield,
  Server,
  LogOut,
  Search,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AdminCommandPalette } from "./admin-command-palette";

type NavItem = { href: string; label: string; icon: React.ReactNode };

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: <Activity className="h-4 w-4" /> },
  { href: "/admin/users", label: "Users", icon: <Users className="h-4 w-4" /> },
  { href: "/admin/pods", label: "Pods", icon: <Boxes className="h-4 w-4" /> },
  { href: "/admin/billing", label: "Billing", icon: <Receipt className="h-4 w-4" /> },
  { href: "/admin/audit", label: "Audit log", icon: <Shield className="h-4 w-4" /> },
  { href: "/admin/system", label: "System", icon: <Server className="h-4 w-4" /> },
];

export function AdminShell({
  adminEmail,
  children,
}: {
  adminEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-dvh bg-neutral-950 text-foreground">
      <Sidebar pathname={pathname} adminEmail={adminEmail} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Admin marker strip — visually distinct from the user dashboard. */}
        <div className="h-0.5 w-full bg-[color:var(--acc-red)]" aria-hidden />
        <Topbar
          adminEmail={adminEmail}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main className="flex-1 px-6 py-6 lg:px-10 lg:py-8">{children}</main>
      </div>

      <AdminCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--neutral-900)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-manrope), system-ui, sans-serif",
            fontSize: 12,
            borderRadius: 4,
          },
        }}
      />
    </div>
  );
}

function Sidebar({
  pathname,
  adminEmail,
}: {
  pathname: string | null;
  adminEmail: string;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-[color:var(--border)] bg-[color:var(--bg-1)] lg:flex lg:flex-col">
      <Link
        href="/admin"
        className="flex h-14 items-center gap-2 border-b border-[color:var(--border-subtle)] px-5"
      >
        <Image
          src="/pods_favicon_tight_512.png"
          alt=""
          width={128}
          height={128}
          priority
          className="h-12 w-12 shrink-0"
        />
        <ShieldAlert className="h-4 w-4 text-[color:var(--acc-red)]" />
        <span className="text-sm font-semibold tracking-tight">
          FuelBorn{" "}
          <span className="text-[color:var(--acc-red)]">admin</span>
        </span>
      </Link>
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/admin" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-3 py-2 text-[13px] tracking-tight transition-colors",
                active
                  ? "bg-[color:var(--bg-3)] text-[color:var(--text-primary)]"
                  : "text-[color:var(--text-tertiary)] hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-secondary)]",
              )}
            >
              <span
                className={
                  active
                    ? "text-[color:var(--text-primary)]"
                    : "text-[color:var(--text-tertiary)]"
                }
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-[color:var(--border-subtle)] p-3">
        <div className="px-3 py-2 text-[11px] tracking-tight text-[color:var(--text-tertiary)]">
          Signed in as
        </div>
        <div className="px-3 pb-2 text-[12px] font-medium tracking-tight text-[color:var(--text-secondary)]">
          {adminEmail}
        </div>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-sm px-3 py-2 text-[12px] tracking-tight text-[color:var(--text-tertiary)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-secondary)]"
        >
          <LogOut className="h-3.5 w-3.5" /> Back to user dashboard
        </Link>
      </div>
    </aside>
  );
}

function Topbar({
  onOpenPalette,
}: {
  adminEmail: string;
  onOpenPalette: () => void;
}) {
  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-1)] px-6">
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.16em] text-[color:var(--text-tertiary)]">
        <ShieldAlert className="h-3 w-3 text-[color:var(--acc-red)]" />
        admin console
      </div>
      <button
        onClick={onOpenPalette}
        className="flex h-8 min-w-[16rem] items-center gap-2 rounded-sm border border-[color:var(--border)] bg-[color:var(--bg-2)] px-2.5 text-[12px] tracking-tight text-[color:var(--text-tertiary)] transition-colors hover:border-[color:var(--border-strong)]"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search users, pods, invoices…</span>
        <span className="ml-auto rounded border border-[color:var(--border-subtle)] px-1.5 text-[10px] text-[color:var(--text-tertiary)]">
          ⌘K
        </span>
      </button>
    </header>
  );
}
