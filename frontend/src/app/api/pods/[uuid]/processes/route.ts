// /api/pods/<uuid>/processes
//
// GET  — list every process inside the pod container with per-process
//        resource usage (CPU%, MEM%, RSS, uptime, state) plus the
//        container's pid-cgroup usage (current / max). Powers the
//        Processes tab.
// POST — send a signal to a single pid inside the container:
//        { pid: number, signal: "TERM"|"KILL"|"STOP"|"CONT"|"HUP"|"INT" }
//        TERM/KILL = kill, STOP = suspend, CONT = resume.
//
// Both run inside the container via the node-aware `execInPod` wrapper so
// they work for pods on any Wings node. We exec as root (`-u 0`) so the
// controls can act on every process — the pod owner already has
// passwordless sudo inside their own sandbox, so this grants nothing new.
import { NextRequest, NextResponse } from "next/server";
import { applicationApi, type ServerAttributes } from "@/lib/pelican";
import { getCurrentUser } from "@/lib/auth";
import { describePodExecError, execInPod } from "@/lib/node-exec";

async function getServer(uuid: string, pelicanUserId: number) {
  const data = await applicationApi<{
    data: Array<{ attributes: ServerAttributes }>;
  }>(`/servers?filter[uuid_short]=${encodeURIComponent(uuid)}`);
  const s = data.data?.[0]?.attributes;
  if (!s || s.user !== pelicanUserId) return null;
  return s;
}

export type PodProcess = {
  pid: number;
  ppid: number;
  state: string; // raw ps STAT (R/S/D/Z/T/I…) — first char is the primary state
  cpu: number; // %CPU (lifetime average, ps semantics)
  mem: number; // %MEM
  rssKb: number; // resident set size, KiB
  etimes: number; // elapsed seconds since start
  command: string; // full argv
};

// ps row: pid ppid stat pcpu pmem rss etimes <args…>
// args is last and may contain spaces, so capture greedily.
const PS_RE =
  /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(.*)$/;

// Read the pids cgroup (v2 path first, then v1) so the UI can show
// "N / limit" headroom, then dump the full process table.
const LIST_CMD =
  'C=$(cat /sys/fs/cgroup/pids.current 2>/dev/null || cat /sys/fs/cgroup/pids/pids.current 2>/dev/null || echo 0); ' +
  'M=$(cat /sys/fs/cgroup/pids.max 2>/dev/null || cat /sys/fs/cgroup/pids/pids.max 2>/dev/null || echo max); ' +
  'echo "META $C $M"; ' +
  "ps -eo pid=,ppid=,stat=,pcpu=,pmem=,rss=,etimes=,args= -ww";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1)
    return NextResponse.json(
      { error: "pod still installing" },
      { status: 409 },
    );

  let stdout: string;
  try {
    ({ stdout } = await execInPod(
      srv.uuid,
      ["exec", "-u", "0", srv.uuid, "bash", "-lc", LIST_CMD],
      { timeoutMs: 10000, maxBuffer: 8 * 1024 * 1024 },
    ));
  } catch (err) {
    const info = describePodExecError(err);
    return NextResponse.json(
      { error: info.message, code: info.code },
      { status: info.status },
    );
  }

  const lines = stdout.split("\n");
  let pidsCurrent = 0;
  let pidsMax: number | null = null;
  const processes: PodProcess[] = [];

  for (const line of lines) {
    if (line.startsWith("META ")) {
      const [, cur, max] = line.split(/\s+/);
      pidsCurrent = Number(cur) || 0;
      pidsMax = max === "max" || max === undefined ? null : Number(max) || null;
      continue;
    }
    const m = PS_RE.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    // Skip the ps/bash we just spawned where we can identify it — harmless
    // either way, but the command column makes it obvious to the user.
    processes.push({
      pid,
      ppid: Number(m[2]),
      state: m[3],
      cpu: Number(m[4]) || 0,
      mem: Number(m[5]) || 0,
      rssKb: Number(m[6]) || 0,
      etimes: Number(m[7]) || 0,
      command: m[8],
    });
  }

  return NextResponse.json({
    processes,
    pids: { current: pidsCurrent, max: pidsMax },
    sampledAt: Date.now(),
  });
}

type SignalName = "TERM" | "KILL" | "STOP" | "CONT" | "HUP" | "INT";
const VALID_SIGNALS: SignalName[] = [
  "TERM",
  "KILL",
  "STOP",
  "CONT",
  "HUP",
  "INT",
];

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await ctx.params;
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: { pid?: unknown; signal?: unknown };
  try {
    body = (await req.json()) as { pid?: unknown; signal?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const pid = Number(body.pid);
  if (!Number.isInteger(pid) || pid <= 1) {
    // Reject non-integers and pid<=1: pid 1 is the container init — killing
    // it would tear down the whole pod (use the pod power controls for that).
    return NextResponse.json(
      { error: "pid must be an integer > 1 (pid 1 is the container init)" },
      { status: 400 },
    );
  }
  const signal = body.signal as SignalName;
  if (!VALID_SIGNALS.includes(signal)) {
    return NextResponse.json(
      { error: `signal must be one of: ${VALID_SIGNALS.join(", ")}` },
      { status: 400 },
    );
  }

  const srv = await getServer(uuid, user.pelicanUserId);
  if (!srv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (srv.container.installed !== 1)
    return NextResponse.json(
      { error: "pod still installing" },
      { status: 409 },
    );

  try {
    // `kill -s SIG PID` — pid/signal are both already strictly validated
    // above, so there's no injection surface in the argv.
    await execInPod(
      srv.uuid,
      [
        "exec",
        "-u",
        "0",
        srv.uuid,
        "kill",
        "-s",
        signal,
        String(pid),
      ],
      { timeoutMs: 6000 },
    );
  } catch (err) {
    // kill writes "No such process" / "Operation not permitted" to stderr
    // and exits non-zero, which execFile surfaces as a thrown error.
    const info = describePodExecError(err);
    if (info.code !== "exec_failed") {
      return NextResponse.json(
        { error: info.message, code: info.code },
        { status: info.status },
      );
    }
    const msg = info.raw;
    const friendly = /No such process/i.test(msg)
      ? "process already gone"
      : /not permitted/i.test(msg)
        ? "operation not permitted"
        : msg;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }

  return NextResponse.json({ ok: true, pid, signal });
}
