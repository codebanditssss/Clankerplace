# AGENTS.md

Prototype platform for one-click AI-agent pods, built on Pelican Panel + Wings.
Read `README.md` for architecture and bring-up; this file only lists things you
will get wrong without help.

## Repo shape

- `frontend/` — user-facing Next.js app. **Has its own `AGENTS.md` — read it.**
- `infra/` — shell + systemd + docker-compose to provision the Azure VM and run
  Pelican Panel, Wings, Caddy, and the frontend systemd unit. Not built or
  tested locally; deployed via `rsync` per `README.md`.
- `eggs/hermes-agent.json` — Pelican egg (install script + env vars) for the
  Hermes pod type. Imported into the panel via
  `App\Services\Eggs\Sharing\EggImporterService` (see README for the tinker
  one-liner). Edit the JSON, re-run the import to update.

There are no tests, linters, formatters, or CI in this repo. Don't invent
commands; the only real ones are `pnpm dev|build|start` inside `frontend/`.

## Frontend gotchas (in addition to `frontend/AGENTS.md`)

- **Next.js 16 + React 19 + Tailwind 4.** `frontend/AGENTS.md` warns these
  diverge from training-data assumptions — consult
  `frontend/node_modules/next/dist/docs/` before writing app/router code.
- **Custom server.** `pnpm start` runs `node server.mjs`, not `next start`.
  `server.mjs` hosts the Next handler **and** WebSocket routes for docker:
  - `/api/pods/<uuid_short>/terminal` → `docker exec -it <full-uuid> /bin/bash`
    via `node-pty`.
  - `/api/pods/<uuid_short>/whatsapp-pair` → same shape, runs the Hermes
    WhatsApp pairing wizard.
  - `/api/pods/<uuid_short>/metrics` → polls `docker stats` (5 s cadence).
  Both auth by re-verifying the `pods_session` HMAC cookie and then calling
  Pelican's Application API to confirm ownership. Any change to session
  format, cookie name, or ownership logic must be mirrored in `src/lib/`
  (`auth.ts`, `session.ts`, `pelican.ts`) **and** `server.mjs`.
- **Multi-node docker is node-aware.** Pods live on different Wings nodes;
  the Next.js process only has node 1's local docker daemon. Anything that
  `docker exec`s a pod MUST route by the pod's node: TS routes use
  `src/lib/node-exec.ts` (`execInPod`/`execInPodStdin`), and `server.mjs`
  has a duplicated plain-JS mirror (`dockerInvocation`, the metrics
  sampler's `statsSources`) — for remote nodes it `ssh -tt … docker exec`
  over the Tailscale tailnet. Keep the two in sync. A bare `docker exec`
  against a pod silently breaks for every node-2+ pod. Requires
  `PELICAN_NODE_TAILSCALE_IPS` (`2:100.92.124.106,…`) + node-1→node-N SSH
  keys; see `infra/TAILSCALE.md`.
- **Runs in production only on the VM** because the WS routes require Docker
  access and a real Pelican panel. Local `pnpm dev` works for UI only;
  terminal/metrics will fail without `PELICAN_URL`, `PELICAN_API_KEY`, and a
  reachable docker daemon.
- **Required env** (server refuses to start without `SESSION_SECRET`):
  `SESSION_SECRET`, `PELICAN_URL`, `PELICAN_API_KEY`, `PELICAN_USER_ID`,
  `PELICAN_NODE_ID`, `PELICAN_HERMES_EGG_ID`, `PELICAN_HERMES_IMAGE`,
  optional `PODS_DB_PATH` (default `./data/pods.db`), `PORT`, `HOST`.
- **SQLite via `better-sqlite3`** at `frontend/data/pods.db` (WAL mode, files
  committed are runtime artifacts on the VM — don't edit by hand). Together
  with `node-pty` these are the only native deps; pnpm is configured with
  `onlyBuiltDependencies: [better-sqlite3, node-pty]`, so `pnpm install
  --ignore-scripts` will produce a non-working install.
- **pnpm** is the package manager (lockfile + `pnpm-workspace.yaml` present
  even though there is currently a single package).

## Pelican / Wings gotchas

- Allocations must bind to `0.0.0.0`, never the public IP — Azure VMs don't
  have the public IP on the NIC and `docker -p <pub-ip>:port` fails. Any
  script creating allocations must follow this.
- Wings reads `/etc/pelican/config.yml`; regenerate via
  `php artisan p:node:configuration <id>` inside the `pelican-panel-1`
  container (see README). Wings also needs the panel's Let's Encrypt cert
  copied to `/etc/letsencrypt/live/<fqdn>/` — `infra/scripts/sync-cert.sh`
  does this and runs from a daily cron.
- Pod data lives in `/srv/pods/wings/volumes/<full-uuid>/`; the docker
  container is named after the same full uuid (this is what `server.mjs`
  passes to `docker exec`). UI URLs use the 8-char `uuid_short`.
- Hermes egg install rewrites every `/mnt/server` path to `/home/container`
  (shebangs, symlinks, editable-install finder, `pyvenv.cfg`). Don't "clean
  up" those `sed` lines — Pelican installs into `/mnt/server` but the
  runtime container mounts the volume at `/home/container`.

## Sandbox image — everything must be baked at build time

Runtime is **read-only rootfs + no_new_privileges + neutered sudo**, so `/usr`
system libs CANNOT be apt-installed in a running pod — bake them in
`images/sandbox-ubuntu/Dockerfile`. Now baked: micromamba/uv, Chromium deps,
ffmpeg+libopus0+libsndfile1 (Discord/voice/TTS), libgl1+libglib (CV),
poppler+tesseract (PDF/OCR), libxml2/xslt, libmagic, libpq5, and the common MCP
server npm packages (global, so `npx -y <pkg>` resolves offline).

- **Build is per-node** (multi-node, no registry): rebuild on EACH Wings node,
  tag `pods-ml/sandbox-ubuntu:1.0`. Node 1 context `/srv/pods/images/sandbox-ubuntu`;
  **node 2 has no `/srv/pods`** — rsync the context to `~/sandbox-build` and
  build there. Existing pods need recreate to get new libs.
- **Patching a RUNNING pod with a lib** (no rebuild): `micromamba install` into
  `$HOME`, then add `export LD_LIBRARY_PATH=…` to the writable hermes launcher
  `~/.local/bin/hermes` (first on PATH) before its `exec` — the gateway
  inherits it at start (LD_LIBRARY_PATH must be set at exec, not via `.env`).
  Symlink binaries (e.g. ffmpeg) into `~/.local/bin`.

## Billing — Dodo Payments (replaced Solana)

Env: `DODO_PRODUCT_*`, `DODO_CREDIT_PACK_*`, `DODO_PAYMENTS_API_KEY`,
`DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_ENVIRONMENT`, `PODS_PUBLIC_URL`
(canonical public origin = `https://app.pods.ml`). Webhook =
`/api/billing/webhooks/dodo` (middleware-allowlisted, Svix-verified). Tables
auto-create on boot in `src/lib/db.ts`.

## Operational

- Production host: `pods-ml-prototype.eastus.cloudapp.azure.com`
  (user `podsadmin`). Frontend at `/srv/pods/frontend`, systemd unit
  `pods-ml-frontend`. Deploy = `rsync` + `pnpm install && pnpm build` +
  `systemctl restart` (full sequence in `README.md`).
- Single-tenant prototype: anyone with the URL can deploy a pod; no real
  multi-tenant auth yet. Treat the site as untrusted-internal.
