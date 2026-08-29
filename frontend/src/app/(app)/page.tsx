import Link from "next/link";
import { LandingPage } from "@/components/landing/landing-page";
import {
  ArrowRight,
  Boxes,
  Clock,
  CreditCard,
  Cpu,
  Globe2,
  HardDrive,
  MemoryStick,
  Plus,
} from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";
import { listMyPods } from "@/lib/pods";
import { EmptyState } from "@/components/ui/empty";
import { BrandIcon, providerBrand } from "@/components/brand-icon";
import HomeNewPodTrigger from "./_components/HomeNewPodTrigger";
import DashboardGreeting from "./_components/DashboardGreeting";
import { SubscriptionGateNotice } from "@/components/billing/subscription-gate-notice";
import AutoOpenWizardFromQuery from "./_components/AutoOpenWizardFromQuery";
import DomainPill from "./_components/DomainPill";
import type { PodDomainRow } from "@/lib/db";
import { fullDomain } from "@/lib/domains";

export default async function OverviewPage() {
  // Visitor (no session) → marketing landing in the same URL.
  // Logged-in user → the existing dashboard.
  const user = await getCurrentUser();
  if (!user) {
    return <LandingPage />;
  }
  const { default: db } = await import("@/lib/db");
  const pods = await listMyPods(user.pelicanUserId);
  const running = pods.filter((p) => p.installed && (!p.status || p.status === "running"));
  const installing = pods.filter((p) => !p.installed);

  const myDomains = db
    .prepare<[number], PodDomainRow>(
      "SELECT * FROM pod_domains WHERE user_id = ? ORDER BY (kind = 'auto') DESC, created_at ASC",
    )
    .all(user.id);
  const primaryDomainByPod = new Map<string, PodDomainRow>();
  for (const d of myDomains) {
    if (!primaryDomainByPod.has(d.pod_uuid_short))
      primaryDomainByPod.set(d.pod_uuid_short, d);
  }

  const totalMem = pods.reduce((s, p) => s + p.memory, 0);
  const totalCpu = pods.reduce((s, p) => s + p.cpu, 0);
  const totalDisk = pods.reduce((s, p) => s + p.disk, 0);

  const recent = [...pods]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 5);
  const activity = getOverviewActivity(
    user.id,
    pods.map((p) => ({ identifier: p.identifier, createdAt: p.createdAt })),
    db,
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <AutoOpenWizardFromQuery />
      {/* Editorial masthead */}
      <header className="border-b border-hairline pb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="micro text-neutral-500">Overview · Welcome back</span>
            <DashboardGreeting />
            <p className="mt-3 text-[13px] text-neutral-400">
              {pods.length === 0
                ? "No pods yet. Deploy your first sandbox in 30 seconds."
                : `${pods.length} ${pods.length === 1 ? "pod" : "pods"} provisioned · ${running.length} live`}
            </p>
            <div className="mt-4">
              <SubscriptionGateNotice variant="pill" />
            </div>
          </div>
          <HomeNewPodTrigger />
        </div>
      </header>

      {/* KPI strip — 4-column editorial table */}
      <section className="grid grid-cols-2 border-b border-hairline md:grid-cols-4">
        <Kpi
          index="01"
          label="Pods"
          value={pods.length.toString().padStart(2, "0")}
          sub={
            <>
              <Dot tone={running.length ? "live" : "muted"} />
              {running.length} live
              {installing.length > 0 && (
                <>
                  <span className="mx-1 text-neutral-600">·</span>
                  <Dot tone="deploying" />
                  {installing.length} deploying
                </>
              )}
            </>
          }
          icon={<Boxes className="h-3 w-3" />}
        />
        <Kpi
          index="02"
          label="Memory"
          value={`${(totalMem / 1024).toFixed(1)}`}
          unit="GB"
          sub={<span className="text-neutral-500">across {pods.length} {pods.length === 1 ? "pod" : "pods"}</span>}
          icon={<MemoryStick className="h-3 w-3" />}
        />
        <Kpi
          index="03"
          label="CPU"
          value={`${(totalCpu / 100).toFixed(2)}`}
          unit="vCPU"
          sub={<span className="text-neutral-500">burstable</span>}
          icon={<Cpu className="h-3 w-3" />}
        />
        <Kpi
          index="04"
          label="Disk"
          value={`${(totalDisk / 1024).toFixed(0)}`}
          unit="GB"
          sub={<span className="text-neutral-500">persistent SSD</span>}
          icon={<HardDrive className="h-3 w-3" />}
        />
      </section>

      <section className="grid gap-10 border-b border-hairline py-8 md:grid-cols-3">
        <RecentPodsPanel
          recent={recent}
          primaryDomainByPod={primaryDomainByPod}
        />
        <QuickActionsPanel />
      </section>

      <section className="grid gap-10 py-10 md:grid-cols-3">
        <ActivityTracker activity={activity} />
        <SystemPanel />
      </section>
    </div>
  );
}

type OverviewPod = Awaited<ReturnType<typeof listMyPods>>[number];

function RecentPodsPanel({
  recent,
  primaryDomainByPod,
}: {
  recent: OverviewPod[];
  primaryDomainByPod: Map<string, PodDomainRow>;
}) {
  return (
    <div className="space-y-5 md:col-span-2">
      <SectionHeader
        index="A"
        title="Recent pods"
        action={
          <Link
            href="/pods"
            className="micro inline-flex items-center gap-1 text-neutral-400 hover:text-foreground"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        }
      />
      {recent.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-6 w-6" />}
          title="No pods yet"
          description="Spin up a Hermes Agent sandbox in 30 seconds."
          action={<HomeNewPodTrigger />}
        />
      ) : (
        <ul className="divide-y divide-hairline border border-hairline bg-neutral-900">
          {recent.map((p, i) => {
            const dom = primaryDomainByPod.get(p.identifier);
            return (
              <li key={p.id}>
                <div className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-neutral-800/60">
                  <span className="w-6 shrink-0 font-mono text-[11px] tabular text-neutral-500">
                    {(i + 1).toString().padStart(2, "0")}
                  </span>
                  <Link
                    href={`/pods/${p.identifier}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <OverviewPodIcon podTypeSlug={p.podTypeSlug} provider={p.provider} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-foreground">
                        {p.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-neutral-500">
                        <span>{p.identifier}</span>
                        <span className="text-neutral-700">/</span>
                        <span className="truncate">{p.model}</span>
                      </div>
                    </div>
                  </Link>
                  <div className="flex flex-none items-center gap-2">
                    {dom && (
                      <DomainPill
                        host={fullDomain(dom.slug)}
                        url={`https://${fullDomain(dom.slug)}`}
                      />
                    )}
                    <PodStatusTag installed={p.installed} status={p.status} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OverviewPodIcon({
  podTypeSlug,
  provider,
}: {
  podTypeSlug: string;
  provider: string;
}) {
  if (podTypeSlug === "n8n") {
    return (
      <img
        src="/N8n--Streamline-Simple-Icons.svg"
        alt=""
        aria-hidden
        className="h-[18px] w-[18px] flex-none"
      />
    );
  }
  return <BrandIcon slug={providerBrand(provider)} size={18} />;
}

function QuickActionsPanel() {
  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <SectionHeader index="D" title="Quick actions" />
        <div className="space-y-px border border-hairline bg-neutral-900">
          <QuickAction
            icon={<Plus className="h-3.5 w-3.5" />}
            label="Deploy a new pod"
            hint="N"
            triggerNewPod
          />
          <QuickAction
            icon={<Boxes className="h-3.5 w-3.5" />}
            label="View all pods"
            hint="Pods"
            href="/pods"
          />
          <QuickAction
            icon={<Globe2 className="h-3.5 w-3.5" />}
            label="Manage domains"
            hint="Domains"
            href="/domains"
          />
          <QuickAction
            icon={<CreditCard className="h-3.5 w-3.5" />}
            label="Billing & plans"
            hint="Billing"
            href="/billing"
          />
        </div>
      </div>
    </div>
  );
}

type ActivityDay = {
  date: Date;
  iso: string;
  count: number;
  future: boolean;
};

type OverviewActivity = {
  weeks: ActivityDay[][];
  monthLabels: Array<{ week: number; label: string }>;
  weekdayLabels: string[];
  totalEvents: number;
  activeDays: number;
};

type DailyCountRow = {
  day: string;
  count: number;
};

const ACTIVITY_WEEKS = 53;
const ACTIVITY_DAYS = ACTIVITY_WEEKS * 7;
const MS_PER_DAY = 86_400_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getOverviewActivity(
  userId: number,
  pods: Array<{ identifier: string; createdAt: string }>,
  db: (typeof import("@/lib/db"))["default"],
): OverviewActivity {
  const today = startOfUtcDay(new Date());
  const gridStart = addDays(today, -(ACTIVITY_DAYS - 1));
  const startUnix = Math.floor(gridStart.getTime() / 1000);

  const counts = new Map<string, number>();
  const podIdentifiers = pods.map((pod) => pod.identifier);
  const addRows = (rows: DailyCountRow[]) => {
    for (const row of rows) {
      counts.set(row.day, (counts.get(row.day) ?? 0) + row.count);
    }
  };

  for (const pod of pods) {
    const created = new Date(pod.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const createdDay = startOfUtcDay(created);
    if (createdDay.getTime() < gridStart.getTime()) continue;
    if (createdDay.getTime() > today.getTime()) continue;
    const day = isoDate(createdDay);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  addRows(
    db
      .prepare<[number, number], DailyCountRow>(
        `SELECT date(ts, 'unixepoch') AS day, COUNT(*) AS count
           FROM credit_ledger
          WHERE user_id = ?
            AND ts >= ?
            AND reason IN ('pod_hour', 'storage', 'egress')
          GROUP BY day`,
      )
      .all(userId, startUnix),
  );

  addRows(
    db
      .prepare<[number, number], DailyCountRow>(
        `SELECT date(created_at) AS day, COUNT(*) AS count
           FROM credit_transactions
          WHERE user_id = ?
            AND created_at >= datetime(?, 'unixepoch')
            AND type = 'managed_ai_usage'
          GROUP BY day`,
      )
      .all(userId, startUnix),
  );

  if (podIdentifiers.length > 0) {
    const placeholders = podIdentifiers.map(() => "?").join(",");
    addRows(
      db
        .prepare(
          `SELECT date(created_at) AS day, COUNT(*) AS count
             FROM pod_emails
            WHERE pod_uuid_short IN (${placeholders})
              AND created_at >= datetime(?, 'unixepoch')
            GROUP BY day`,
        )
        .all(...podIdentifiers, startUnix) as DailyCountRow[],
    );
  }

  const days = Array.from({ length: ACTIVITY_DAYS }, (_, index) => {
    const date = addDays(gridStart, index);
    const iso = isoDate(date);
    return {
      date,
      iso,
      count: counts.get(iso) ?? 0,
      future: false,
    };
  });

  const weeks = Array.from({ length: ACTIVITY_WEEKS }, (_, index) =>
    days.slice(index * 7, index * 7 + 7),
  );
  const monthLabels: OverviewActivity["monthLabels"] = [];
  weeks.forEach((week, weekIndex) => {
    const firstOfMonth = week.find((day) => day.date.getUTCDate() === 1);
    if (firstOfMonth) {
      monthLabels.push({
        week: weekIndex,
        label: MONTHS[firstOfMonth.date.getUTCMonth()],
      });
    }
  });

  const visibleDays = days.filter((day) => !day.future);
  return {
    weeks,
    monthLabels,
    weekdayLabels: Array.from(
      { length: 7 },
      (_, index) => WEEKDAYS[addDays(gridStart, index).getUTCDay()],
    ),
    totalEvents: visibleDays.reduce((sum, day) => sum + day.count, 0),
    activeDays: visibleDays.filter((day) => day.count > 0).length,
  };
}

function ActivityTracker({ activity }: { activity: OverviewActivity }) {
  return (
    <div className="md:col-span-2">
      <SectionHeader
        index="C"
        title="Daily activity"
        action={
          <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
            {activity.activeDays} active days · {activity.totalEvents} pod events
          </span>
        }
      />
      <div className="mt-7 overflow-hidden pb-1">
        <div className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-x-2">
          <div />
          <div
            className="grid gap-x-0.5"
            style={{
              gridTemplateColumns: `repeat(${ACTIVITY_WEEKS}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: ACTIVITY_WEEKS }, (_, week) => {
              const label = activity.monthLabels.find((m) => m.week === week);
              return (
                <span
                  key={week}
                  className="h-4 font-mono text-[10px] text-neutral-600"
                >
                  {label?.label ?? ""}
                </span>
              );
            })}
          </div>
          <div className="mt-2 grid grid-rows-7 gap-0.5">
            {activity.weekdayLabels.map((day) => (
              <span
                key={day}
                className="flex items-center justify-end font-mono text-[9px] text-neutral-600"
              >
                {day}
              </span>
            ))}
          </div>
          <div
            className="mt-2 grid grid-flow-col grid-rows-7 gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${ACTIVITY_WEEKS}, minmax(0, 1fr))`,
            }}
          >
            {activity.weeks.flatMap((week) =>
              week.map((day) => (
                <span
                  key={day.iso}
                  title={day.future ? undefined : activityTitle(day)}
                  aria-label={day.future ? undefined : activityTitle(day)}
                  aria-hidden={day.future ? true : undefined}
                  className={`aspect-square w-full border ${activityCellClass(day)}`}
                />
              )),
            )}
          </div>
          <div className="col-start-2 mt-3 flex items-center justify-end gap-1.5 font-mono text-[9px] uppercase tracking-wider text-neutral-600">
            <span>Less</span>
            {[0, 1, 3, 6, 11].map((count) => (
              <span
                key={count}
                className={`h-2 w-2 border ${activityCellClass({
                  count,
                  future: false,
                })}`}
              />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SystemPanel() {
  return (
    <div className="space-y-5">
      <SectionHeader index="B" title="System" />
      <div className="border border-hairline bg-neutral-900 p-4">
        <div className="flex items-center gap-2 text-[13px] text-foreground">
          <Dot tone="live" />
          All systems normal
        </div>
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-neutral-500">
          <Clock className="h-3 w-3" />
          checked just now
        </div>
      </div>
    </div>
  );
}

function activityCellClass(day: { count: number; future: boolean }) {
  if (day.future) return "border-transparent bg-transparent opacity-0";
  if (day.count <= 0) return "border-neutral-800 bg-neutral-900";
  if (day.count <= 2) return "border-signal/25 bg-signal/20";
  if (day.count <= 5) return "border-signal/40 bg-signal/40";
  if (day.count <= 10) return "border-signal/60 bg-signal/70";
  return "border-signal bg-signal";
}

function activityTitle(day: ActivityDay) {
  if (day.future) return `${formatActivityDate(day.date)}: future date.`;
  return `${formatActivityDate(day.date)}: ${day.count} pod ${
    day.count === 1 ? "event" : "events"
  }.`;
}

function formatActivityDate(date: Date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function Kpi({
  index,
  label,
  value,
  unit,
  sub,
  icon,
}: {
  index: string;
  label: string;
  value: string;
  unit?: string;
  sub?: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="border-r border-hairline px-5 py-6 last:border-r-0">
      <div className="flex items-center justify-between">
        <div className="micro flex items-center gap-1.5 text-neutral-500">
          {icon}
          {label}
        </div>
        <span className="font-mono text-[10px] tabular text-neutral-700">{index}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-mono text-[28px] font-medium leading-none tabular text-foreground">
          {value}
        </span>
        {unit && (
          <span className="font-mono text-[12px] text-neutral-500">{unit}</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-neutral-400">
        {sub}
      </div>
    </div>
  );
}

function SectionHeader({
  index,
  title,
  action,
}: {
  index?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-hairline pb-3">
      <h2 className="micro flex items-center gap-3 text-neutral-400">
        {index && <span className="font-mono text-neutral-600">{index}</span>}
        <span>{title}</span>
      </h2>
      {action}
    </div>
  );
}

function Dot({ tone }: { tone: "live" | "deploying" | "muted" }) {
  const cls =
    tone === "live"
      ? "bg-live"
      : tone === "deploying"
        ? "bg-deploying animate-pulse"
        : "bg-neutral-600";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`} />;
}

function PodStatusTag({
  installed,
  status,
}: {
  installed: boolean;
  status: string | null;
}) {
  if (!installed) {
    return (
      <span className="inline-flex items-center gap-1.5 border border-deploying/30 bg-deploying/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-deploying">
        <Dot tone="deploying" />
        deploying
      </span>
    );
  }
  if (status && status !== "running") {
    return (
      <span className="inline-flex items-center gap-1.5 border border-hairline bg-neutral-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
        <Dot tone="muted" />
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 border border-live/30 bg-live/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-live">
      <Dot tone="live" />
      live
    </span>
  );
}

function QuickAction({
  icon,
  label,
  hint,
  href,
  external,
  triggerNewPod,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  href?: string;
  external?: boolean;
  triggerNewPod?: boolean;
}) {
  const inner = (
    <div className="group flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-neutral-800/60">
      <div className="flex items-center gap-3">
        <span className="text-neutral-500 group-hover:text-signal">{icon}</span>
        <span className="text-[13px] text-foreground">{label}</span>
      </div>
      {hint && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-600">
          {hint}
        </span>
      )}
    </div>
  );
  if (triggerNewPod) {
    return <HomeNewPodTrigger asChild>{inner}</HomeNewPodTrigger>;
  }
  if (!href) return inner;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className="block">
      {inner}
    </Link>
  );
}
