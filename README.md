# FuelBorn

One-click deployment platform for AI agents, sandboxes, and game servers. Built on Pelican Panel + Wings (Pterodactyl fork) with a custom Next.js frontend.

**Prototype** — first pod type shipped is the **Nous Research Hermes Agent**: a self-improving open-source AI agent ([github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)) installed inside an isolated container with persistent memory, skills, and tool use. Users bring their own LLM provider key (OpenRouter, Nous Portal, etc.).

## Live URLs (prototype)

- **UI**: <http://pods-ml-prototype.eastus.cloudapp.azure.com:3000>
- **Panel** (admin / per-pod console): <https://pods-ml-prototype.eastus.cloudapp.azure.com>

## Architecture

```
Azure VM (Standard_D4s_v5, eastus, Ubuntu 22.04)
├── Next.js frontend           :3000   ← user-facing
├── Pelican Panel (Docker)     :80,443 ← admin UI + REST API + per-pod terminal
│   ├── MariaDB / Redis        (compose)
│   └── Caddy (embedded)       → Let's Encrypt for the FQDN
├── Wings daemon (systemd)     :8080   ← orchestrates Docker pods
└── Per-user pods (Docker)     :25500-25549 (dynamically allocated)
```

## Repo layout

```
.
├── infra/
│   ├── azure-provision.sh    Provisions the Azure VM, NSG, public IP, data disk.
│   ├── pelican/compose.yml   Pelican Panel + MariaDB + Redis stack.
│   ├── wings/wings.service   Systemd unit for Wings.
│   └── scripts/
│       ├── bootstrap.sh       Runs on the VM. Installs Docker, brings up Pelican, installs Wings + Node.
│       ├── sync-cert.sh       Shares the panel's Let's Encrypt cert with Wings.
│       └── frontend.service   Systemd unit for the Next.js frontend.
├── eggs/
│   └── hermes-agent.json     Pelican egg definition for the Hermes Agent pod type.
└── frontend/                  Next.js 16 + Tailwind frontend (the user-facing FuelBorn UI).
```

## Bringing it up from scratch

```bash
# 1. Provision the VM
bash infra/azure-provision.sh

# 2. Copy infra/ to the VM and bootstrap
rsync -avz --rsync-path="sudo rsync" infra/ podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com:/srv/pods-ml-infra/
ssh podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com <<'EOF'
  sudo tee /etc/pods-ml.env <<E
APP_URL=https://pods-ml-prototype.eastus.cloudapp.azure.com
LE_EMAIL=you@example.com
E
  sudo bash /srv/pods-ml-infra/scripts/bootstrap.sh
EOF

# 3. Inside the VM, create admin + node + allocations + import egg + generate API key
#    (see "First-time panel setup" below for the exact artisan/curl commands).

# 4. Deploy frontend
rsync -avz --exclude=node_modules --exclude='.next' --rsync-path="sudo rsync" \
  frontend/ podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com:/srv/pods/frontend/
ssh podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com "
  sudo chown -R podsadmin:podsadmin /srv/pods/frontend
  cd /srv/pods/frontend && pnpm install && pnpm build
  sudo install -m 644 /srv/pods-ml-infra/scripts/frontend.service /etc/systemd/system/pods-ml-frontend.service
  sudo systemctl daemon-reload && sudo systemctl enable --now pods-ml-frontend"
```

## First-time panel setup (one-time, on the VM)

```bash
# Create admin user
sudo docker exec pelican-panel-1 php artisan migrate --force
sudo docker exec pelican-panel-1 php artisan p:user:make \
  --email=you@example.com --username=admin \
  --password='<strong>' --admin=1 --no-interaction

# Create the local Wings node (size limits in MB / %)
sudo docker exec pelican-panel-1 php artisan p:node:make \
  --name=local-wings --description='Local Wings on prototype VM' \
  --fqdn=pods-ml-prototype.eastus.cloudapp.azure.com \
  --public=1 --scheme=https --proxy=0 --maintenance=0 \
  --maxMemory=12000 --overallocateMemory=0 \
  --maxDisk=80000  --overallocateDisk=0 \
  --maxCpu=350     --overallocateCpu=0 \
  --uploadSize=100 \
  --daemonListeningPort=8080 --daemonConnectingPort=8080 --daemonSFTPPort=2022 \
  --daemonBase=/srv/pods/wings/volumes --no-interaction

# Wings: dump the node config, install it, and start the daemon
sudo docker exec pelican-panel-1 php artisan p:node:configuration 1 > /tmp/wings.yml
sudo mv /tmp/wings.yml /etc/pelican/config.yml
sudo chmod 600 /etc/pelican/config.yml
sudo /usr/local/sbin/sync-cert.sh pods-ml-prototype.eastus.cloudapp.azure.com
sudo systemctl enable --now wings

# Allocations: 50 ports, bind on 0.0.0.0 (Azure VMs can't bind to public IPs)
API_KEY=…  # from the next step
curl -sX POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  https://pods-ml-prototype.eastus.cloudapp.azure.com/api/application/nodes/1/allocations \
  -d '{"ip":"0.0.0.0","alias":"pods-ml-prototype.eastus.cloudapp.azure.com","ports":["25500-25549"]}'

# Application API key (for the Next.js frontend to call Pelican)
sudo docker exec pelican-panel-1 php artisan tinker --execute='
$u = App\Models\User::where("email", "you@example.com")->first();
$id = Illuminate\Support\Str::random(16); $tok = Illuminate\Support\Str::random(32);
$perms = []; foreach (App\Models\ApiKey::getPermissionList() as $r) {
  $perms[$r] = App\Services\Acl\Api\AdminAcl::READ | App\Services\Acl\Api\AdminAcl::WRITE; }
App\Models\ApiKey::create([
  "user_id" => $u->id, "key_type" => App\Models\ApiKey::TYPE_APPLICATION,
  "identifier" => $id, "token" => $tok, "memo" => "frontend",
  "permissions" => $perms, "allowed_ips" => [],
]);
echo "TOKEN=" . $id . $tok . PHP_EOL;'

# Import the Hermes egg
content=$(sudo cat eggs/hermes-agent.json | python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin)))")
echo "$content" | sudo docker exec -i pelican-panel-1 php artisan tinker --execute='
$svc = app(App\Services\Eggs\Sharing\EggImporterService::class);
$egg = $svc->fromContent(stream_get_contents(STDIN), App\Enums\EggFormat::JSON);
echo $egg->id;'
```

## Frontend environment

`/srv/pods/frontend/.env.local`:

```
PELICAN_URL=https://pods-ml-prototype.eastus.cloudapp.azure.com
PELICAN_API_KEY=<48-char token from `App\Models\ApiKey::create`>
PELICAN_USER_ID=1
PELICAN_NODE_ID=1
PELICAN_HERMES_EGG_ID=1
PELICAN_HERMES_IMAGE=ghcr.io/pelican-eggs/yolks:debian
```

## User flow

1. Visit the UI URL → fill in LLM provider, API key, model → click **Deploy Hermes Agent**.
2. Frontend POSTs `/api/deploy` server-side; it finds a free allocation and calls Pelican's Application API to create the pod.
3. Wings spins up the install container (debian) and runs `eggs/hermes-agent.json`'s install script: apt deps → official Hermes installer (`scripts/install.sh --skip-setup --dir /mnt/server/hermes-agent`) → rewrites every `/mnt/server` path to `/home/container` (shebangs, symlinks, editable-install finder, `pyvenv.cfg`).
4. Runtime container boots with the installed Hermes Agent + LLM env vars seeded; main process is `tail -f /dev/null` so the user can attach.
5. Frontend redirects to `/pods/<identifier>` and offers "Open Console" → opens the Pelican panel terminal in a new tab.
6. User logs in to the panel once, opens the web terminal, runs `hermes setup` to finalize provider config, then `hermes` for an interactive chat, or `hermes gateway start` to expose it on a messaging platform.

## Operational notes

- Pelican panel data lives in named Docker volumes under `/srv/pods/docker/volumes/` (data disk).
- Wings pod data lives in `/srv/pods/wings/volumes/<uuid>/` (data disk).
- The panel's Let's Encrypt cert is sourced from Caddy in the panel container and exported to `/etc/letsencrypt/live/<fqdn>/` for Wings via `infra/scripts/sync-cert.sh` (daily cron).
- Allocations must use `0.0.0.0` as the bind IP on Azure VMs — the public IP isn't on the NIC, so docker `-p <pub-ip>:port` fails with "cannot assign requested address".
- The Hermes egg requests `disk: 15000` (15 GB) for the install — Node 22 + Python 3.11 + Hermes deps total ~3.5 GB; 5 GB was tight.

## Known limitations (acknowledged for the roadmap)

- Frontend is plain HTTP on port 3000 (TLS only on the panel). Set a real FuelBorn domain with proper SSL before production.
- Single-tenant: anyone with the URL can deploy a pod. Add NextAuth + Pelican user provisioning before public release.
- Single Wings node. To scale: spin up additional Wings VMs and register them as additional Pelican nodes (no app changes needed).
- No GPU pods yet. When adding LLM-inference pods (vLLM serving Hermes 4 70B etc.), switch to a GPU SKU (`Standard_NC4as_T4_v3` minimum) and install `nvidia-container-toolkit`.
