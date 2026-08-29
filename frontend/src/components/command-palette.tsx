"use client";

import * as React from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import {
  Terminal,
  Activity,
  Plug,
  Settings,
  LogOut,
  Home,
  Search,
  BookOpen,
  ExternalLink,
  MessageCircle,
} from "lucide-react";
import { KeyCap } from "./ui/keycap";
import { DISCORD_INVITE_URL } from "@/lib/external-links";

type Action = {
  id: string;
  label: string;
  hint?: string;
  group: "navigation" | "pod" | "connectors" | "docs" | "account";
  icon: React.ReactNode;
  run: () => void;
  keywords?: string[];
};

export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({
  open,
  onOpenChange,
  podIdentifier,
  setTab,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  podIdentifier?: string;
  setTab?: (id: string) => void;
}) {
  const router = useRouter();
  const close = () => onOpenChange(false);

  const actions: Action[] = React.useMemo(() => {
    const base: Action[] = [
      {
        id: "go-home",
        label: "Go to dashboard",
        group: "navigation",
        icon: <Home className="h-3.5 w-3.5" />,
        run: () => router.push("/"),
        keywords: ["pods", "home"],
      },
    ];
    if (podIdentifier && setTab) {
      base.push(
        {
          id: "pod-console",
          label: "Open console",
          group: "pod",
          icon: <Terminal className="h-3.5 w-3.5" />,
          run: () => setTab("console"),
          keywords: ["terminal", "shell", "bash", "ssh"],
        },
        {
          id: "pod-stats",
          label: "Open stats",
          group: "pod",
          icon: <Activity className="h-3.5 w-3.5" />,
          run: () => setTab("stats"),
          keywords: ["metrics", "cpu", "memory"],
        },
        {
          id: "pod-connectors",
          label: "Open connectors",
          group: "pod",
          icon: <Plug className="h-3.5 w-3.5" />,
          run: () => setTab("connectors"),
          keywords: ["telegram", "discord", "slack", "whatsapp"],
        },
        {
          id: "pod-settings",
          label: "Open settings",
          group: "pod",
          icon: <Settings className="h-3.5 w-3.5" />,
          run: () => setTab("settings"),
          keywords: ["model", "provider"],
        },
      );
    }
    base.push(
      {
        id: "support-discord",
        label: "Join Discord support",
        group: "docs",
        icon: <MessageCircle className="h-3.5 w-3.5" />,
        run: () => window.open(DISCORD_INVITE_URL, "_blank"),
        keywords: ["discord", "support", "community", "help"],
      },
      {
        id: "docs-hermes",
        label: "Open Hermes Agent docs",
        group: "docs",
        icon: <BookOpen className="h-3.5 w-3.5" />,
        run: () => window.open("https://hermes-agent.nousresearch.com/docs/", "_blank"),
      },
      {
        id: "docs-providers",
        label: "Browse LLM providers",
        group: "docs",
        icon: <ExternalLink className="h-3.5 w-3.5" />,
        run: () => window.open("https://openrouter.ai/models", "_blank"),
      },
      {
        id: "account-signout",
        label: "Sign out",
        group: "account",
        icon: <LogOut className="h-3.5 w-3.5" />,
        run: async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.assign("/login");
        },
      },
    );
    return base;
  }, [podIdentifier, router, setTab]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/80 px-4 pt-[12vh] backdrop-blur-sm">
      <button
        aria-label="close"
        onClick={close}
        className="absolute inset-0 cursor-default"
        tabIndex={-1}
      />
      <Command
        label="Command palette"
        className="pods-fade-in relative z-10 w-full max-w-[560px] overflow-hidden border border-hairline bg-neutral-900 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-2 border-b border-hairline px-4">
          <Search className="h-3.5 w-3.5 text-neutral-500" strokeWidth={2} />
          <Command.Input
            placeholder="type a command or search…"
            autoFocus
            className="flex-1 bg-transparent py-3.5 text-[13px] text-foreground placeholder:text-neutral-500 focus:outline-none"
          />
          <KeyCap>esc</KeyCap>
        </div>
        <Command.List className="max-h-[420px] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center">
            <span className="micro text-neutral-500">no matches</span>
          </Command.Empty>
          {(["navigation", "pod", "connectors", "docs", "account"] as const).map((g) => {
            const items = actions.filter((a) => a.group === g);
            if (items.length === 0) return null;
            return (
              <Command.Group
                key={g}
                heading={
                  <span className="micro block px-2 pb-1.5 pt-2 text-neutral-500">
                    {labelForGroup(g)}
                  </span>
                }
              >
                {items.map((a) => (
                  <Command.Item
                    key={a.id}
                    value={`${a.label} ${(a.keywords ?? []).join(" ")}`}
                    onSelect={() => {
                      a.run();
                      close();
                    }}
                    className="group flex cursor-pointer items-center gap-2.5 px-2.5 py-2 text-[13px] text-neutral-300 data-[selected=true]:bg-neutral-800 data-[selected=true]:text-foreground"
                  >
                    <span className="text-neutral-500 group-data-[selected=true]:text-signal">
                      {a.icon}
                    </span>
                    <span>{a.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
        <div className="flex items-center justify-between border-t border-hairline px-3 py-2">
          <span className="flex items-center gap-1.5 micro text-neutral-500">
            <KeyCap>↵</KeyCap> select
          </span>
          <span className="flex items-center gap-1.5 micro text-neutral-500">
            <KeyCap>↑</KeyCap>
            <KeyCap>↓</KeyCap> navigate
          </span>
        </div>
      </Command>
    </div>
  );
}

function labelForGroup(g: Action["group"]): string {
  return {
    navigation: "Navigation",
    pod: "Pod",
    connectors: "Connectors",
    docs: "Docs",
    account: "Account",
  }[g];
}
