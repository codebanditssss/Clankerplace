"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  CreditCard,
  User,
  Globe,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Plus,
  HelpCircle,
  MessageCircle,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/cn";
import { avatarChar, shortHandle, isWalletEmail } from "@/lib/display-name";
import { KeyCap } from "@/components/ui/keycap";
import { DISCORD_INVITE_URL } from "@/lib/external-links";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
};

const PRIMARY: NavItem[] = [
  { href: "/", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { href: "/pods", label: "Pods", icon: <Boxes className="h-4 w-4" /> },
  { href: "/domains", label: "Domains", icon: <Globe className="h-4 w-4" /> },
];

const SECONDARY: NavItem[] = [
  { href: "/billing", label: "Billing", icon: <CreditCard className="h-4 w-4" /> },
  { href: "/account", label: "Account", icon: <User className="h-4 w-4" /> },
];

const FOOTER_ITEMS = [
  {
    label: "Discord",
    icon: <MessageCircle className="h-3.5 w-3.5" />,
    href: DISCORD_INVITE_URL,
    external: true,
  },
  {
    label: "Documentation",
    icon: <HelpCircle className="h-3.5 w-3.5" />,
    href: "https://hermes-agent.nousresearch.com/docs/",
    external: true,
  },
];

export function Sidebar({
  email,
  podCount,
  collapsed,
  onCollapseToggle,
  onNewPod,
  mobileOpen,
  onMobileClose,
}: {
  email: string;
  podCount: number;
  collapsed: boolean;
  onCollapseToggle: () => void;
  onNewPod: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  // Lock body scroll while the mobile drawer is open.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Close the drawer on Escape.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMobileClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {/* Desktop sidebar (md and up). Animated width for collapse. */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 60 : 240 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-hairline bg-neutral-950 md:flex"
      >
        <SidebarBody
          email={email}
          podCount={podCount}
          collapsed={collapsed}
          onCollapseToggle={onCollapseToggle}
          onNewPod={onNewPod}
        />
      </motion.aside>

      {/* Mobile drawer (below md). Slide-in from the left with a backdrop. */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="mobile-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={onMobileClose}
            aria-hidden
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {mobileOpen && (
          <motion.aside
            key="mobile-drawer"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
            className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-hairline bg-neutral-950 shadow-[8px_0_32px_-8px_rgba(0,0,0,0.6)] md:hidden"
            role="dialog"
            aria-label="Main navigation"
          >
            <SidebarBody
              email={email}
              podCount={podCount}
              collapsed={false}
              onCollapseToggle={onMobileClose}
              onNewPod={() => {
                onNewPod();
                onMobileClose();
              }}
              onItemClick={onMobileClose}
              mobile
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarBody({
  email,
  podCount,
  collapsed,
  onCollapseToggle,
  onNewPod,
  onItemClick,
  mobile,
}: {
  email: string;
  podCount: number;
  collapsed: boolean;
  onCollapseToggle: () => void;
  onNewPod: () => void;
  onItemClick?: () => void;
  mobile?: boolean;
}) {
  const path = usePathname();
  const items = PRIMARY.map((i, idx) => ({
    ...i,
    index: idx + 1,
    count: i.href === "/pods" ? podCount : undefined,
  }));
  const secondary = SECONDARY.map((i, idx) => ({
    ...i,
    index: PRIMARY.length + idx + 1,
  }));

  return (
    <>
      {/* Wordmark + collapse/close toggle */}
      <div className="flex h-[54px] items-center gap-2.5 border-b border-hairline px-4">
        <Link
          href="/"
          onClick={onItemClick}
          className="flex items-center gap-2 overflow-hidden text-foreground"
        >
          <Image
            src="/logo-128.png"
            alt=""
            width={128}
            height={128}
            priority
            className="h-8 w-8 shrink-0"
          />
          <AnimatePresence initial={false}>
            {!collapsed ? (
              <motion.span
                key="full"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.15 }}
                className="text-[15px] font-semibold tracking-tight text-foreground"
              >
                Fuel<span className="text-signal">Born</span>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </Link>
        <button
          onClick={onCollapseToggle}
          aria-label={mobile ? "close navigation" : "toggle sidebar"}
          className="ml-auto p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-foreground"
        >
          {mobile ? (
            <X className="h-4 w-4" />
          ) : collapsed ? (
            <PanelLeft className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* New pod CTA */}
      <div className="p-3">
        <NewPodButton collapsed={collapsed} onClick={onNewPod} />
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-px px-3">
        {!collapsed && (
          <div className="micro pb-2 pt-1 text-neutral-500">
            Workspace
          </div>
        )}
        {items.map((i) => (
          <SidebarLink
            key={i.href}
            item={i}
            active={isActive(path, i.href)}
            collapsed={collapsed}
            onClick={onItemClick}
          />
        ))}
        {!collapsed && (
          <div className="micro pb-2 pt-5 text-neutral-500">
            Settings
          </div>
        )}
        {collapsed && <div className="my-3 h-px bg-hairline" />}
        {secondary.map((i) => (
          <SidebarLink
            key={i.href}
            item={i}
            active={isActive(path, i.href)}
            collapsed={collapsed}
            onClick={onItemClick}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className="space-y-1 border-t border-hairline p-3">
        {FOOTER_ITEMS.map((f) => (
          <a
            key={f.label}
            href={f.href}
            target={f.external ? "_blank" : undefined}
            rel="noreferrer"
            onClick={onItemClick}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 text-[12px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-foreground",
              collapsed && "justify-center",
            )}
          >
            {f.icon}
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {f.label}
                </motion.span>
              )}
            </AnimatePresence>
          </a>
        ))}
        <UserFooter email={email} collapsed={collapsed} onNavigate={onItemClick} />
      </div>
    </>
  );
}

function NewPodButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-2 bg-signal px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset] transition-colors hover:bg-signal/90 active:bg-signal/80",
        collapsed && "justify-center px-0",
      )}
    >
      <Plus className="h-3.5 w-3.5 flex-none" strokeWidth={2.5} />
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.1 }}
            className="flex flex-1 items-center gap-2 whitespace-nowrap"
          >
            <span className="tracking-wide">Deploy pod</span>
            <span className="ml-auto opacity-80">
              <KeyCap>N</KeyCap>
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

function SidebarLink({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem & { index?: number };
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-2.5 px-2 py-1.5 text-[12.5px] font-medium transition-colors",
        active
          ? "bg-neutral-800 text-foreground"
          : "text-neutral-300 hover:bg-neutral-900 hover:text-foreground",
        collapsed && "justify-center",
      )}
    >
      <span className="flex-none">{item.icon}</span>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.1 }}
            className="flex flex-1 items-center justify-between gap-2"
          >
            <span className="flex items-baseline gap-2">
              {typeof item.index === "number" && (
                <span
                  className={cn(
                    "font-mono text-[10px] tabular tracking-wider",
                    active ? "text-signal" : "text-neutral-500",
                  )}
                >
                  {String(item.index).padStart(2, "0")}
                </span>
              )}
              {item.label}
            </span>
            {typeof item.count === "number" && (
              <span className="font-mono text-[10px] tabular text-neutral-400">
                {item.count}
              </span>
            )}
          </motion.span>
        )}
      </AnimatePresence>
      {active && !collapsed && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute -left-3 top-1.5 h-[calc(100%-12px)] w-[2px] bg-signal"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
      {active && collapsed && (
        <motion.span
          layoutId="sidebar-active-collapsed"
          className="absolute right-1 top-2 h-1.5 w-1.5 rounded-full bg-signal"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
    </Link>
  );
}

function UserFooter({
  email,
  collapsed,
  onNavigate,
}: {
  email: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const isWallet = isWalletEmail(email);
  const display = isWallet ? shortHandle(email) : email;
  const initial = avatarChar(email);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-2 py-1.5 text-[12px] text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-foreground",
          collapsed && "justify-center",
        )}
        title={isWallet ? "Wallet user" : email}
      >
        <div
          className={cn(
            "flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-semibold text-foreground",
            isWallet ? "bg-signal/20 text-signal" : "bg-neutral-700",
          )}
        >
          {initial}
        </div>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={cn("truncate", isWallet && "font-mono")}
            >
              {display}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-40 mb-1 w-56 overflow-hidden border border-hairline bg-neutral-900 shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)]">
            <div className="border-b border-hairline px-3 py-2">
              <div className="micro text-neutral-500">
                {isWallet ? "Signed in with wallet" : "Signed in as"}
              </div>
              <div className={cn("mt-1 truncate text-[12px] text-foreground", isWallet && "font-mono")}>
                {display}
              </div>
            </div>
            <Link
              href="/account"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="flex items-center gap-2 px-3 py-2 text-[12px] text-neutral-300 hover:bg-neutral-800 hover:text-foreground"
            >
              <User className="h-3.5 w-3.5" />
              Account
            </Link>
            <Link
              href="/billing"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="flex items-center gap-2 px-3 py-2 text-[12px] text-neutral-300 hover:bg-neutral-800 hover:text-foreground"
            >
              <CreditCard className="h-3.5 w-3.5" />
              Billing
            </Link>
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.assign("/login");
              }}
              className="flex w-full items-center gap-2 border-t border-hairline px-3 py-2 text-left text-[12px] text-neutral-300 hover:bg-neutral-800 hover:text-error"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function isActive(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}
