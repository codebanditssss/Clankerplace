// FuelBorn custom Next.js server.
//
// Hosts the normal Next.js HTTP app on $PORT (3000 by default) AND a small WS
// router for: /api/pods/<uuid>/terminal (real PTY via docker exec) and
// /api/pods/<uuid>/metrics (live docker stats snapshots). Auth is enforced by
// re-verifying the pods_session cookie against our SQLite users table, then
// confirming the user owns the pod via the Pelican Application API.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { parse as parseCookie } from "node:querystring";
import { spawn as childSpawn } from "node:child_process";
import next from "next";
import { WebSocketServer } from "ws";
import Database from "better-sqlite3";
import pty from "node-pty";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DEV = process.env.NODE_ENV !== "production";
const DB_PATH = process.env.PODS_DB_PATH || "./data/pods.db";
const SESSION_SECRET = process.env.SESSION_SECRET;
const PELICAN_URL = process.env.PELICAN_URL || "";
const PELICAN_API_KEY = process.env.PELICAN_API_KEY || "";
if (!SESSION_SECRET) {
  console.error("SESSION_SECRET must be set");
  process.exit(1);
}

// ---------------------- cross-node docker routing ----------------------
//
// Pods live on different Pelican Wings nodes. This Next.js process runs on
// node 1, so a bare `docker exec <full-uuid>` only reaches node-1 pods. For
// pods on other nodes we ssh over the Tailscale tailnet to the right node and
// run docker there. This mirrors src/lib/node-exec.ts (which the TS route
// handlers use) — server.mjs runs unbundled and can't import the TS module,
// so the logic is duplicated here. Keep the two in sync.
//
//   PELICAN_NODE_ID              local node id (default 1)
//   PELICAN_NODE_TAILSCALE_IPS   "2:100.92.124.106,3:100.x.x.x"
//   PODS_NODE_SSH_USER           ssh user on remote nodes (default podsadmin)
const LOCAL_NODE_ID = Number(process.env.PELICAN_NODE_ID || "1");
const SSH_USER = process.env.PODS_NODE_SSH_USER || "podsadmin";
const NODE_TAILSCALE_IPS = (() => {
  const m = new Map();
  for (const part of (process.env.PELICAN_NODE_TAILSCALE_IPS || "").split(",")) {
    const [id, ip] = part.split(":").map((s) => s.trim());
    const n = Number(id);
    if (Number.isFinite(n) && ip) m.set(n, ip);
  }
  return m;
})();
const SSH_OPTS = [
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "ConnectTimeout=6",
];

function quoteArg(a) {
  return `'${String(a).replace(/'/g, "'\\''")}'`;
}

// Resolve a `docker <args>` invocation to either a local docker spawn or an
// ssh-over-tailnet spawn, depending on which node the pod lives on. Returns
// { cmd, args } for spawn/pty, or { error } if the node has no tailnet IP.
// `interactive` adds `ssh -tt` so a real PTY is allocated on the remote side.
function dockerInvocation(nodeId, dockerArgs, { interactive = false } = {}) {
  const n = Number(nodeId);
  if (!Number.isFinite(n) || n === LOCAL_NODE_ID) {
    return { cmd: "docker", args: dockerArgs };
  }
  const ip = NODE_TAILSCALE_IPS.get(n);
  if (!ip) {
    return {
      error: `pod lives on node ${n} but no tailnet IP is mapped (PELICAN_NODE_TAILSCALE_IPS)`,
    };
  }
  const remote = ["docker", ...dockerArgs].map(quoteArg).join(" ");
  const args = interactive ? ["-tt", ...SSH_OPTS] : [...SSH_OPTS];
  args.push(`${SSH_USER}@${ip}`, remote);
  return { cmd: "ssh", args };
}

function runDockerCheck(inv, timeoutMs = 6000) {
  if (inv.error) {
    return Promise.resolve({ ok: false, stdout: "", stderr: inv.error });
  }
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = childSpawn(inv.cmd, inv.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      resolve({ ok: false, stdout, stderr: stderr || "docker check timed out" });
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

async function checkContainerRunning(nodeId, containerName) {
  const inv = dockerInvocation(nodeId, [
    "inspect",
    "-f",
    "{{.State.Running}} {{.State.Status}}",
    containerName,
  ]);
  const res = await runDockerCheck(inv);
  if (!res.ok) {
    const raw = `${res.stderr || ""}\n${res.stdout || ""}`.trim();
    if (/No such object|No such container/i.test(raw)) {
      return {
        running: false,
        message: "Pod container was not found. Restart the pod or contact support if it was just created.",
        raw,
      };
    }
    if (/no tailnet IP is mapped/i.test(raw)) {
      return {
        running: false,
        message: "Pod node is not reachable. Contact support if this keeps happening.",
        raw,
      };
    }
    return {
      running: false,
      message: "Pod runtime is not reachable. Try again in a moment.",
      raw,
    };
  }
  const [running, status] = res.stdout.trim().split(/\s+/, 2);
  if (running === "true") return { running: true, message: "" };
  return {
    running: false,
    message: `Pod is ${status || "not running"}. Start it from Actions, then try again.`,
  };
}

// Tear down a tagged in-container process tree (node-aware).
//
// `docker exec` does NOT kill the process it started when the client/PTY
// disconnects — closing a dashboard terminal only kills our local ssh/docker
// *client*, leaving `bash → hermes → MCP servers` (~100 pids) running inside
// the pod forever. Enough leaked sessions exhaust the container's 512-pid
// cgroup limit and every fork/new-thread then fails with EAGAIN
// ("can't start new thread"), bricking the pod. See the terminal handler,
// which stamps each shell with a unique PODS_TERM_ID env var; children inherit
// it, so we reap the whole tree by scanning /proc for that tag regardless of
// reparenting. Fire-and-forget; never throws into the close() path.
function reapTaggedSession(nodeId, containerName, termId) {
  if (!containerName || !termId) return;
  // Single-quoted in the reaper so a malformed termId can't break out; we
  // generate it ourselves (randomUUID) so it's always [0-9a-f-].
  const reaper =
    `for d in /proc/[0-9]*; do ` +
    `tr '\\0' '\\n' < "$d/environ" 2>/dev/null | ` +
    `grep -qxF 'PODS_TERM_ID=${termId}' && ` +
    `kill -KILL "\${d##*/}" 2>/dev/null; ` +
    `done; true`;
  const inv = dockerInvocation(nodeId, [
    "exec",
    containerName,
    "/bin/bash",
    "-c",
    reaper,
  ]);
  if (inv.error) return;
  try {
    const p = childSpawn(inv.cmd, inv.args, {
      stdio: "ignore",
      detached: true,
    });
    p.on("error", () => {});
    p.unref();
  } catch {
    /* best-effort cleanup */
  }
}

// Production-only required env. In dev these are nice-to-have (the
// affected features no-op without them); in prod a missing one is a
// real bug we want to catch at boot rather than at first-request time.
// The TS equivalent in src/lib/env.ts is the canonical list and is
// exercised by the unit tests.
if (!DEV) {
  const productionRequired = [
    ["PELICAN_URL", "Pelican panel base URL"],
    ["PELICAN_API_KEY", "Pelican Application API key"],
    ["RESEND", "Resend API key for transactional + billing emails"],
    ["DODO_PAYMENTS_API_KEY", "Dodo Payments API key"],
    ["DODO_PAYMENTS_WEBHOOK_KEY", "Dodo Payments webhook signing key"],
    ["DODO_PRODUCT_DEVELOPER", "Dodo Developer subscription product"],
    ["DODO_PRODUCT_PRO", "Dodo Pro subscription product"],
    ["DODO_PRODUCT_SCALE", "Dodo Scale subscription product"],
    ["DODO_CREDIT_PACK_10", "Dodo $10 credit pack product"],
    ["DODO_CREDIT_PACK_25", "Dodo $25 credit pack product"],
    ["DODO_CREDIT_PACK_50", "Dodo $50 credit pack product"],
    ["DODO_CREDIT_PACK_100", "Dodo $100 credit pack product"],
    ["PODS_PUBLIC_URL", "canonical public app origin for billing return URLs"],
  ];
  const missing = productionRequired.filter(([k]) => !process.env[k]);
  // Meter token: either INTERNAL_METER_TOKEN or INTERNAL_RECONCILE_TOKEN
  // works; only fail if BOTH are missing.
  if (
    !process.env.INTERNAL_METER_TOKEN &&
    !process.env.INTERNAL_RECONCILE_TOKEN
  ) {
    missing.push([
      "INTERNAL_METER_TOKEN",
      "loopback token for the meter tick (or set INTERNAL_RECONCILE_TOKEN)",
    ]);
  }
  if (missing.length > 0) {
    for (const [k, why] of missing) {
      console.error(`[env] MISSING ${k} — ${why}`);
    }
    console.error(
      `[env] Refusing to start in production with ${missing.length} missing env var(s).`,
    );
    process.exit(1);
  }
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Pod-metrics persistence: a 24h rolling window of docker-stats samples for
// every sandbox container, written by the background sampler (`pollMetrics`
// below). The Stats tab reads from this table for everything outside the
// last ~30 seconds, then layers live samples on top via the metrics WS.
// uuid_short = the first 8 chars of the container UUID (== Pelican's
// identifier / our /pods/[uuid] URL slug), so the history endpoint can
// query directly without a Pelican round-trip to resolve the full UUID.
db.exec(`
  CREATE TABLE IF NOT EXISTS pod_metrics (
    uuid_short TEXT NOT NULL,
    ts         INTEGER NOT NULL,
    cpu        REAL,
    mem_mb     REAL,
    mem_pct    REAL,
    net_rx_mb  REAL,
    net_tx_mb  REAL,
    blk_rd_mb  REAL,
    blk_wr_mb  REAL,
    PRIMARY KEY (uuid_short, ts)
  );
  CREATE INDEX IF NOT EXISTS idx_pod_metrics_ts ON pod_metrics(ts);
`);
const insertSampleStmt = db.prepare(
  `INSERT OR REPLACE INTO pod_metrics
   (uuid_short, ts, cpu, mem_mb, mem_pct, net_rx_mb, net_tx_mb, blk_rd_mb, blk_wr_mb)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const retentionDeleteStmt = db.prepare(
  `DELETE FROM pod_metrics WHERE ts < ?`,
);

const app = next({ dev: DEV });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => handle(req, res));
const wss = new WebSocketServer({ noServer: true });

// ---------------------- session + ownership helpers ----------------------

function readCookies(rawHeader) {
  if (!rawHeader) return {};
  const out = {};
  for (const part of rawHeader.split(/; */)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(
      part.slice(eq + 1),
    );
  }
  return out;
}

function verifySession(token) {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.uid !== "number") return null;
    if (Date.now() / 1000 - payload.iat > 60 * 60 * 24 * 7) return null;
    return payload;
  } catch {
    return null;
  }
}

function userById(uid) {
  return db
    .prepare("SELECT id, email, pelican_user_id, pelican_client_token FROM users WHERE id = ?")
    .get(uid);
}

async function userOwnsServer(pelicanUserId, uuidShort) {
  const res = await fetch(
    `${PELICAN_URL}/api/application/servers?filter[uuid_short]=${encodeURIComponent(uuidShort)}`,
    {
      headers: {
        Authorization: `Bearer ${PELICAN_API_KEY}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const srv = data.data?.[0]?.attributes;
  if (!srv) return null;
  if (srv.user !== pelicanUserId) return null;
  return srv; // { uuid, identifier, status, container: {installed,...}, ... }
}

async function authenticate(req) {
  const cookies = readCookies(req.headers.cookie);
  const sess = verifySession(cookies.pods_session);
  if (!sess) return null;
  const user = userById(sess.uid);
  if (!user) return null;
  return user;
}

// ---------------------- /api/pods/<uuid>/terminal ----------------------

const TERMINAL_RE = /^\/api\/pods\/([^/]+)\/terminal\/?(\?.*)?$/;

async function onTerminalConnection(ws, req, uuidShort) {
  const remote = req.socket.remoteAddress;
  const user = await authenticate(req);
  if (!user) {
    console.log(`[term] ${uuidShort} ${remote} — REJECT no session`);
    return ws.close(4001, "not signed in");
  }
  const srv = await userOwnsServer(user.pelican_user_id, uuidShort);
  if (!srv) {
    console.log(`[term] ${uuidShort} user=${user.email} - REJECT not owner / not found`);
    return ws.close(4004, "pod not found");
  }
  if (srv.container.installed !== 1) {
    console.log(`[term] ${uuidShort} user=${user.email} — still installing`);
    ws.send("\x1b[33m[FuelBorn] pod is still installing — terminal will activate when ready\x1b[0m\r\n");
    ws.close(4003, "still installing");
    return;
  }

  const containerName = srv.uuid; // Wings names the docker container after the full uuid
  const runtime = await checkContainerRunning(srv.node, containerName);
  if (!runtime.running) {
    console.log(`[term] ${uuidShort} user=${user.email} - ${runtime.message}${runtime.raw ? ` (${runtime.raw})` : ""}`);
    try {
      ws.send(`\r\n\x1b[33m[FuelBorn] ${runtime.message}\x1b[0m\r\n`);
    } catch {}
    ws.close(4006, "pod not running");
    return;
  }
  // Unique tag for this shell session. Stamped into the environment so the
  // whole `bash → hermes → MCP servers` tree inherits it; on disconnect we
  // reap by this tag (see reapTaggedSession) because `docker exec` won't kill
  // the in-container tree when our client dies — leaked trees otherwise pile
  // up until the pod hits its pid limit and can't start new threads.
  const termId = randomUUID();
  // Remote-node pods tunnel through `ssh -tt … docker exec -it`: ssh -tt
  // allocates the outer PTY and `docker exec -it` allocates the container
  // PTY, so bash is a real interactive login shell (prompt + MOTD + colors).
  // Using `-i` without `-t` here was the bug that left the terminal
  // prompt-less and the UI stuck "connecting" for node-2 pods.
  const dockerArgs = [
    "exec",
    "-it",
    "-e",
    "TERM=xterm-256color",
    "-e",
    "COLORTERM=truecolor",
    "-e",
    `PODS_TERM_ID=${termId}`,
    // Suppress the in-pod MOTD for dashboard terminal sessions. The
    // dashboard already shows the user which pod they're in, and the
    // MOTD re-appears on every reconnect / scrollback restore which
    // makes the terminal feel cluttered. Setting PODS_ML_MOTD_SHOWN
    // makes /etc/bash.bashrc skip the `cat /etc/motd` call.
    "-e",
    "PODS_ML_MOTD_SHOWN=1",
    containerName,
    "/bin/bash",
    "-l",
  ];
  const inv = dockerInvocation(srv.node, dockerArgs, { interactive: true });
  if (inv.error) {
    console.log(`[term] ${uuidShort} user=${user.email} — ${inv.error}`);
    try {
      ws.send(`\r\n\x1b[31m[FuelBorn] ${inv.error}\x1b[0m\r\n`);
    } catch {}
    ws.close(4005, "node unreachable");
    return;
  }

  console.log(`[term] ${uuidShort} user=${user.email} node=${srv.node ?? "?"} OPEN`);
  const term = pty.spawn(
    inv.cmd,
    inv.args,
    {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: "/tmp",
      env: { ...process.env, TERM: "xterm-256color" },
    },
  );

  let closed = false;
  const close = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    try { term.kill(); } catch {}
    // term.kill() only kills our local ssh/docker-exec client; the shell and
    // everything it spawned (hermes + MCP servers) keep running inside the
    // container. Reap the tagged tree so sessions don't leak pids.
    try { reapTaggedSession(srv.node, containerName, termId); } catch {}
    try { ws.close(code, reason); } catch {}
  };

  term.onData((data) => {
    try {
      ws.send(data);
    } catch {
      /* socket gone */
    }
  });

  term.onExit(({ exitCode, signal }) => {
    console.log(`[term] ${uuidShort} PTY exit code=${exitCode} signal=${signal}`);
    try {
      ws.send(`\r\n\x1b[90m[FuelBorn] shell exited (${exitCode})\x1b[0m\r\n`);
    } catch {}
    close();
  });

  ws.on("message", (msg, isBinary) => {
    if (closed) return;
    if (!isBinary) {
      const s = msg.toString();
      // Resize signal: client sends a tiny JSON message starting with '{"r":'
      if (s.length < 200 && s.startsWith('{"r":')) {
        try {
          const parsed = JSON.parse(s);
          if (parsed?.r && Array.isArray(parsed.r)) {
            const [cols, rows] = parsed.r;
            if (Number.isInteger(cols) && Number.isInteger(rows)) {
              term.resize(cols, rows);
              return;
            }
          }
        } catch {
          /* fall through to writing as data */
        }
      }
      term.write(s);
    } else {
      term.write(msg);
    }
  });
  ws.on("close", () => close());
  ws.on("error", () => close(1011, "error"));
}

// ---------------------- /api/pods/<uuid>/whatsapp-pair ----------------------
//
// Same shape as the terminal endpoint but the spawned command is the hermes
// whatsapp wizard instead of an interactive shell. The wizard:
//   1. asks "bot" or "self-chat" — we wait for the user to type
//   2. installs Baileys deps on first run (~30 s)
//   3. prints a QR code in the terminal — user scans from the phone
//   4. exits cleanly once paired, which closes the websocket
// xterm.js on the client renders the QR fine because we keep the same env
// vars (TERM=xterm-256color, COLORTERM=truecolor) as the main terminal.
const WHATSAPP_RE = /^\/api\/pods\/([^/]+)\/whatsapp-pair\/?(\?.*)?$/;

async function onWhatsappPair(ws, req, uuidShort) {
  const user = await authenticate(req);
  if (!user) return ws.close(4001, "not signed in");
  const srv = await userOwnsServer(user.pelican_user_id, uuidShort);
  if (!srv) return ws.close(4004, "pod not found");
  if (srv.container.installed !== 1) {
    ws.send("\x1b[33m[FuelBorn] pod is still installing\x1b[0m\r\n");
    return ws.close(4003, "still installing");
  }

  const containerName = srv.uuid;
  const runtime = await checkContainerRunning(srv.node, containerName);
  if (!runtime.running) {
    try {
      ws.send(`\r\n\x1b[33m[FuelBorn] ${runtime.message}\x1b[0m\r\n`);
    } catch {}
    ws.close(4006, "pod not running");
    return;
  }
  const termId = randomUUID();
  console.log(`[whatsapp-pair] ${uuidShort} user=${user.email} node=${srv.node ?? "?"} OPEN`);
  // Make sure the bridge's node_modules is intact before launching the
  // wizard.
  //
  // CANARY: Baileys's package.json declares `"main": "lib/index.js"`
  // (NOT a top-level index.js). A previous version of this check looked
  // for `node_modules/@whiskeysockets/baileys/index.js`, which never
  // exists in a healthy install — so every pairing click would wipe
  // node_modules and reinstall, costing the user 2 minutes each time.
  //
  // The right canary is the package's actual main entry. If that's
  // present we trust the install; otherwise we full-rebuild because
  // node_modules is half-broken (ERR_MODULE_NOT_FOUND on hermes-whatsapp
  // launch).
  const bootstrap = [
    "BR=/home/container/hermes-agent/scripts/whatsapp-bridge",
    "BAILEYS_MAIN=\"$BR/node_modules/@whiskeysockets/baileys/lib/index.js\"",
    'if [ -f "$BAILEYS_MAIN" ]; then',
    '  : # already installed, fast-path',
    "else",
    '  echo "[FuelBorn] installing whatsapp-bridge dependencies (first-time, ~60s)";',
    '  (cd "$BR" && rm -rf node_modules package-lock.json && NODE_OPTIONS="--max-old-space-size=2048" npm install --silent --no-audit --no-fund --maxsockets=4) || { echo "[FuelBorn] npm install failed — out of memory? try stopping/restarting the pod"; exit 1; }',
    "fi",
    "exec hermes whatsapp",
  ].join("\n");
  // `ssh -tt … docker exec -it` for remote pods (see terminal handler):
  // the QR wizard needs a real PTY for the terminal-rendered QR code.
  const dockerArgs = [
    "exec",
    "-it",
    "-e",
    "TERM=xterm-256color",
    "-e",
    "COLORTERM=truecolor",
    "-e",
    `PODS_TERM_ID=${termId}`,
    containerName,
    "/bin/bash",
    "-lc",
    bootstrap,
  ];
  const inv = dockerInvocation(srv.node, dockerArgs, { interactive: true });
  if (inv.error) {
    try {
      ws.send(`\r\n\x1b[31m[FuelBorn] ${inv.error}\x1b[0m\r\n`);
    } catch {}
    ws.close(4005, "node unreachable");
    return;
  }
  const term = pty.spawn(
    inv.cmd,
    inv.args,
    {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: "/tmp",
      env: { ...process.env, TERM: "xterm-256color" },
    },
  );

  let closed = false;
  const close = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    try { term.kill(); } catch {}
    try { reapTaggedSession(srv.node, containerName, termId); } catch {}
    try { ws.close(code, reason); } catch {}
  };

  term.onData((d) => { try { ws.send(d); } catch {} });
  term.onExit(({ exitCode }) => {
    try {
      ws.send(
        `\r\n\x1b[90m[FuelBorn] pairing wizard exited (${exitCode})\x1b[0m\r\n`,
      );
    } catch {}
    close();
  });

  ws.on("message", (msg, isBinary) => {
    if (closed) return;
    if (!isBinary) {
      const s = msg.toString();
      if (s.length < 200 && s.startsWith('{"r":')) {
        try {
          const parsed = JSON.parse(s);
          if (parsed?.r && Array.isArray(parsed.r)) {
            const [cols, rows] = parsed.r;
            if (Number.isInteger(cols) && Number.isInteger(rows)) {
              term.resize(cols, rows);
              return;
            }
          }
        } catch {
          /* fall through */
        }
      }
      term.write(s);
    } else {
      term.write(msg);
    }
  });
  ws.on("close", () => close());
  ws.on("error", () => close(1011, "error"));
}

// ---------------------- background metrics sampler ----------------------
//
// Runs unconditionally as long as the frontend process is up. Polls
// `docker stats --no-stream` for ALL containers in a single docker call
// every SAMPLE_INTERVAL_MS, parses the CPU/mem/net/blk strings into
// numbers, persists to SQLite, and fans out to any subscribed WS clients
// in `metricsSubs`. The same data is exposed via the new
// /api/pods/[uuid]/metrics-history HTTP endpoint.

const SAMPLE_INTERVAL_MS = 5000; // 17,280 samples / pod / day at 5s
const RETENTION_MS = 24 * 60 * 60 * 1000;

function parseSizeMB(s) {
  if (!s) return 0;
  const m = String(s).match(/([\d.]+)\s*([KMGTPE]i?B)?/i);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const u = (m[2] || "").toLowerCase();
  const factors = {
    "": 1 / (1024 * 1024),
    b: 1 / (1024 * 1024),
    kib: 1 / 1024, kb: 1 / 1024,
    mib: 1, mb: 1,
    gib: 1024, gb: 1024,
    tib: 1024 * 1024, tb: 1024 * 1024,
  };
  return v * (factors[u] ?? 1);
}
function parsePct(s) {
  return parseFloat(String(s || "0").replace("%", "")) || 0;
}
function parsePair(s) {
  const [a, b] = String(s || "0 / 0").split("/").map((x) => x.trim());
  return [parseSizeMB(a), parseSizeMB(b)];
}

// subscribers keyed by uuid_short. value = Set<WebSocket>.
const metricsSubs = new Map();

function broadcast(uuidShort, sample) {
  const set = metricsSubs.get(uuidShort);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(sample);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(payload); } catch {}
    }
  }
}

// Pelican Wings container names look like full UUIDs:
// dda6ff66-6214-4d49-8d34-af22b69099c9. Anything that doesn't match this
// shape (pelican-panel-1, redis, mariadb, …) is infra and is skipped.
const UUID_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let samplerInflight = false;

const STATS_ARGS = [
  "stats",
  "--no-stream",
  "--format",
  '{"name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","memP":"{{.MemPerc}}","net":"{{.NetIO}}","blk":"{{.BlockIO}}"}',
];

// One docker-stats source per node: the local daemon plus an ssh-over-tailnet
// call for every remote Wings node. Each resolves to its raw stdout (or "" on
// error) so a single unreachable node can't stall or break the sampler.
function statsSources() {
  const sources = [{ cmd: "docker", args: STATS_ARGS }];
  for (const [, ip] of NODE_TAILSCALE_IPS) {
    const remote = ["docker", ...STATS_ARGS].map(quoteArg).join(" ");
    sources.push({ cmd: "ssh", args: [...SSH_OPTS, `${SSH_USER}@${ip}`, remote] });
  }
  return sources;
}

function runStatsSource(src) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(out);
    };
    const proc = childSpawn(src.cmd, src.args, {
      stdio: ["ignore", "pipe", "ignore"],
    });
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.on("error", finish);
    proc.on("close", finish);
    // Hard ceiling so a wedged ssh can't keep samplerInflight pinned.
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      finish();
    }, 8000);
  });
}

async function pollMetrics() {
  if (samplerInflight) return;
  samplerInflight = true;
  let combined = "";
  try {
    const outs = await Promise.all(statsSources().map(runStatsSource));
    combined = outs.join("\n");
  } finally {
    samplerInflight = false;
  }
  const ts = Date.now();
  const lines = combined.split("\n").map((l) => l.trim()).filter(Boolean);
  const writeMany = db.transaction((rows) => {
    for (const r of rows) {
      insertSampleStmt.run(
        r.uuid_short, ts, r.cpu, r.mem_mb, r.mem_pct,
        r.net_rx_mb, r.net_tx_mb, r.blk_rd_mb, r.blk_wr_mb,
      );
    }
  });
  const batch = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (!UUID_NAME_RE.test(row.name)) continue; // skip infra
      const uuidShort = row.name.slice(0, 8);
      const [memMB] = parsePair(row.mem);
      const [netRx, netTx] = parsePair(row.net);
      const [blkRd, blkWr] = parsePair(row.blk);
      const sample = {
        uuid_short: uuidShort,
        cpu: parsePct(row.cpu),
        mem_mb: memMB,
        mem_pct: parsePct(row.memP),
        net_rx_mb: netRx,
        net_tx_mb: netTx,
        blk_rd_mb: blkRd,
        blk_wr_mb: blkWr,
      };
      batch.push(sample);
      broadcast(uuidShort, { t: ts, ...sample });
    } catch {
      /* skip malformed line */
    }
  }
  if (batch.length > 0) {
    try { writeMany(batch); } catch (e) { console.warn("[metrics] write failed", e); }
  }
}

// Drop rows older than RETENTION_MS every minute. SQLite WAL keeps the
// file from growing unboundedly so long as we DELETE periodically.
function retentionSweep() {
  try {
    const cutoff = Date.now() - RETENTION_MS;
    const r = retentionDeleteStmt.run(cutoff);
    if (r.changes > 0) {
      console.log(`[metrics] retention swept ${r.changes} rows`);
    }
  } catch (e) {
    console.warn("[metrics] retention sweep failed", e);
  }
}

setInterval(pollMetrics, SAMPLE_INTERVAL_MS);
setInterval(retentionSweep, 60_000);
// Kick off an immediate sample so the dashboard isn't empty on first
// page load right after the server starts.
setTimeout(pollMetrics, 500);

// ---------------------- Billing meter tick ----------------------
// Once a minute, ping /api/internal/meter over loopback to:
//   - debit running pods for the elapsed time (per-pod, atomic ledger
//     inserts at micro-cent precision — see lib/billing/meter.ts)
//   - re-evaluate threshold state for every user whose balance moved
//     this tick (warn → grace → suspend transitions)
//   - every 30 ticks, run a full thresholdSweep (catches grace timeouts,
//     7d purge warnings, 30d purges)
//
// Falls back to INTERNAL_RECONCILE_TOKEN if INTERNAL_METER_TOKEN isn't
// set (the route accepts either) so a single token suffices for both.
const METER_INTERVAL_MS = 60_000;
const METER_TOKEN =
  process.env.INTERNAL_METER_TOKEN || process.env.INTERNAL_RECONCILE_TOKEN || "";

let _meterInFlight = false;
async function tickMeter() {
  if (_meterInFlight) return;
  if (!METER_TOKEN) return;
  _meterInFlight = true;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/internal/meter`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": METER_TOKEN,
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[meter] tick HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[meter] tick failed: ${err?.message || err}`);
  } finally {
    _meterInFlight = false;
  }
}
if (METER_TOKEN) {
  // Delay the first meter tick so the server is fully ready.
  setTimeout(tickMeter, 10_000);
  setInterval(tickMeter, METER_INTERVAL_MS);
} else {
  console.warn(
    "[meter] INTERNAL_METER_TOKEN (or INTERNAL_RECONCILE_TOKEN) not set — legacy meter tick is disabled",
  );
}

// ---------------------- Pelican ↔ meter reconciliation ----------------
// Every 5 minutes, cross-check our pod_meter_state against Pelican's
// /servers list to catch:
//   - dropped Pelican webhooks (power state out of sync)
//   - admin-side pod deletes that bypassed our DELETE route
//   - resource resizes (RAM/disk/cpu changed in the panel)
//   - legacy pods that exist in Pelican but have no meter row
// Uses the same token + concurrency guard as the other internal endpoints.
const PELICAN_RECONCILE_INTERVAL_MS = 5 * 60_000;
let _pelicanReconcileInFlight = false;
async function tickPelicanReconcile() {
  if (_pelicanReconcileInFlight) return;
  if (!METER_TOKEN) return;
  _pelicanReconcileInFlight = true;
  try {
    const res = await fetch(
      `http://127.0.0.1:${PORT}/api/internal/reconcile-pelican`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": METER_TOKEN,
        },
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[reconcile-pelican] tick HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.warn(`[reconcile-pelican] tick failed: ${err?.message || err}`);
  } finally {
    _pelicanReconcileInFlight = false;
  }
}
if (METER_TOKEN) {
  // Delay the first cross-check by 30s so the meter tick has fired at
  // least once first (cleaner cold-start logs).
  setTimeout(tickPelicanReconcile, 30_000);
  setInterval(tickPelicanReconcile, PELICAN_RECONCILE_INTERVAL_MS);
}

// ---------------------- CPU-pin watchdog tick -------------------------
// Every 15 minutes, ping /api/internal/watchdog over loopback. It probes
// the pod_metrics table (written by pollMetrics above) for pods pinned at
// ~their CPU cap, warns the owner after 6h of continuous pin, and
// suspends the pod after 24h. Runaway agent-written busy-wait loops have
// burned whole cores for days before (hermes-ai's validate_session.py);
// this catches those without hurting bursty real work — one cool probe
// resets the ladder. Logic + thresholds: src/lib/watchdog.ts.
const WATCHDOG_INTERVAL_MS = 15 * 60_000;
let _watchdogInFlight = false;
async function tickWatchdog() {
  if (_watchdogInFlight) return;
  if (!METER_TOKEN) return;
  _watchdogInFlight = true;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/internal/watchdog`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": METER_TOKEN,
      },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[watchdog] tick HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[watchdog] tick failed: ${err?.message || err}`);
  } finally {
    _watchdogInFlight = false;
  }
}
if (METER_TOKEN) {
  // First run 60s after boot: the sampler needs a beat to start filling
  // pod_metrics, and existing rows already cover the probe window.
  setTimeout(tickWatchdog, 60_000);
  setInterval(tickWatchdog, WATCHDOG_INTERVAL_MS);
}

// ---------------------- pod_domains table ---------------------------
// Slug → (pod uuid, port) mappings for the user-facing *.bigcat.pw
// subdomains. Source of truth — the Caddy include files under
// /etc/caddy/domains/ are derived from this table.
db.exec(`
  CREATE TABLE IF NOT EXISTS pod_domains (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT NOT NULL UNIQUE,
    pod_uuid_short  TEXT NOT NULL,
    pod_full_uuid   TEXT NOT NULL,
    port            INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    container_ip    TEXT,
    kind            TEXT NOT NULL DEFAULT 'manual',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pod_domains_pod ON pod_domains(pod_uuid_short);
  CREATE INDEX IF NOT EXISTS idx_pod_domains_user ON pod_domains(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_domains_pod_port_uniq
    ON pod_domains(pod_uuid_short, port);
`);

// ---------------------- /api/pods/<uuid>/metrics ----------------------

const METRICS_RE = /^\/api\/pods\/([^/]+)\/metrics\/?(\?.*)?$/;

async function onMetricsConnection(ws, req, uuidShort) {
  const user = await authenticate(req);
  if (!user) return ws.close(4001, "not signed in");
  const srv = await userOwnsServer(user.pelican_user_id, uuidShort);
  if (!srv) return ws.close(4004, "pod not found");

  // The connection just subscribes to the global sampler. No per-WS
  // docker process — even with 50 viewers we run docker stats once.
  let set = metricsSubs.get(uuidShort);
  if (!set) {
    set = new Set();
    metricsSubs.set(uuidShort, set);
  }
  set.add(ws);

  const close = () => {
    const s = metricsSubs.get(uuidShort);
    if (s) {
      s.delete(ws);
      if (s.size === 0) metricsSubs.delete(uuidShort);
    }
    try { ws.close(); } catch {}
  };
  ws.on("close", close);
  ws.on("error", close);
}

// ---------------------- WS dispatcher ----------------------

server.on("upgrade", (req, socket, head) => {
  const url = req.url || "";
  let m = url.match(TERMINAL_RE);
  if (m) {
    wss.handleUpgrade(req, socket, head, (ws) => onTerminalConnection(ws, req, m[1]));
    return;
  }
  m = url.match(METRICS_RE);
  if (m) {
    wss.handleUpgrade(req, socket, head, (ws) => onMetricsConnection(ws, req, m[1]));
    return;
  }
  m = url.match(WHATSAPP_RE);
  if (m) {
    wss.handleUpgrade(req, socket, head, (ws) => onWhatsappPair(ws, req, m[1]));
    return;
  }
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`[FuelBorn] ready on http://${HOST}:${PORT}`);
});
