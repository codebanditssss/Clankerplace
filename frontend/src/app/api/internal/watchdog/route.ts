import { NextResponse, type NextRequest } from "next/server";
import db from "@/lib/db";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { execInPod } from "@/lib/node-exec";
import { sendEmail } from "@/lib/resend";
import {
  hotThresholdPercent,
  nextWatchdogAction,
  probeIsPinned,
  watchdogConfigFromEnv,
  type WatchdogState,
} from "@/lib/watchdog";

export const runtime = "nodejs";

/**
 * Internal-only CPU-pin watchdog, hit by server.mjs every 15 minutes.
 *
 * For every non-suspended pod, probe the last N minutes of pod_metrics
 * (written by server.mjs's background sampler). Pods pinned at ~their CPU
 * cap for the whole probe get tracked in pod_watchdog_state; after
 * warnHours of continuous pin the owner is emailed, after suspendHours
 * the pod is suspended via Pelican. One cool probe resets everything —
 * see lib/watchdog.ts for the reasoning.
 *
 * Protected by INTERNAL_METER_TOKEN, same as the meter/reconcile routes.
 */

const FROM_EMAIL =
  process.env.AUTH_FROM_EMAIL ?? "clankerplace <onboarding@resend.dev>";

let running = false;

type ServerListPage = {
  data: Array<{ attributes: ServerAttributes }>;
  meta?: { pagination?: { total_pages?: number } };
};

async function listAllServers(): Promise<ServerAttributes[]> {
  const out: ServerAttributes[] = [];
  let page = 1;
  for (;;) {
    const resp = await applicationApi<ServerListPage>(
      `/servers?per_page=100&page=${page}`,
    );
    out.push(...resp.data.map((s) => s.attributes));
    const totalPages = resp.meta?.pagination?.total_pages ?? 1;
    if (page >= totalPages) break;
    page += 1;
  }
  return out;
}

function ownerEmail(pelicanUserId: number): string | null {
  const row = db
    .prepare("SELECT email FROM users WHERE pelican_user_id = ?")
    .get(pelicanUserId) as { email: string } | undefined;
  return row?.email ?? null;
}

function adminEmail(): string | null {
  return (
    process.env.PODS_WATCHDOG_ADMIN_EMAIL ||
    process.env.BOOTSTRAP_ADMIN_EMAIL ||
    null
  );
}

/** Best-effort `ps aux` inside the pod so emails show the culprit. */
async function topProcesses(fullUuid: string): Promise<string> {
  try {
    const { stdout } = await execInPod(
      fullUuid,
      ["exec", fullUuid, "ps", "aux", "--sort=-pcpu"],
      { timeoutMs: 8000 },
    );
    return stdout.split("\n").slice(0, 8).join("\n").trim();
  } catch {
    return "(process list unavailable)";
  }
}

async function notify(opts: {
  kind: "warning" | "suspended";
  srv: ServerAttributes;
  pinnedHours: number;
  thresholdPct: number;
  processes: string;
  cfg: { suspendHours: number };
}) {
  const { kind, srv, pinnedHours, thresholdPct, processes, cfg } = opts;
  const podUrl = `${process.env.FUELBORN_PUBLIC_URL ?? process.env.PODS_PUBLIC_URL ?? "http://localhost:3000"}/pods/${srv.identifier}`;
  const subject =
    kind === "warning"
      ? `[clankerplace] Your pod "${srv.name}" looks stuck at 100% CPU`
      : `[clankerplace] Your pod "${srv.name}" was suspended (CPU pinned ${Math.round(pinnedHours)}h)`;
  const body =
    kind === "warning"
      ? `Your pod "${srv.name}" (${srv.identifier}) has been running at or above ` +
        `${Math.round(thresholdPct)}% CPU continuously for about ${Math.round(pinnedHours)} hours.\n\n` +
        `That usually means a runaway process (an infinite loop that never sleeps), ` +
        `not real work. Top processes right now:\n\n${processes}\n\n` +
        `If this is intentional heavy computation you can ignore this email — but if the pod ` +
        `stays pinned for ${cfg.suspendHours} hours total it will be automatically suspended.\n\n` +
        `To fix it: open the Console tab and kill the runaway process:\n${podUrl}\n`
      : `Your pod "${srv.name}" (${srv.identifier}) was automatically suspended after running ` +
        `at or above ${Math.round(thresholdPct)}% CPU continuously for ${Math.round(pinnedHours)} hours ` +
        `despite an earlier warning email.\n\n` +
        `Last observed processes:\n\n${processes}\n\n` +
        `Reply to this email or reach us on Discord to get it unsuspended.\n`;

  const recipients = new Set<string>();
  const owner = ownerEmail(srv.user);
  if (owner) recipients.add(owner);
  const admin = adminEmail();
  if (admin) recipients.add(admin);
  for (const to of recipients) {
    try {
      await sendEmail({ to, from: FROM_EMAIL, subject, text: body });
    } catch (err) {
      console.warn(
        `[watchdog] email to ${to} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-internal-token");
  const expected =
    process.env.INTERNAL_METER_TOKEN ?? process.env.INTERNAL_RECONCILE_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "watchdog_not_configured" },
      { status: 503 },
    );
  }
  if (!token || token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (running) {
    return NextResponse.json({ skipped: true, reason: "already_running" });
  }
  running = true;
  try {
    const cfg = watchdogConfigFromEnv();
    if (!cfg.enabled) {
      return NextResponse.json({ ok: true, skipped: true, reason: "disabled" });
    }

    const now = Date.now();
    const probeStart = now - cfg.probeMinutes * 60_000;
    const expectedCount = Math.floor(
      (cfg.probeMinutes * 60) / cfg.sampleSeconds,
    );

    const probeStmt = db.prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN cpu >= ? THEN 1 ELSE 0 END) AS hot,
              MAX(cpu) AS max_cpu
         FROM pod_metrics
        WHERE uuid_short = ? AND ts >= ?`,
    );
    const stateStmt = db.prepare(
      "SELECT state, pinned_since, warned_at FROM pod_watchdog_state WHERE pod_uuid_short = ?",
    );
    const upsertStmt = db.prepare(
      `INSERT INTO pod_watchdog_state
         (pod_uuid_short, state, pinned_since, warned_at, last_cpu, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(pod_uuid_short) DO UPDATE SET
         state = excluded.state,
         pinned_since = excluded.pinned_since,
         warned_at = excluded.warned_at,
         last_cpu = excluded.last_cpu,
         updated_at = excluded.updated_at`,
    );
    const deleteStmt = db.prepare(
      "DELETE FROM pod_watchdog_state WHERE pod_uuid_short = ?",
    );

    const servers = await listAllServers();
    const liveIds = new Set(servers.map((s) => s.identifier));

    // Drop state for pods that no longer exist (deleted in the panel).
    const staleRows = db
      .prepare("SELECT pod_uuid_short FROM pod_watchdog_state")
      .all() as Array<{ pod_uuid_short: string }>;
    for (const r of staleRows) {
      if (!liveIds.has(r.pod_uuid_short)) deleteStmt.run(r.pod_uuid_short);
    }

    const summary = {
      checked: 0,
      pinned: 0,
      warned: [] as string[],
      suspended: [] as string[],
      reset: 0,
    };

    for (const srv of servers) {
      if (srv.suspended) continue;
      summary.checked += 1;

      const thresholdPct = hotThresholdPercent(srv.limits.cpu, cfg);
      const probeRow = probeStmt.get(
        thresholdPct,
        srv.identifier,
        probeStart,
      ) as { n: number; hot: number | null; max_cpu: number | null };
      const pinned = probeIsPinned(
        {
          sampleCount: probeRow.n,
          hotCount: probeRow.hot ?? 0,
          expectedCount,
        },
        cfg,
      );
      if (pinned) summary.pinned += 1;

      const prevRow = stateStmt.get(srv.identifier) as
        | { state: "ok" | "warned"; pinned_since: number; warned_at: number | null }
        | undefined;
      const prev: WatchdogState | null = prevRow
        ? {
            state: prevRow.state,
            pinnedSinceMs: prevRow.pinned_since,
            warnedAtMs: prevRow.warned_at,
          }
        : null;

      const { action, next } = nextWatchdogAction(prev, pinned, now, cfg);
      const pinnedHours = prev
        ? (now - prev.pinnedSinceMs) / 3_600_000
        : 0;

      switch (action) {
        case "none":
          break;
        case "reset":
          deleteStmt.run(srv.identifier);
          summary.reset += 1;
          break;
        case "track":
          if (next) {
            upsertStmt.run(
              srv.identifier,
              next.state,
              next.pinnedSinceMs,
              next.warnedAtMs,
              probeRow.max_cpu,
              now,
            );
          }
          break;
        case "warn": {
          if (next) {
            upsertStmt.run(
              srv.identifier,
              next.state,
              next.pinnedSinceMs,
              next.warnedAtMs,
              probeRow.max_cpu,
              now,
            );
          }
          const processes = await topProcesses(srv.uuid);
          console.warn(
            `[watchdog] WARN ${srv.identifier} ("${srv.name}") pinned ~${pinnedHours.toFixed(1)}h ` +
              `at >=${Math.round(thresholdPct)}% CPU (owner pelican_user=${srv.user})`,
          );
          await notify({
            kind: "warning",
            srv,
            pinnedHours,
            thresholdPct,
            processes,
            cfg,
          });
          summary.warned.push(srv.identifier);
          break;
        }
        case "suspend": {
          const processes = await topProcesses(srv.uuid);
          try {
            await applicationApi(`/servers/${srv.id}/suspend`, {
              method: "POST",
            });
          } catch (err) {
            console.error(
              `[watchdog] suspend of ${srv.identifier} FAILED: ${err instanceof Error ? err.message : err}`,
            );
            break; // keep state row; retry next tick
          }
          deleteStmt.run(srv.identifier);
          console.error(
            `[watchdog] SUSPENDED ${srv.identifier} ("${srv.name}") after ~${pinnedHours.toFixed(1)}h ` +
              `pinned at >=${Math.round(thresholdPct)}% CPU (owner pelican_user=${srv.user})`,
          );
          await notify({
            kind: "suspended",
            srv,
            pinnedHours,
            thresholdPct,
            processes,
            cfg,
          });
          summary.suspended.push(srv.identifier);
          break;
        }
      }
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[watchdog] tick failed:", msg);
    return NextResponse.json(
      { error: "tick_failed", message: msg },
      { status: 500 },
    );
  } finally {
    running = false;
  }
}
