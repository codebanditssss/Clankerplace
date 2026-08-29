"use client";

import * as React from "react";
import { Toaster } from "sonner";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import {
  CommandPalette,
  useCommandPalette,
} from "@/components/command-palette";
import { DeployHub } from "@/components/deploy-hub";

type Crumb = { label: string; href?: string };

const SIDEBAR_KEY = "pods-ml.sidebar-collapsed";

export function AppShell({
  email,
  podCount,
  crumbs,
  rightSlot,
  children,
}: {
  email: string;
  podCount: number;
  crumbs?: Crumb[];
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  const palette = useCommandPalette();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [wizardInitialType, setWizardInitialType] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {}
  }, []);

  const setCollapsedPersistent = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(SIDEBAR_KEY, v ? "1" : "0");
    } catch {}
  };

  // Keyboard: N to open deploy wizard (when no input is focused), ESC closes.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.key === "n" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        target &&
        target.tagName !== "INPUT" &&
        target.tagName !== "TEXTAREA" &&
        !target.isContentEditable
      ) {
        e.preventDefault();
        setWizardOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    const onCustomOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: string }>).detail;
      setWizardInitialType(detail?.type ?? null);
      setWizardOpen(true);
    };
    window.addEventListener("pods:open-wizard", onCustomOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pods:open-wizard", onCustomOpen);
    };
  }, []);

  return (
    <div className="flex min-h-dvh bg-neutral-950 text-foreground">
      <Sidebar
        email={email}
        podCount={podCount}
        collapsed={collapsed}
        onCollapseToggle={() => setCollapsedPersistent(!collapsed)}
        onNewPod={() => setWizardOpen(true)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          crumbs={crumbs}
          onOpenPalette={() => palette.setOpen(true)}
          rightSlot={rightSlot}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />
        <main className="flex-1">{children}</main>
      </div>

      <CommandPalette
        open={palette.open}
        onOpenChange={palette.setOpen}
      />

      <DeployHub
        open={wizardOpen}
        onOpenChange={(v) => {
          setWizardOpen(v);
          if (!v) setWizardInitialType(null);
        }}
        initialType={wizardInitialType}
      />

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
