# RUNBOOK — Hermes Agent integration manual e2e

This runbook is the manual smoke test for the v4 Hermes egg + multi-provider
frontend rewrite. It exists because the agent that wrote the code can't reach
the Azure VM, Pelican panel, or the Wings-managed Docker daemon, so the entire
end-to-end path has to be exercised by a human after `rsync`-ing the new files
to the host.

Production target: `pods-ml-prototype.eastus.cloudapp.azure.com`
(user: `podsadmin`, frontend at `/srv/pods/frontend`,
egg at `/srv/pods/eggs/hermes-agent.json`).

What changed (high level):

- New egg env-var schema: `HERMES_INFERENCE_PROVIDER`, `HERMES_INFERENCE_MODEL`
  + per-provider `PODS_KEY_*` placeholders. Old `LLM_PROVIDER`/`LLM_API_KEY`/
  `LLM_MODEL` are gone.
- Install script now seeds `~/.hermes/.env` from every `PODS_KEY_*` env it sees
  and writes `~/.hermes/config.yaml` with `model.default`.
- Frontend has 30+ providers grouped (Recommended / Popular / Regional /
  Enterprise / Custom), per-provider field sets (Basic + Advanced), generic
  model-list endpoint driver, OAuth/CLI handoff cards, and a generic connector
  catalog (Telegram, Discord, Slack, Mattermost, Matrix, Google Chat, Feishu,
  WeCom, DingTalk, QQ Bot, Yuanbao, Home Assistant, Open WebUI, Email, Signal,
  WhatsApp, BlueBubbles, plus oauth/infra cards).
- `FuelBorn inference` provider rendered as a "coming soon" placeholder.
- New `POST /api/pods/:uuid/provider` route to switch provider on a running pod
  from the Settings tab.

## 0. Pre-flight

On your laptop:

```sh
cd ~/Development/FuelBorn
git status   # confirm only intended files in working tree
ls eggs/hermes-agent.json frontend/src/lib/{providers,connectors}.ts
```

Confirm the build is green locally:

```sh
cd frontend && pnpm install && pnpm build
```

(Native deps `better-sqlite3` and `node-pty` must build — `pnpm install
--ignore-scripts` will silently produce a non-working install. See
`AGENTS.md`.)

## 1. Push the new egg into the panel

```sh
rsync -avz eggs/hermes-agent.json \
  podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com:/srv/pods/eggs/

ssh podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com '
  docker exec pelican-panel-1 php artisan tinker --execute="
    use App\Services\Eggs\Sharing\EggImporterService;
    \$svc = app(EggImporterService::class);
    \$egg = \$svc->fromFile(new \Illuminate\Http\UploadedFile(
      \"/srv/pods/eggs/hermes-agent.json\", \"hermes-agent.json\"
    ));
    echo \"egg id: \" . \$egg->id . PHP_EOL;
  "
'
```

Note the egg id printed; if it differs from `PELICAN_HERMES_EGG_ID` in the
frontend's `/srv/pods/frontend/.env.local`, update that env var and restart
the systemd unit.

Sanity-check the variable list in the panel UI:
`https://<panel-host>/admin/eggs/<id>` → confirm it lists
`HERMES_INFERENCE_PROVIDER`, `HERMES_INFERENCE_MODEL`, and the `PODS_KEY_*`
entries (they should be `user_viewable=false`).

## 2. Deploy the frontend

```sh
rsync -avz --delete \
  --exclude .next --exclude node_modules --exclude data \
  frontend/ podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com:/srv/pods/frontend/

ssh podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com '
  cd /srv/pods/frontend &&
  pnpm install &&
  pnpm build &&
  sudo systemctl restart pods-ml-frontend &&
  sleep 2 &&
  systemctl status --no-pager pods-ml-frontend
'
```

Open `https://pods-ml-prototype.eastus.cloudapp.azure.com/` and log in.

## 3. Smoke test — Basic deploy (OpenRouter)

1. On the home page, pick provider **OpenRouter**, paste a real key, leave
   model on default. Submit.
2. Wait for redirect to `/pods/<short-uuid>`. The status pill should flip from
   `installing…` to `running` within ~3 min.
3. **Console tab**: a shell prompt should appear. Run:
   ```
   cat ~/.hermes/.env
   cat ~/.hermes/config.yaml
   hermes
   ```
   - `.env` must contain `HERMES_INFERENCE_PROVIDER=openrouter` and
     `OPENROUTER_API_KEY=<your key>` (plus optionally `OPENAI_BASE_URL=` if
     blank).
   - `config.yaml` must contain `model.default: nousresearch/hermes-3-llama-3.1-70b`.
   - `hermes` should drop into a chat without printing the
     `No inference provider configured` error. Type `hi`, expect a model reply.
4. **Stats tab**: should show non-zero CPU / memory after a few seconds.
5. **Settings tab**: confirm "LLM provider" reads `openrouter` and the
   ProviderSettings form is rendered. **Do not save** yet.

## 4. Smoke test — provider switch via Settings

In the same pod's Settings tab:

1. Change provider to **Anthropic (API key)**, paste a Claude key, pick a
   model (the model dropdown should populate from `api.anthropic.com/v1/models`).
2. Click **Save provider** → expect green confirmation.
3. Console tab → `cat ~/.hermes/.env` should now contain
   `HERMES_INFERENCE_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=…`. The old
   `OPENROUTER_API_KEY` line should still be there (we don't blow away other
   keys, only the ones this provider declares).
4. Run `hermes` again, send a prompt, confirm Claude responds.

## 5. Smoke test — handoff providers

Pick **Anthropic OAuth (Claude Max plan)** in the Settings provider dropdown.
The form should disappear and an amber "Setup requires the pod terminal" card
should be shown with the `hermes setup` instructions. Save button must be
disabled. (No state change on the server.)

Repeat with **Google Gemini CLI** and **GitHub Copilot (ACP CLI)** to confirm
all three handoff modes render the hint correctly.

The **FuelBorn inference (coming soon)** option must render a "Coming soon"
amber card with the disabled save button.

## 6. Smoke test — Connectors tab

### Telegram (token-based)

1. Create a bot via `@BotFather`.
2. In Connectors → Telegram, paste the bot token + your Telegram user ID
   (comma-separated).
3. Status pill should flip to `running` within 8 s (the next refresh poll).
4. Message your bot from Telegram, expect Hermes to reply.

### Discord (token-based)

Repeat with a Discord bot token from `discord.com/developers/applications`.
Add the bot to a server first (OAuth2 URL with `bot` + `applications.commands`
scope). Confirm `running` and that the bot replies in DM.

### Slack / Mattermost / Matrix / Google Chat / Email / etc.

Each token-based card should render its own field set with hints. You don't
need to wire each one end-to-end; the smoke check is:

- Pasting the primary credential and saving writes the right keys into
  `~/.hermes/.env` (verify via `cat`).
- `pkill -f hermes.*gateway && hermes gateway start` is implicitly run; the
  status pill flips to `configured, not running` immediately and to `running`
  on next poll.

### OAuth-pairing connectors (WhatsApp, Weixin)

Click **Open Console →** on the WhatsApp card. Pod terminal should focus.
Run `hermes whatsapp`, scan the QR with the WhatsApp linked-devices flow on
your phone. Connector card should now show `paired` after the next status
refresh (the gateway picks up `WHATSAPP_SESSION` from `.env`).

### Infra-TODO cards

Telegram (webhook mode), generic Webhooks, SMS via Twilio, LINE,
Microsoft Teams, Teams Meetings, BlueBubbles (webhook), WeCom Callback —
each should render a dashed-border "infra TODO" card explaining that FuelBorn
doesn't yet expose per-pod public URLs. **No buttons / fields**. This is
expected: per-pod ingress (Caddy + DNS) is not in `infra/` and is a separate
work-stream.

## 7. Regression: legacy pods

Pods deployed before this change have `LLM_PROVIDER`/`LLM_MODEL` in their
Pelican environment instead of the new vars. The pod page falls back to those
vars, so the header strip should still display "openrouter · model-id" rather
than "— · —". Smoke check: open an old pod, verify the meta line.

`hermes` itself will still show `No inference provider configured` on those
old pods — that's the bug this PR was opened to fix and is only resolved for
freshly-deployed pods (or pods whose Settings tab has been used to re-save
provider).

## 8. Rollback

If anything breaks in production:

```sh
ssh podsadmin@pods-ml-prototype.eastus.cloudapp.azure.com '
  cd /srv/pods/frontend &&
  git checkout <previous-commit> &&
  pnpm install && pnpm build &&
  sudo systemctl restart pods-ml-frontend
'
```

The egg only matters for *new* deploys, so a frontend rollback alone is
sufficient to restore the old behaviour for users; existing pods are
unaffected by either change.

## 9. Known follow-ups (not in this PR)

- Per-pod public ingress (Caddy + DNS wildcard) so webhook-mode connectors
  can leave the "infra TODO" bucket.
- FuelBorn first-party inference endpoint — the `pods-ml` compatibility provider is wired
  through the catalog as a `cloud` mode placeholder; flip its `mode` to
  `key` and add a `fields[]` once the backend is live.
- Pod deletion from the UI (currently still panel-only).
- Per-provider model dropdowns for the providers with `modelsEndpoint: null`
  (Kimi, MiniMax, DashScope, Tencent, Arcee, Kilocode, OpenCode Zen/Go,
  Azure Foundry, Copilot REST). Today they fall back to free-text input.
