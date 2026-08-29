# Tailscale — cross-node networking for FuelBorn

Tailscale gives us a tailnet that lets every Wings node reach every
other Wings node on a private IP, plus lets the Next.js process on
node 1 reach docker daemons on other nodes for cross-node management
(console, files, skills, persona, etc.).

## Why

The frontend's dashboard does a lot of `docker exec <full-uuid>` against
the pod's container. That only works on the host where the Next.js
process runs (node 1). For pods that land on node 2 we'd otherwise have
no way to manage them from the dashboard.

`lib/node-exec.ts` reads which Wings node owns a pod (from Pelican's
`/servers/<uuid>.attributes.node`), then routes the docker subcommand
either to the local daemon (node 1) or to `ssh podsadmin@<tailnet-ip>
docker …` (any other node). The tailnet IP is stable, private, and
authenticated.

## Topology

```
                 ┌────────────────────┐
                 │ Tailscale tailnet  │
                 │  (100.64.0.0/10)   │
                 └─────────┬──────────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
  ┌──────────────────────┐  ┌──────────────────────┐
  │ node 1               │  │ node 2               │
  │ pods-ml-prototype    │  │ pods-ml-node2        │
  │  100.105.7.103       │  │  100.92.124.106      │
  │  10.0.0.4 (vnet)     │  │  10.0.0.5 (vnet)     │
  │  172.174.92.191 pub  │  │  20.51.150.92 pub    │
  ├──────────────────────┤  ├──────────────────────┤
  │ Next.js + Pelican    │  │ (Wings only)         │
  │ Wings node id = 1    │  │ Wings node id = 2    │
  │ Caddy 80/443         │  │ —                    │
  │ docker bridge:       │  │ docker bridge:       │
  │   pelican_nw         │  │   pelican_nw         │
  │   172.18.0.0/16      │  │   172.21.0.0/16      │
  └──────────────────────┘  └──────────────────────┘
```

Why two different docker bridge subnets (`172.18.x.x` on node 1,
`172.21.x.x` on node 2)? Tailscale subnet routing requires the
advertised CIDRs to be non-overlapping — if both nodes claimed
`172.18.0.0/16`, the tailnet couldn't decide which node owns a given
container IP. Node 2's Wings config (`/etc/pelican/config.yml`) was
patched to use `172.21.0.0/16` for its bridge; the docker daemon's
`default-address-pools` matches.

## Auth keys

Generated from <https://login.tailscale.com/admin/settings/keys>. We use
**reusable** auth keys (toggle on) so the same key works for node 1,
node 2, and any future node addition. Not ephemeral (we want the node
to persist across reboots).

Stored in `infra/CREDS.md` (gitignored).

## ACL — auto-approve docker bridge routes

Add this to <https://login.tailscale.com/admin/acls/file> so any future
node's `--advertise-routes` is approved automatically:

```json
{
  "acls": [
    { "action": "accept", "src": ["*"], "dst": ["*:*"] }
  ],
  "autoApprovers": {
    "routes": {
      "172.0.0.0/8": ["autogroup:admin"]
    }
  }
}
```

`172.0.0.0/8` covers every docker private subnet we'll ever advertise
(172.16–172.31 is reserved for private networks).

## Onboarding a new node — copy-paste runbook

Assuming a fresh Ubuntu 22.04 host with passwordless sudo:

```bash
# 1. Pick a docker bridge subnet not used by an existing node. Look in
#    /etc/pelican/config.yml on each existing node under docker.network.
#    Examples currently in use: 172.18.0.0/16 (node 1), 172.21.0.0/16
#    (node 2). Next node uses 172.22.0.0/16.
SUBNET=172.22.0.0/16
GATEWAY=172.22.0.1

# 2. Install Docker + Wings
curl -fsSL https://get.docker.com | sudo sh
sudo curl -L -o /usr/local/bin/wings \
  "https://github.com/pelican-dev/wings/releases/latest/download/wings_linux_amd64"
sudo chmod +x /usr/local/bin/wings

# 3. Mount the data disk (if any) at /var/lib/pelican before Wings starts.

# 4. Tailscale
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up \
  --authkey=tskey-auth-xxxxxxxxx \
  --hostname=pods-ml-nodeN \
  --advertise-routes=${SUBNET} \
  --accept-routes

# 5. SSH key from node 1 → this node (for execInPod)
ssh podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com \
  'cat /home/podsadmin/.ssh/id_ed25519.pub' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 6. Register node in Pelican (run from node 1 or anywhere with the
#    Application API key). See API call below.

# 7. Pull node config + write to /etc/pelican/config.yml, patch its
#    docker.network block so the v4 subnet matches $SUBNET above:
#       interface: 172.22.0.1
#       interfaces.v4.subnet: 172.22.0.0/16
#       interfaces.v4.gateway: 172.22.0.1
sudo systemctl enable --now wings
```

Pelican API call from node 1 to create the new node:

```bash
PELICAN_URL=$(grep '^PELICAN_URL=' /srv/pods/frontend/.env.local | cut -d= -f2-)
PELICAN_KEY=$(grep '^PELICAN_API_KEY=' /srv/pods/frontend/.env.local | cut -d= -f2-)
curl -X POST "${PELICAN_URL}/api/application/nodes" \
  -H "Authorization: Bearer ${PELICAN_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pods-ml-nodeN",
    "location_id": 1,
    "fqdn": "<tailnet-ip-of-new-node>",
    "scheme": "http",
    "memory": 12000,
    "memory_overallocate": 0,
    "disk": 80000,
    "disk_overallocate": 0,
    "cpu": 350,
    "cpu_overallocate": 0,
    "daemon_listen": 8080,
    "daemon_connect": 8080,
    "daemon_sftp": 2022,
    "upload_size": 100,
    "behind_proxy": false,
    "public": true,
    "maintenance_mode": false,
    "daemon_base": "/var/lib/pelican/volumes"
  }'
```

Then GET `/api/application/nodes/<id>/configuration` for the wings
config token + paste into `/etc/pelican/config.yml`.

After Wings starts: from node 1, `tailscale ping pods-ml-nodeN` should
pong. Then add the node to the frontend env:

```bash
# /srv/pods/frontend/.env.local
PELICAN_NODE_IDS=1,2,3
PELICAN_NODE_TAILSCALE_IPS=2:100.92.124.106,3:100.x.x.x
```

`pnpm build && sudo -n systemctl restart pods-ml-frontend`.

## Verifying

```bash
# tailscale connectivity (both directions)
sudo tailscale ping pods-ml-node1   # from node 2
sudo tailscale ping pods-ml-node2   # from node 1

# docker exec over tailnet
ssh podsadmin@100.92.124.106 docker ps           # from node 1 → node 2
ssh podsadmin@100.105.7.103 docker ps            # from node 2 → node 1

# Pelican panel: node should appear green on the admin /admin/nodes page
```

## Verified end-to-end on 2026-05-23

Created a real Hermes pod on node 2 via the Pelican API
(`uuid_short=63936f47`, `node=2`), waited for install, started it,
then ran every cross-node helper against it from node 1:

| Path | Result |
|---|---|
| `getPodNodeId(uuid)` → Pelican lookup | returns `2` ✓ |
| `docker inspect` over SSH-tailnet (getContainerIp) | returns `172.21.1.2` ✓ |
| `docker exec bash -lc "head SOUL.md"` (readPersona) | reads `# Hermes Agent Persona` ✓ |
| `find /home/container/.hermes/skills` (listInstalled) | 81 SKILL.md files ✓ |
| `cat .env` (readEnv → connector saves, email tab) | works ✓ |
| stdin pipe write via SSH (writePersona, sanitizer install) | round-trip ✓ |
| `docker restart` over SSH-tailnet (restartPod) | succeeds ✓ |

The dashboard tabs (Console, Files, Skills, Persona, MCP, Email,
Connectors, Webhook events) all work for node-2 pods via this path.

## Cross-node Caddy auto-domain (resolved 2026-05-23)

The original gap: Caddy on node 1 proxying directly to `172.21.x.x`
container IPs on node 2 **doesn't work**. We diagnosed the root
cause — tailscale's subnet routes deliver inbound subnet packets to
the `INPUT` chain (treated as locally addressed) rather than `FORWARD`,
so no amount of `DOCKER-USER` / `FORWARD` ACCEPT rules can fix it.
Bridge gateway IPs (172.18.0.1, 172.21.1.1) are reachable, container
IPs aren't.

### Architecture

Two-tier Caddy with the inner hop over the tailnet:

```
                client
                  │ HTTPS
                  ▼
       node 1 Caddy (TLS, *.bigcat.pw)
       /etc/caddy/domains/<slug>.caddy
        ├─ slug for node-1 pod  → reverse_proxy 172.18.x.x:port
        └─ slug for node-2 pod  → reverse_proxy 100.92.124.106:80
                                                │ HTTP (plain) over tailnet
                                                ▼
                                node 2 Caddy (:80, admin-only-localhost)
                                /etc/caddy/domains/<slug>.caddy
                                 └─ same path-routed include →
                                    reverse_proxy 172.21.x.x:port
```

### What's installed where

| Host | Component | Notes |
|---|---|---|
| node 1 | Caddy (existing) | terminates TLS for `*.bigcat.pw` + `pods.ml` + `app.pods.ml` |
| node 1 | `/usr/local/sbin/pods-ml-domain` | writes both `add-multi` (for node-1 pods) and `add-multi-remote` (pass-through to a sibling node's tailnet IP) |
| node 2 | Caddy (new, HTTP only on `:80`) | `auto_https off`, admin on localhost:2019 (needed for reload), tailnet-only in practice (NSG blocks public :80) |
| node 2 | `/usr/local/sbin/pods-ml-domain` | same script, writes `add-multi` includes pointing at local `172.21.x.x` IPs |
| node 2 | `/etc/sudoers.d/pods-ml-domain` | `podsadmin ALL=(root) NOPASSWD: /usr/local/sbin/pods-ml-domain` |

### How the frontend writes both sides

`lib/domains.ts` resolves `getPodNodeId(uuid)` on every `addCaddyDomain*`
call. If the pod lives off-node, it runs the helper twice:

1. SSH-over-tailnet to the pod's node: `pods-ml-domain add-multi
   <slug> <local-container-ip>`
2. Locally: `pods-ml-domain add-multi-remote <slug> <tailnet-ip>`

Removes hit every known node (idempotent — helper does `rm -f`).

### Verification

End-to-end on `<slug>.bigcat.pw` for a node-2 pod returns the correct
status code from the container (or `502` if Hermes isn't running yet),
with a single Caddy log line on each node confirming the hop.

## Files / env vars touched

- `/etc/pelican/config.yml` (node 2) — `docker.network.interfaces.v4`
  patched to `172.21.0.0/16`
- `frontend/src/lib/node-exec.ts` — `execInPod` / `execInPodStdin`
  helpers (the routing core)
- `frontend/src/lib/*` (`pod-config`, `sanitizer`, `persona`,
  `hermes-skills`, `domains`) — route their docker exec through
  `node-exec`
- `frontend/src/app/api/pods/[uuid]/{fs,mcp,connectors,minecraft}/…`
  route handlers — go through `node-exec` too. (Originally these still
  hit the local daemon, so Console/Files/Stats/MCP/Connectors/Minecraft
  silently broke for node-2 pods even though the lib/* helpers worked;
  fixed by wiring every per-pod docker call through `node-exec`.)
- `frontend/server.mjs` — `dockerInvocation` + the metrics sampler's
  `statsSources`: a plain-JS mirror of `node-exec` (the unbundled custom
  server can't import the TS module). Powers the node-aware terminal,
  whatsapp-pair PTY, and multi-node `docker stats`.
- `/srv/pods/frontend/.env.local` — `PELICAN_NODE_IDS`,
  `PELICAN_NODE_TAILSCALE_IPS`, `PODS_NODE_SSH_USER`
- `/home/podsadmin/.ssh/id_ed25519` (node 1) — SSH key, public side in
  `/home/podsadmin/.ssh/authorized_keys` on every other node
