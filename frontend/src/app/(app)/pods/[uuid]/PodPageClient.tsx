"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Terminal,
  Plug,
  Globe,
  Settings as SettingsIcon,
  Sparkles,
  Boxes,
  Gamepad2,
  FolderTree,
  Mail,
  UserCog,
  Activity,
} from "lucide-react";
import PodConsole from "./PodConsole";
import DashboardTab from "./DashboardTab";
import ConnectorsTab from "./ConnectorsTab";
import ProvidersTab from "./ProvidersTab";
import DomainsTab from "./DomainsTab";
import McpTab from "./McpTab";
import MinecraftTab from "./MinecraftTab";
import FilesTab from "./FilesTab";
import EmailTab from "./EmailTab";
import PersonaTab from "./PersonaTab";
import SkillsTab from "./SkillsTab";
import ProcessesTab from "./ProcessesTab";
import { Tabs } from "@/components/ui/tabs";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { POD_TYPE_BY_SLUG } from "@/lib/pod-types";

type TabId =
  | "dashboard"
  | "console"
  | "processes"
  | "connectors"
  | "providers"
  | "mcp"
  | "skills"
  | "email"
  | "persona"
  | "manage"
  | "files"
  | "domains"
  | "settings";

const VALID_TABS: TabId[] = [
  "dashboard",
  "console",
  "processes",
  "connectors",
  "providers",
  "mcp",
  "skills",
  "email",
  "persona",
  "manage",
  "files",
  "domains",
  "settings",
];

function isValidTab(v: string | null): v is TabId {
  return v !== null && (VALID_TABS as readonly string[]).includes(v);
}
export default function PodPageClient({
  identifier,
  initiallyInstalled,
  podName,
  podTypeSlug,
  meta,
}: {
  identifier: string;
  initiallyInstalled: boolean;
  podName: string;
  podTypeSlug: string;
  meta: {
    provider: string;
    model: string;
    memory: number;
    cpu: number;
    disk: number;
  };
}) {
  const podType = POD_TYPE_BY_SLUG[podTypeSlug] ?? POD_TYPE_BY_SLUG.hermes;
  // Tab state is mirrored to the URL (`?tab=…`) so reload + browser
  // back/forward + shareable links all do the right thing. On mount we
  // read the URL; on change we replace the URL without scrolling.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab");
  const [tab, setTabState] = useState<TabId>(
    isValidTab(urlTab) ? urlTab : "dashboard",
  );
  // Keep state in sync if the URL changes externally (e.g. browser back).
  useEffect(() => {
    if (isValidTab(urlTab) && urlTab !== tab) setTabState(urlTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);
  const setTab = useCallback(
    (next: TabId) => {
      setTabState(next);
      const params = new URLSearchParams(searchParams.toString());
      // Dashboard is the default landing — keep the URL clean (no qs)
      // when it's selected so /pods/<id> shares cleanly. Every other tab
      // appends ?tab=…
      if (next === "dashboard") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );
  const [installed, setInstalled] = useState(initiallyInstalled);
  const [connectedCount, setConnectedCount] = useState(0);
  const palette = useCommandPalette();

  useEffect(() => {
    if (installed) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/pods/${identifier}/status`, {
          cache: "no-store",
        });
        const d = (await r.json()) as { installed?: boolean };
        if (d.installed) {
          setInstalled(true);
          // RSC header badge ("installing"/"running") is rendered in
          // page.tsx from the server-fetched container.installed bit.
          // Tell Next to re-run that RSC fetch so the badge flips too —
          // otherwise the user stays stuck at "installing" in the page
          // header even though the body has unlocked.
          router.refresh();
        }
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [identifier, installed, router]);

  // Tabs that are universal to every pod type plus the ones that only
  // make sense for AI-agent-shaped pods (connectors + providers).
  const tabs = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <LayoutDashboard className="h-3.5 w-3.5" />,
    },
    {
      id: "console",
      label: "Console",
      icon: <Terminal className="h-3.5 w-3.5" />,
    },
    {
      id: "processes",
      label: "Processes",
      icon: <Activity className="h-3.5 w-3.5" />,
    },
    ...(podType.showConnectors
      ? [
          {
            id: "connectors",
            label: "Connectors",
            icon: <Plug className="h-3.5 w-3.5" />,
              badge:
              connectedCount > 0 ? (
                <span className="border border-hairline bg-neutral-950 px-1.5 font-mono text-[10px] tabular text-neutral-300">
                  {connectedCount}
                </span>
              ) : undefined,
          },
        ]
      : []),
    ...(podType.showProviders
      ? [
          {
            id: "providers",
            label: "Providers",
            icon: <Sparkles className="h-3.5 w-3.5" />,
          },
        ]
      : []),
    ...(podType.slug === "hermes"
      ? [
          {
            id: "persona",
            label: "Persona",
            icon: <UserCog className="h-3.5 w-3.5" />,
          },
          {
            id: "mcp",
            label: "MCP",
            icon: <Boxes className="h-3.5 w-3.5" />,
          },
          {
            id: "skills",
            label: "Skills",
            icon: <Sparkles className="h-3.5 w-3.5" />,
          },
          {
            id: "email",
            label: "Email",
            icon: <Mail className="h-3.5 w-3.5" />,
          },
        ]
      : []),
    ...(podType.slug === "minecraft-paper"
      ? [
          {
            id: "manage",
            label: "Manage",
            icon: <Gamepad2 className="h-3.5 w-3.5" />,
          },
        ]
      : []),
    {
      id: "files",
      label: "Files",
      icon: <FolderTree className="h-3.5 w-3.5" />,
    },
    {
      id: "domains",
      label: "Domains",
      icon: <Globe className="h-3.5 w-3.5" />,
    },
    {
      id: "settings",
      label: "Settings",
      icon: <SettingsIcon className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div>
      <Tabs
        tabs={tabs}
        current={tab}
        onChange={(id) => setTab(id as TabId)}
      />
      <div className="pt-6">
        {tab === "dashboard" && (
          <DashboardTab
            identifier={identifier}
            installed={installed}
            podTypeSlug={podType.slug}
          />
        )}

        {tab === "console" && (
          <div className="space-y-3">
            <ConsoleHint podTypeSlug={podType.slug} />
            <PodConsole identifier={identifier} initiallyInstalled={installed} />
          </div>
        )}

        {tab === "processes" && (
          <ProcessesTab identifier={identifier} installed={installed} />
        )}

        {tab === "connectors" && (
          <ConnectorsTab
            identifier={identifier}
            installed={installed}
            onSwitchToConsole={() => setTab("console")}
            onConfiguredCountChange={setConnectedCount}
          />
        )}

        {tab === "providers" && (
          <ProvidersTab
            identifier={identifier}
            installed={installed}
            currentProvider={meta.provider}
            currentModel={meta.model}
          />
        )}

        {tab === "mcp" && podType.slug === "hermes" && (
          <McpTab identifier={identifier} installed={installed} />
        )}

        {podType.slug === "hermes" && (
          <div hidden={tab !== "skills"}>
            <SkillsTab
              key={identifier}
              identifier={identifier}
              installed={installed}
              active={tab === "skills"}
            />
          </div>
        )}

        {tab === "email" && podType.slug === "hermes" && (
          <EmailTab identifier={identifier} installed={installed} />
        )}

        {tab === "persona" && podType.slug === "hermes" && (
          <PersonaTab identifier={identifier} installed={installed} />
        )}

        {tab === "manage" && podType.slug === "minecraft-paper" && (
          <MinecraftTab identifier={identifier} installed={installed} />
        )}

        {tab === "files" && (
          <FilesTab identifier={identifier} installed={installed} />
        )}

        {tab === "domains" && (
          <DomainsTab identifier={identifier} installed={installed} />
        )}

        {tab === "settings" && (
          <div className="space-y-8">
            <div className="grid gap-px border border-hairline bg-hairline md:grid-cols-2">
              <SettingCard label="Pod name" value={podName} />
              <SettingCard label="Identifier" value={identifier} mono />
              <SettingCard label="LLM provider" value={meta.provider} mono />
              <SettingCard label="Model" value={meta.model} mono />
            </div>

            <div className="border border-hairline bg-neutral-900 p-5 text-[12px] text-neutral-400">
              Configure the main LLM, voice, image, web search, browser, and
              memory providers from the{" "}
              <strong className="text-foreground">Providers</strong> tab.
            </div>

            <div className="border border-error/30 bg-error/5 p-5">
              <div className="micro flex items-center gap-3 text-error">
                <span className="font-mono text-neutral-600">!</span>
                Danger zone
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
                Start, stop, restart, and delete live in the{" "}
                <strong className="text-foreground">Actions</strong> dropdown
                next to the status badge at the top of this page. Delete is
                permanent — wipes the container plus the persistent volume.
              </p>
            </div>
          </div>
        )}
      </div>

      <CommandPalette
        open={palette.open}
        onOpenChange={palette.setOpen}
        podIdentifier={identifier}
        setTab={(id) => setTab(id as TabId)}
      />
    </div>
  );
}

function SettingCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-neutral-900 p-4">
      <div className="micro text-neutral-500">{label}</div>
      <div
        className={`mt-2 text-[13px] text-foreground ${
          mono ? "font-mono tabular" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ConsoleHint({ podTypeSlug }: { podTypeSlug: string }) {
  const text =
    podTypeSlug === "hermes" ? (
      <>
        Full Ubuntu 24.04 sandbox with passwordless sudo. Try{" "}
        <code className="border border-hairline bg-neutral-950 px-1.5 py-0.5 font-mono text-[11px] text-foreground">hermes</code>, or{" "}
        <code className="border border-hairline bg-neutral-950 px-1.5 py-0.5 font-mono text-[11px] text-foreground">sudo apt install …</code> anything.
      </>
    ) : podTypeSlug === "code-sandbox" ? (
      <>
        Ubuntu with sudo. Run{" "}
        <code className="border border-hairline bg-neutral-950 px-1.5 py-0.5 font-mono text-[11px] text-foreground">claude</code> for Claude Code, or open the IDE at the pod's public URL for the code-server flavor.
      </>
    ) : podTypeSlug === "n8n" ? (
      <>
        Underlying container shell. n8n runs as PID 1 — restart from the pod actions, not from here. Useful for inspecting{" "}
        <code className="border border-hairline bg-neutral-950 px-1.5 py-0.5 font-mono text-[11px] text-foreground">~/.n8n</code>.
      </>
    ) : podTypeSlug === "minecraft-paper" ? (
      <>
        Paper server console. Type{" "}
        <code className="border border-hairline bg-neutral-950 px-1.5 py-0.5 font-mono text-[11px] text-foreground">op &lt;player&gt;</code>,{" "}
        <code className="border border-hairline bg-neutral-950 px-1.5 py-0.5 font-mono text-[11px] text-foreground">whitelist add &lt;player&gt;</code>, or any Bukkit command.
      </>
    ) : (
      <>Pod console.</>
    );
  return <p className="text-[12px] leading-relaxed text-neutral-400">{text}</p>;
}
