# FuelBorn — VM Infra Notes

Where everything lives across the production fleet, how each piece was
set up, and how to rebuild from scratch.

The companion `RUNBOOK.md` in the repo root walks through the original
prototype bring-up. This file documents *additions* layered on top during
v6/v7/v8/v9 work (lxcfs, Cloudflare wildcard, pod domains, multi-node).

## Fleet

| Node | Public IP | Tailnet IP | VNet IP | Role |
|---|---|---|---|---|
| `pods-ml-prototype` (node 1) | `172.174.92.191` | `100.105.7.103` | `10.0.0.4` | Pelican panel + Wings + Caddy + Next.js |
| `pods-ml-node2` (node 2) | `20.51.150.92` | `100.92.124.106` | `10.0.0.5` | Wings only |

Cross-node networking is via **Tailscale** — see `infra/TAILSCALE.md`
for the full topology, ACL policy, and the runbook to onboard a third
node. `lib/node-exec.ts` (`execInPod` / `execInPodStdin`) is the
node-aware docker exec wrapper every dashboard feature routes through.

## Hosts

| Host | Purpose | DNS |
|---|---|---|
| `pods.ml` apex + `www.pods.ml` | landing (anon) / dashboard (auth) | A → `172.174.92.191` |
| `app.pods.ml` | dashboard (alias of pods.ml; canonical for OAuth callbacks) | A → `172.174.92.191` |
| `pods-ml-prototype.eastus.cloudapp.azure.com` | legacy hostname, kept as fallback | Azure-managed |
| `*.bigcat.pw` | per-pod auto-domains (wildcard cert via Cloudflare DNS-01) | A `*` → `172.174.92.191` |
| `inbox.bigcat.pw` | agent mailbox addresses (Resend) | MX → Resend |

Cookie domain for session/OAuth state is `.pods.ml` (set via
`OAUTH_BASE_URL`) so sign-in on any subdomain works on every other one.

---

## Host services + ports

| What | Listens on | Notes |
|---|---|---|
| Caddy (TLS terminator) | 80 / 443 | Binary at `/usr/bin/caddy` (custom build, includes `caddy-dns/cloudflare`). |
| pods-ml-frontend (Next.js custom server) | 127.0.0.1:3000 | systemd unit at `/etc/systemd/system/pods-ml-frontend.service`. |
| Pelican panel (Docker compose) | 127.0.0.1:8000 → container | Routed through Caddy under `/admin`, `/api/application/*`, etc. |
| Pelican Wings | 127.0.0.1:8080 (panel↔wings) + 2022 (SFTP) | Stock systemd unit + a `Requires=lxcfs.service` override (see below). |
| lxcfs | `/var/lib/lxcfs/proc/*` FUSE | apt-installed; service `lxcfs.service`. |
| Docker bridge | `172.18.0.0/16` | Each pod container gets a per-container IP on this network. |

---

## Repo ⇄ VM file map

This repo holds the **authoritative copies**. Every infra file installed
on the VM has a mirror here. Restore on a fresh box by rsync'ing into
the canonical path, then doing the one-shot install commands listed at
the bottom.

| Repo path | VM path | Owner / mode |
|---|---|---|
| `infra/caddy/Caddyfile` | `/etc/caddy/Caddyfile` | root:root 0644 |
| `infra/caddy/cloudflare.env.example` | (manual copy of secret →) `/etc/caddy/cloudflare.env` | root:caddy 0640 |
| `infra/caddy/systemd/cloudflare.conf` | `/etc/systemd/system/caddy.service.d/cloudflare.conf` | root:root 0644 |
| `infra/wings/wings.service` | `/etc/systemd/system/wings.service` | root:root 0644 |
| `infra/scripts/bootstrap.sh` | run once on a fresh VM | — |
| `infra/scripts/frontend.service` | `/etc/systemd/system/pods-ml-frontend.service` | root:root 0644 |
| `infra/scripts/pods-ml-domain` | `/usr/local/sbin/pods-ml-domain` | root:root 0755 |
| `infra/scripts/sync-cert.sh` | `/usr/local/sbin/sync-cert.sh` | root:root 0755 |
| `infra/sudoers.d/pods-ml-domain` | `/etc/sudoers.d/pods-ml-domain` | root:root 0440 |
| `images/sandbox-ubuntu/{Dockerfile,pod-gateway,pods-ml-pod-init.sh}` | rsync'd to `/srv/pods/images/sandbox-ubuntu/`, then `docker build -t pods-ml/sandbox-ubuntu:1.0 .` | — |
| `eggs/hermes-agent.json` | imported into Pelican via `php artisan tinker` (re-imports update egg id 2) | — |

`/etc/caddy/cloudflare.env` is **not** in this repo — the actual API
token must be re-minted on Cloudflare. See "Cloudflare token" below.

---

## lxcfs (virtualised `/proc` inside containers)

Containers see cgroup-enforced memory / CPU / uptime instead of host
totals. Without lxcfs, `free`, `top`, JVM heap sizing, Node's
`os.totalmem`, fastfetch all lie.

```sh
sudo apt install -y lxcfs                          # idempotent
sudo systemctl enable --now lxcfs
```

Wings needs to be ordered after lxcfs so the host's
`/var/lib/lxcfs/proc/*` files are available before Wings tries to mount
them into a fresh container. Already in `infra/wings/wings.service`:

```
After=docker.service lxcfs.service
Requires=docker.service lxcfs.service
```

The seven mount rows are inserted into Pelican's `mounts` table; each
new pod has them attached to its `mountables` polymorphic relation by
`/api/deploy` (`PODS_LXCFS_MOUNT_IDS` env, defaults `1,2,3,4,5,6,7`).
Wings reads the server config and bind-mounts them into the container
at create time.

Wings allowlist (`/etc/pelican/config.yml` → `allowed_mounts`):

```yaml
allowed_mounts:
  - /var/lib/lxcfs/proc/cpuinfo
  - /var/lib/lxcfs/proc/meminfo
  - /var/lib/lxcfs/proc/diskstats
  - /var/lib/lxcfs/proc/swaps
  - /var/lib/lxcfs/proc/uptime
  - /var/lib/lxcfs/proc/stat
  - /var/lib/lxcfs/proc/loadavg
```

Adding lxcfs to an existing pod = recreate the container (stop + docker
rm + start). The bind volume at `/home/container` survives; anything
`apt`-installed inside the old container is wiped.

---

## Cloudflare token (DNS-01 wildcard cert)

`bigcat.pw` is on Cloudflare. Wildcard TLS for `*.bigcat.pw` is solved
via Cloudflare DNS-01.

**Mint a token** (one-time, or whenever rotating):

1. Cloudflare → My Profile → API Tokens → Create Token.
2. Template: **Edit zone DNS**.
3. Zone Resources: Include → Specific zone → `bigcat.pw`.
4. Save.

**Install on the VM**:

```sh
printf 'CF_API_TOKEN=%s\n' '<token>' | \
  sudo tee /etc/caddy/cloudflare.env > /dev/null
sudo chown root:caddy /etc/caddy/cloudflare.env
sudo chmod 0640 /etc/caddy/cloudflare.env
sudo systemctl daemon-reload   # if the drop-in is new
sudo systemctl restart caddy
```

Caddy's systemd drop-in (`/etc/systemd/system/caddy.service.d/cloudflare.conf`)
loads it as `EnvironmentFile`. The Caddyfile references it as
`{env.CF_API_TOKEN}`.

**Verify**:

```sh
curl -s https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer $(sudo grep CF_API_TOKEN /etc/caddy/cloudflare.env | cut -d= -f2)" \
  | jq .success
# → true
```

---

## Caddy build (cloudflare-dns plugin)

The stock Caddy from apt doesn't include `caddy-dns/cloudflare`. Rebuild
with xcaddy.

```sh
# install build deps
sudo apt install -y xcaddy
curl -fsSL https://go.dev/dl/go1.23.4.linux-amd64.tar.gz | \
  sudo tar -C /usr/local -xz
export PATH=/usr/local/go/bin:$PATH

# build
cd /tmp
xcaddy build --with github.com/caddy-dns/cloudflare

# swap atomically
sudo cp /usr/bin/caddy /usr/local/bin/caddy.pre-cloudflare.bak
sudo install -m 0755 /tmp/caddy /usr/bin/caddy
sudo systemctl restart caddy
```

Verify the plugin is loaded:

```sh
caddy list-modules | grep cloudflare
# → dns.providers.cloudflare
```

---

## Caddy wildcard + per-pod-domain mechanism

`infra/caddy/Caddyfile` (mirrored to `/etc/caddy/Caddyfile`):

- `{$APP_HOST}` block — Pelican panel routes + Next.js frontend.
- `*.bigcat.pw` block — wildcard cert via DNS-01,
  `import /etc/caddy/domains/*.caddy`, default 404 fallback.

**Per-domain includes** are written by `/usr/local/sbin/pods-ml-domain`:

```sh
/usr/local/sbin/pods-ml-domain add <slug> <container-ip> <port>
/usr/local/sbin/pods-ml-domain remove <slug>
```

Each `add` writes a file like `/etc/caddy/domains/quiet-otter-7f3a.caddy`:

```caddyfile
@quiet-otter-7f3a host quiet-otter-7f3a.bigcat.pw
handle @quiet-otter-7f3a {
	reverse_proxy 172.18.0.12:8080
}
```

…then runs `systemctl reload caddy`. The container IP comes from
`docker inspect <uuid> --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'`.

The helper validates **slug** (DNS label regex), **IP** (must be
`172.16.0.0/12`, the docker bridge range), and **port** (1-65535).
That's the only privileged path the Next.js frontend has — via the
sudoers grant at `infra/sudoers.d/pods-ml-domain`:

```
podsadmin ALL=(root) NOPASSWD: /usr/local/sbin/pods-ml-domain
```

**Source of truth** is the SQLite table `pod_domains` in
`/srv/pods/frontend/data/pods.db`. The `.caddy` files on disk are
derived state — if they ever drift, regenerate from the DB:

```sh
node -e '
  const db = require("better-sqlite3")("/srv/pods/frontend/data/pods.db");
  const { execFileSync } = require("child_process");
  for (const r of db.prepare("SELECT slug, container_ip, port FROM pod_domains").all()) {
    execFileSync("sudo", ["-n", "/usr/local/sbin/pods-ml-domain", "add",
      r.slug, r.container_ip, String(r.port)]);
  }
'
```

---

## DNS records (Cloudflare → bigcat.pw)

| Type | Name | Content | Proxy | TTL |
|---|---|---|---|---|
| A | `*` | `172.174.92.191` | DNS only | Auto |
| A | `app` | `172.174.92.191` | DNS only | Auto |

**Gray cloud / DNS only is required.** Orange-cloud proxy mode breaks
the wildcard cert flow (Cloudflare would intercept HTTPS).

---

## Pelican egg (Hermes Agent)

`eggs/hermes-agent.json` — re-import via tinker after edits:

```sh
sudo docker cp eggs/hermes-agent.json pelican-panel-1:/tmp/egg.json
sudo docker exec pelican-panel-1 php artisan tinker --execute '
  use App\Services\Eggs\Sharing\EggImporterService;
  $svc = app(EggImporterService::class);
  $egg = $svc->fromContent(file_get_contents("/tmp/egg.json"));
  echo "egg id=" . $egg->id;
'
```

Current production egg id is **2** (id 1 was the pre-pre-install
version; v6+ deploys target egg 2 via
`PELICAN_HERMES_EGG_ID=2` in `/srv/pods/frontend/.env.local`).

The egg's install script (inside the JSON) now also:
- Pre-installs the WhatsApp bridge `node_modules` (in the install
  container's larger memory budget — runtime OOMs at 2 GB).
- Seeds `~/.hermes/config.yaml` with
  `model.provider`, `auxiliary.compression.provider: main`.

---

## Frontend `.env.local` keys (`/srv/pods/frontend/.env.local`)

| Key | Purpose |
|---|---|
| `PELICAN_URL` | Panel base URL (FQDN). |
| `PELICAN_API_KEY` | Pelican Application API key. |
| `PELICAN_USER_ID` | Admin user id (for server creation by Wings deps). |
| `PELICAN_NODE_ID` | Wings node id. |
| `PELICAN_HERMES_EGG_ID` | Egg id new pods are built from (currently `2`). |
| `PELICAN_HERMES_IMAGE` | Override the default container image (currently `pods-ml/sandbox-ubuntu:1.0`). |
| `SESSION_SECRET` | HMAC key for our session cookies. Rotating invalidates all sessions. |
| `NODE_ENV=production` | Required — `server.mjs` checks this. |
| `PODS_LXCFS_MOUNT_IDS` | Optional, defaults `1,2,3,4,5,6,7`. Pelican mount row IDs to auto-attach on new pods. |
| `PODS_DOMAIN_ROOT` | Optional, defaults `bigcat.pw`. Used by the domains feature for slug suffixing. |
| `RESEND` | **pods.ml** Resend account key — platform/transactional mail (signup + reset OTPs, billing), sent from `@pods.ml` (`AUTH_FROM_EMAIL`). |
| `RESEND_AGENTS` | **bigcat.pw** Resend account key — per-pod *agent* mailboxes: outbound `<slug>@inbox.bigcat.pw` + inbound MIME fetch. **Separate Resend account** from `RESEND`; falls back to `RESEND` if unset. The two domains are verified in different accounts, so they need different keys — a single key 403s on the domain it doesn't own. |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret for the inbound email webhook (the bigcat.pw/agents account). |
| `EMAIL_DOMAIN` | Agent mailbox domain, default `inbox.bigcat.pw`. |
| `AUTH_FROM_EMAIL` | Platform from-address, default `pods.ml <hello@pods.ml>` (must be verified in the `RESEND` account). |

**Never rsync `.env.local`** — always `--exclude .env.local` in the
sync commands so a missing key on the dev machine doesn't blank the VM
copy.

---

## SQLite tables in `/srv/pods/frontend/data/pods.db`

| Table | What |
|---|---|
| `users` | Local auth: email/password hash, mapped Pelican user id, client token. |
| `pod_metrics` | 24h rolling history of docker-stats samples (5s cadence). |
| `pod_domains` | slug → (pod, port) mapping for the wildcard subdomain feature. |

All three are created idempotently in both `frontend/server.mjs` (the
custom Next.js server) and `frontend/src/lib/db.ts` (so API routes also
see them in dev / route-handler isolation contexts).

---

## One-shot bring-up on a fresh VM

After running `infra/scripts/bootstrap.sh` (Docker + Caddy + Pelican
panel + Wings install), the additions for v8 are:

```sh
# 1. lxcfs
sudo apt install -y lxcfs
sudo systemctl enable --now lxcfs

# 2. Wings systemd ordering (After=lxcfs.service Requires=lxcfs.service)
sudo cp infra/wings/wings.service /etc/systemd/system/wings.service
sudo systemctl daemon-reload
sudo systemctl restart wings

# 3. Pelican mount rows + Wings allowed_mounts (one-time)
#    See infra/INFRA.md "lxcfs" section — adapt via panel UI or tinker.

# 4. Custom Caddy with cloudflare-dns
sudo apt install -y xcaddy
curl -fsSL https://go.dev/dl/go1.23.4.linux-amd64.tar.gz | sudo tar -C /usr/local -xz
PATH=/usr/local/go/bin:$PATH xcaddy build --with github.com/caddy-dns/cloudflare
sudo install -m 0755 ./caddy /usr/bin/caddy

# 5. Caddy systemd drop-in for the CF token
sudo install -d -m 0755 /etc/systemd/system/caddy.service.d
sudo cp infra/caddy/systemd/cloudflare.conf /etc/systemd/system/caddy.service.d/cloudflare.conf

# 6. CF API token (interactive — mint on dashboard.cloudflare.com)
printf 'CF_API_TOKEN=%s\n' '<paste>' | sudo tee /etc/caddy/cloudflare.env >/dev/null
sudo chown root:caddy /etc/caddy/cloudflare.env
sudo chmod 0640 /etc/caddy/cloudflare.env

# 7. Caddyfile with the wildcard block + domains include dir
sudo cp infra/caddy/Caddyfile /etc/caddy/Caddyfile
sudo install -d -m 0755 -o root -g caddy /etc/caddy/domains

# 8. Domain helper + sudoers
sudo install -m 0755 -o root -g root infra/scripts/pods-ml-domain /usr/local/sbin/pods-ml-domain
sudo install -m 0440 -o root -g root infra/sudoers.d/pods-ml-domain /etc/sudoers.d/pods-ml-domain
sudo visudo -c -f /etc/sudoers.d/pods-ml-domain   # sanity check

sudo systemctl daemon-reload
sudo systemctl restart caddy
```

After that:

- Add Cloudflare A records: `*` and `app` → VM IP, DNS only.
- Visit `https://anything.bigcat.pw/` → expect Caddy's 404 "this domain
  is not mapped to a container yet".
- Deploy a pod via the dashboard → it auto-gets a domain.

---

## Known operator footguns

- **Don't rsync `.env.local`.** It clobbers prod-only keys (`SESSION_SECRET`,
  `NODE_ENV=production`, the right `PELICAN_HERMES_EGG_ID`).
- **Don't change `/etc/caddy` directory perms to 0700.** It locks out the
  `caddy` user — Caddy can't read the Caddyfile and refuses to start.
  Keep it `0755 root:caddy`.
- **Don't restart Wings without lxcfs already up.** Containers brought up
  during that window will be missing the bind mounts (cgroup-correct
  `/proc/*`) until they're individually recreated. The systemd
  `Requires=` line prevents this on reboots; manual `systemctl restart`
  with lxcfs stopped will not.
- **CF token rotation** — re-mint, overwrite `/etc/caddy/cloudflare.env`,
  `systemctl restart caddy`. Wildcard cert renewals re-use the token.
- **Domain `.caddy` file orphans** — if the DB and `/etc/caddy/domains/`
  drift, the source of truth is the DB. See the regen one-liner above.

---

## Quick smoke tests

```sh
# Frontend healthy
curl -sk -o /dev/null -w "%{http_code}\n" \
  https://pods-ml-prototype.eastus.cloudapp.azure.com/login            # 200

# Wildcard cert + Caddy fallback
curl -sk -o /dev/null -w "%{http_code}\n" \
  https://does-not-exist.bigcat.pw/                                    # 404

# CF token still valid
curl -s https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer $TOKEN" | jq .success                      # true

# Pod has lxcfs mounts
docker inspect <pod-uuid> --format '{{range .Mounts}}{{.Destination}}{{println}}{{end}}' \
  | grep /proc                                                          # several /proc/* entries
```
