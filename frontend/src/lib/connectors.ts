// Authoritative catalog of Hermes Agent messaging connectors.
//
// Source: hermes-agent .env.example + docs/messaging-gateway.
//
// `kind` controls how the UI handles the connector:
//   - "token": fully form-driven; UI writes the env keys into ~/.hermes/.env
//     and restarts `hermes gateway`.
//   - "oauth": the connector needs a browser OAuth dance run from inside the
//     pod (`hermes setup` etc.). UI shows a hand-off card pointing the user
//     at the Console tab.
//   - "infra": the connector still needs infra that isn't wired (e.g. Teams
//     meeting bots need a media relay endpoint). Shown as a placeholder.
//
// `webhookPath` (optional): if set, the connector accepts inbound HTTPS
// webhooks at `https://<pod-slug>.<domain>{webhookPath}`. The per-pod
// auto-domain's Caddy include path-routes this back to the Hermes
// platform adapter inside the container. The UI surfaces a copy-paste
// URL block on the connector card so the user knows what to paste into
// the platform's dashboard.
//
// `fields[]` is what the form will render for "token" connectors. `env[]` is
// the full set of variables this connector touches (used when computing
// `configured` from a current .env dump).

export type ConnectorKind = "token" | "oauth" | "infra";

export type ConnectorField = {
  env: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
  hint?: string;
};

export type Connector = {
  slug: string;
  label: string;
  blurb: string;
  kind: ConnectorKind;
  /** primary env variable that, when set, means this connector is "configured" */
  primaryEnv: string;
  /** every env variable this connector reads/writes */
  env: string[];
  fields?: ConnectorField[];
  /** instructions surface for oauth/infra modes */
  setupHint?: string;
  /** docs URL */
  docs?: string;
  /** brand accent (tailwind text class) */
  accent?: string;
  /**
   * Public-URL fragment served by Caddy's per-pod path-routed include.
   * If set, the UI renders a "Webhook URL" copy block reading
   * `https://<slug>.<root>{webhookPath}` for the user to paste into the
   * remote platform's dashboard. MUST match a `handle` in
   * `infra/scripts/pods-ml-domain` add-multi.
   */
  webhookPath?: string;
  /**
   * Env var the platform expects to hold the full webhook URL.
   * When the UI saves the form, this var is auto-populated with the
   * computed URL so the Hermes adapter doesn't need to construct it.
   */
  webhookUrlEnv?: string;
  /**
   * Fixed env values merged into every POST for this connector. Used to
   * flip Hermes platform-enable switches (`*_ENABLED=1`) and pin the
   * `*_PATH` values so they match the per-pod Caddy include without
   * cluttering the user-facing form. The API route blends these in on
   * top of user-provided fields server-side.
   */
  staticEnv?: Record<string, string>;
};

export const CONNECTORS: Connector[] = [
  // ----------------------- token-based (form) ------------------------
  {
    slug: "telegram",
    label: "Telegram",
    blurb: "Talk to your Hermes Agent from any Telegram chat (long-poll mode).",
    kind: "token",
    primaryEnv: "TELEGRAM_BOT_TOKEN",
    env: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS"],
    fields: [
      {
        env: "TELEGRAM_BOT_TOKEN",
        label: "Bot token",
        placeholder: "123456789:ABCdef…",
        secret: true,
        hint: "Get one from @BotFather → /newbot.",
      },
      {
        env: "TELEGRAM_ALLOWED_USERS",
        label: "Allowed user IDs",
        placeholder: "123456789,987654321",
        optional: true,
        hint:
          "Comma-separated numeric IDs. Leave blank and the bot refuses everyone (safe default). Find your ID via @userinfobot.",
      },
    ],
    docs: "https://core.telegram.org/bots#botfather",
    accent: "text-[#62B7E8]",
  },
  {
    slug: "discord",
    label: "Discord",
    blurb: "Run Hermes as a Discord bot inside one or more servers.",
    kind: "token",
    primaryEnv: "DISCORD_BOT_TOKEN",
    env: ["DISCORD_BOT_TOKEN", "DISCORD_ALLOWED_USERS"],
    fields: [
      {
        env: "DISCORD_BOT_TOKEN",
        label: "Bot token",
        placeholder: "MTAxOTM…",
        secret: true,
        hint: "discord.com/developers/applications → Bot → Reset Token.",
      },
      {
        env: "DISCORD_ALLOWED_USERS",
        label: "Allowed user IDs",
        placeholder: "1019…,2034…",
        optional: true,
        hint: "Comma-separated Discord user snowflakes.",
      },
    ],
    docs: "https://discord.com/developers/applications",
    accent: "text-[#5865F2]",
  },
  {
    slug: "slack",
    label: "Slack",
    blurb: "Hermes responds to mentions and DMs in your Slack workspace.",
    kind: "token",
    primaryEnv: "SLACK_BOT_TOKEN",
    env: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_ALLOWED_USERS"],
    fields: [
      {
        env: "SLACK_BOT_TOKEN",
        label: "Bot token (xoxb-…)",
        placeholder: "xoxb-…",
        secret: true,
      },
      {
        env: "SLACK_APP_TOKEN",
        label: "App-level token (xapp-…) for Socket Mode",
        placeholder: "xapp-…",
        secret: true,
        hint: "Required so Hermes can use Socket Mode and skip public webhooks.",
      },
      {
        env: "SLACK_ALLOWED_USERS",
        label: "Allowed Slack user IDs",
        placeholder: "U01ABCDEF,U02GHIJKL",
        optional: true,
      },
    ],
    docs: "https://api.slack.com/apps",
    accent: "text-[#ECB22E]",
  },
  {
    slug: "google-chat",
    label: "Google Chat",
    blurb: "Bot in Google Chat workspaces (Workspace edition required).",
    kind: "token",
    primaryEnv: "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON",
    env: ["GOOGLE_CHAT_SERVICE_ACCOUNT_JSON", "GOOGLE_CHAT_PROJECT_ID"],
    fields: [
      {
        env: "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON",
        label: "Service account JSON (paste full contents)",
        placeholder: '{"type":"service_account",…}',
        secret: true,
      },
      {
        env: "GOOGLE_CHAT_PROJECT_ID",
        label: "GCP project ID",
        placeholder: "my-gcp-project",
      },
    ],
    docs: "https://developers.google.com/chat",
    accent: "text-[#34A853]",
  },
  {
    slug: "mattermost",
    label: "Mattermost",
    blurb: "Self-hosted Slack alternative — bot via personal access token.",
    kind: "token",
    primaryEnv: "MATTERMOST_TOKEN",
    env: ["MATTERMOST_URL", "MATTERMOST_TOKEN", "MATTERMOST_TEAM"],
    fields: [
      {
        env: "MATTERMOST_URL",
        label: "Mattermost server URL",
        placeholder: "https://chat.example.com",
      },
      {
        env: "MATTERMOST_TOKEN",
        label: "Bot personal access token",
        secret: true,
      },
      {
        env: "MATTERMOST_TEAM",
        label: "Team name",
        optional: true,
      },
    ],
    docs: "https://developers.mattermost.com/integrate/reference/personal-access-token/",
    accent: "text-[#0058CC]",
  },
  {
    slug: "matrix",
    label: "Matrix",
    blurb: "Federated chat — bot with an access token on any homeserver.",
    kind: "token",
    primaryEnv: "MATRIX_ACCESS_TOKEN",
    env: [
      "MATRIX_HOMESERVER",
      "MATRIX_USER_ID",
      "MATRIX_ACCESS_TOKEN",
      "MATRIX_ALLOWED_USERS",
    ],
    fields: [
      {
        env: "MATRIX_HOMESERVER",
        label: "Homeserver URL",
        placeholder: "https://matrix.org",
      },
      {
        env: "MATRIX_USER_ID",
        label: "Bot Matrix ID",
        placeholder: "@hermes:matrix.org",
      },
      {
        env: "MATRIX_ACCESS_TOKEN",
        label: "Access token",
        secret: true,
      },
      {
        env: "MATRIX_ALLOWED_USERS",
        label: "Allowed user IDs",
        placeholder: "@alice:matrix.org,@bob:matrix.org",
        optional: true,
      },
    ],
    docs: "https://matrix.org/docs/guides/client-server-api/",
    accent: "text-[#0DBD8B]",
  },
  {
    slug: "dingtalk",
    label: "DingTalk",
    blurb: "Alibaba's enterprise IM — outgoing-bot via robot code + secret.",
    kind: "token",
    primaryEnv: "DINGTALK_ROBOT_CODE",
    env: ["DINGTALK_ROBOT_CODE", "DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"],
    fields: [
      { env: "DINGTALK_ROBOT_CODE", label: "Robot code" },
      { env: "DINGTALK_CLIENT_ID", label: "Client ID" },
      { env: "DINGTALK_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
    docs: "https://open.dingtalk.com/document/",
    accent: "text-[#1689FB]",
  },
  {
    slug: "feishu",
    label: "Feishu / Lark",
    blurb: "ByteDance's Feishu (Lark internationally) — app credentials.",
    kind: "token",
    primaryEnv: "FEISHU_APP_ID",
    env: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_VERIFY_TOKEN"],
    fields: [
      { env: "FEISHU_APP_ID", label: "App ID" },
      { env: "FEISHU_APP_SECRET", label: "App secret", secret: true },
      {
        env: "FEISHU_VERIFY_TOKEN",
        label: "Verify token",
        secret: true,
        optional: true,
      },
    ],
    docs: "https://open.feishu.cn",
    accent: "text-[#3370FF]",
  },
  {
    slug: "wecom",
    label: "WeCom (企业微信)",
    blurb: "Tencent's enterprise WeChat — corp ID + agent + secret.",
    kind: "token",
    primaryEnv: "WECOM_CORP_ID",
    env: ["WECOM_CORP_ID", "WECOM_AGENT_ID", "WECOM_SECRET"],
    fields: [
      { env: "WECOM_CORP_ID", label: "Corp ID" },
      { env: "WECOM_AGENT_ID", label: "Agent ID" },
      { env: "WECOM_SECRET", label: "Secret", secret: true },
    ],
    docs: "https://developer.work.weixin.qq.com",
    accent: "text-[#07C160]",
  },
  {
    slug: "qq-bot",
    label: "QQ Bot",
    blurb: "Tencent QQ Open Platform bot.",
    kind: "token",
    primaryEnv: "QQ_BOT_APP_ID",
    env: ["QQ_BOT_APP_ID", "QQ_BOT_TOKEN", "QQ_BOT_SECRET"],
    fields: [
      { env: "QQ_BOT_APP_ID", label: "App ID" },
      { env: "QQ_BOT_TOKEN", label: "Bot token", secret: true },
      { env: "QQ_BOT_SECRET", label: "Secret", secret: true },
    ],
    docs: "https://q.qq.com",
    accent: "text-[#12B7F5]",
  },
  {
    slug: "yuanbao",
    label: "Tencent Yuanbao (元宝)",
    blurb: "Tencent's Yuanbao chat platform.",
    kind: "token",
    primaryEnv: "YUANBAO_API_KEY",
    env: ["YUANBAO_API_KEY"],
    fields: [{ env: "YUANBAO_API_KEY", label: "Yuanbao API key", secret: true }],
    accent: "text-[#1A6CFF]",
  },
  {
    slug: "home-assistant",
    label: "Home Assistant",
    blurb: "Drive smart-home automations from Hermes via the HA REST API.",
    kind: "token",
    primaryEnv: "HOME_ASSISTANT_TOKEN",
    env: ["HOME_ASSISTANT_URL", "HOME_ASSISTANT_TOKEN"],
    fields: [
      {
        env: "HOME_ASSISTANT_URL",
        label: "Home Assistant URL",
        placeholder: "http://homeassistant.local:8123",
      },
      {
        env: "HOME_ASSISTANT_TOKEN",
        label: "Long-lived access token",
        secret: true,
      },
    ],
    docs: "https://www.home-assistant.io/docs/authentication/",
    accent: "text-[#41BDF5]",
  },
  {
    slug: "open-webui",
    label: "Open WebUI",
    blurb: "Use Hermes as the backend for an Open WebUI deployment.",
    kind: "token",
    primaryEnv: "OPEN_WEBUI_API_KEY",
    env: ["OPEN_WEBUI_URL", "OPEN_WEBUI_API_KEY"],
    fields: [
      {
        env: "OPEN_WEBUI_URL",
        label: "Open WebUI URL",
        placeholder: "https://chat.example.com",
      },
      { env: "OPEN_WEBUI_API_KEY", label: "API key", secret: true },
    ],
    docs: "https://docs.openwebui.com",
    accent: "text-zinc-200",
  },
  // Note: "Email" is intentionally NOT in this catalog. It's an agent
  // *capability* (the pod has a real mailbox it uses for tasks the user
  // asks — sign up for things, manage subscriptions, monitor automated
  // mail) — not a way for the user to chat with the agent. The user-
  // facing surface lives in the dedicated Email tab on the pod page.
  {
    slug: "signal",
    label: "Signal",
    blurb: "Bridge via signal-cli-rest-api running alongside Hermes in the pod.",
    kind: "token",
    primaryEnv: "SIGNAL_NUMBER",
    env: ["SIGNAL_NUMBER", "SIGNAL_REST_URL"],
    fields: [
      {
        env: "SIGNAL_NUMBER",
        label: "Signal phone number (E.164)",
        placeholder: "+15551234567",
      },
      {
        env: "SIGNAL_REST_URL",
        label: "signal-cli-rest-api URL",
        placeholder: "http://localhost:8080",
        hint: "Run signal-cli-rest-api inside the pod (docker or systemd) and link a device first.",
      },
    ],
    docs: "https://github.com/bbernhard/signal-cli-rest-api",
    accent: "text-[#3A76F0]",
  },
  {
    slug: "whatsapp",
    label: "WhatsApp (Baileys)",
    blurb:
      "Hermes ships a built-in Baileys bridge — pair via QR in the pod terminal.",
    kind: "oauth",
    primaryEnv: "WHATSAPP_SESSION",
    env: ["WHATSAPP_SESSION"],
    setupHint:
      "Open the Console tab and run `hermes whatsapp` — Hermes will print a QR code; scan it from the Linked Devices screen in WhatsApp on your phone. The session is stored in /home/container/.hermes/whatsapp-session.",
    accent: "text-[#25D366]",
  },
  {
    slug: "bluebubbles",
    label: "BlueBubbles (iMessage, polling)",
    blurb: "Polling-mode bridge to a BlueBubbles server (Mac required).",
    kind: "token",
    primaryEnv: "BLUEBUBBLES_SERVER_URL",
    env: ["BLUEBUBBLES_SERVER_URL", "BLUEBUBBLES_PASSWORD"],
    fields: [
      {
        env: "BLUEBUBBLES_SERVER_URL",
        label: "BlueBubbles server URL",
        placeholder: "https://bb.example.com",
      },
      { env: "BLUEBUBBLES_PASSWORD", label: "Server password", secret: true },
    ],
    docs: "https://bluebubbles.app",
    accent: "text-[#007AFF]",
  },

  // ----------------------- needs OAuth or CLI dance -------------------
  {
    slug: "weixin",
    label: "Weixin (WeChat personal)",
    blurb:
      "Personal WeChat via wechaty — requires a token-server account and QR scan.",
    kind: "oauth",
    primaryEnv: "WECHATY_TOKEN",
    env: ["WECHATY_TOKEN", "WECHATY_PUPPET"],
    setupHint:
      "Set up a wechaty puppet (e.g. wechaty-puppet-padlocal) and paste the token. The QR-scan login flow has to be completed from the pod terminal — open Console and run `hermes weixin login`.",
    docs: "https://wechaty.js.org",
    accent: "text-[#07C160]",
  },

  // ----------------------- webhook-mode connectors (public ingress) ------
  // Every pod's auto-domain (`<slug>.bigcat.pw`) is path-routed by Caddy
  // to the right internal Hermes port — see infra/scripts/pods-ml-domain.
  // These cards surface the URL to paste into the platform's dashboard.
  {
    slug: "openai-api",
    label: "OpenAI-compatible API",
    blurb:
      "Expose this pod's Hermes Agent as an OpenAI-compatible endpoint — point Open WebUI, LobeChat, ChatBox, LibreChat, etc. at it.",
    kind: "token",
    primaryEnv: "API_SERVER_KEY",
    env: ["API_SERVER_ENABLED", "API_SERVER_KEY"],
    fields: [
      {
        env: "API_SERVER_KEY",
        label: "API key (clients pass it as Authorization: Bearer <key>)",
        secret: true,
        hint: "Any 32+ char random string. Required because the URL is publicly reachable — without a key anyone can hit /v1/chat/completions on your pod.",
      },
    ],
    staticEnv: {
      API_SERVER_ENABLED: "1",
      API_SERVER_HOST: "0.0.0.0",
      API_SERVER_PORT: "8642",
    },
    webhookPath: "/v1",
    docs: "https://platform.openai.com/docs/api-reference",
    accent: "text-zinc-100",
  },
  {
    slug: "telegram-webhook",
    label: "Telegram (webhook mode)",
    blurb:
      "Lower-latency Telegram via setWebhook. Paste the URL below into BotFather → /setwebhook.",
    kind: "token",
    primaryEnv: "TELEGRAM_WEBHOOK_URL",
    env: [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_URL",
      "TELEGRAM_WEBHOOK_SECRET",
      "TELEGRAM_ALLOWED_USERS",
    ],
    fields: [
      {
        env: "TELEGRAM_BOT_TOKEN",
        label: "Bot token",
        placeholder: "123456789:ABCdef…",
        secret: true,
        hint: "Get one from @BotFather → /newbot.",
      },
      {
        env: "TELEGRAM_WEBHOOK_SECRET",
        label: "Webhook secret token (recommended)",
        secret: true,
        optional: true,
        hint: "Telegram echoes this in the X-Telegram-Bot-Api-Secret-Token header on every POST so Hermes can reject spoofed requests.",
      },
      {
        env: "TELEGRAM_ALLOWED_USERS",
        label: "Allowed user IDs",
        placeholder: "123456789,987654321",
        optional: true,
      },
    ],
    staticEnv: {
      TELEGRAM_WEBHOOK_PORT: "8443",
      TELEGRAM_WEBHOOK_HOST: "0.0.0.0",
    },
    webhookPath: "/telegram",
    webhookUrlEnv: "TELEGRAM_WEBHOOK_URL",
    docs: "https://core.telegram.org/bots/webhooks",
    accent: "text-[#62B7E8]",
  },
  {
    slug: "webhooks",
    label: "Generic webhooks",
    blurb:
      "Universal inbound HTTP → Hermes prompt. Use for Stripe, GitHub, Linear, Sentry, or any platform that POSTs JSON to a URL.",
    kind: "token",
    primaryEnv: "WEBHOOK_SECRET",
    env: ["WEBHOOK_SECRET", "WEBHOOK_ROUTES"],
    fields: [
      {
        env: "WEBHOOK_SECRET",
        label: "Shared secret",
        secret: true,
        hint: "Hermes verifies the X-Webhook-Signature HMAC header against this. Pick any random 32+ char string.",
      },
      {
        env: "WEBHOOK_ROUTES",
        label: "Route names (comma-separated)",
        placeholder: "stripe,github,linear",
        optional: true,
        hint: "Each name gets its own path: /webhooks/<name>. Defaults to a single `default` route.",
      },
    ],
    staticEnv: {
      WEBHOOK_ENABLED: "1",
      WEBHOOK_PORT: "8644",
      WEBHOOK_HOST: "0.0.0.0",
    },
    webhookPath: "/webhooks",
    accent: "text-zinc-200",
  },
  {
    slug: "sms-twilio",
    label: "SMS via Twilio",
    blurb:
      "Inbound SMS over Twilio. Set this URL as the messaging webhook for your phone number.",
    kind: "token",
    primaryEnv: "TWILIO_ACCOUNT_SID",
    env: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
      "TWILIO_WEBHOOK_URL",
    ],
    fields: [
      { env: "TWILIO_ACCOUNT_SID", label: "Account SID", placeholder: "AC…" },
      { env: "TWILIO_AUTH_TOKEN", label: "Auth token", secret: true },
      {
        env: "TWILIO_FROM_NUMBER",
        label: "Your Twilio number (E.164)",
        placeholder: "+15551234567",
      },
    ],
    staticEnv: {
      SMS_WEBHOOK_HOST: "0.0.0.0",
      SMS_WEBHOOK_PORT: "8643",
    },
    webhookPath: "/webhooks/twilio",
    webhookUrlEnv: "TWILIO_WEBHOOK_URL",
    docs: "https://www.twilio.com/docs/messaging/guides/webhook-request",
    accent: "text-[#F22F46]",
  },
  {
    slug: "msgraph-webhook",
    label: "Microsoft Graph (webhooks)",
    blurb:
      "Subscribe to Outlook/Teams/SharePoint change notifications. Use for inbound email, Teams messages, calendar events.",
    kind: "token",
    primaryEnv: "MSGRAPH_TENANT_ID",
    env: [
      "MSGRAPH_TENANT_ID",
      "MSGRAPH_CLIENT_ID",
      "MSGRAPH_CLIENT_SECRET",
      "MSGRAPH_WEBHOOK_URL",
      "MSGRAPH_CLIENT_STATE",
    ],
    fields: [
      { env: "MSGRAPH_TENANT_ID", label: "Azure tenant ID" },
      { env: "MSGRAPH_CLIENT_ID", label: "App (client) ID" },
      { env: "MSGRAPH_CLIENT_SECRET", label: "Client secret", secret: true },
      {
        env: "MSGRAPH_CLIENT_STATE",
        label: "Client state (verification)",
        secret: true,
        optional: true,
      },
    ],
    staticEnv: {
      MSGRAPH_WEBHOOK_ENABLED: "1",
      MSGRAPH_WEBHOOK_PORT: "8646",
      MSGRAPH_WEBHOOK_HOST: "0.0.0.0",
    },
    webhookPath: "/msgraph",
    webhookUrlEnv: "MSGRAPH_WEBHOOK_URL",
    docs: "https://learn.microsoft.com/graph/webhooks",
    accent: "text-[#0078D4]",
  },
  {
    slug: "wecom-callback",
    label: "WeCom Callback",
    blurb:
      "WeCom callback mode — receive encrypted events server-to-server. Register the URL below in the WeCom admin.",
    kind: "token",
    primaryEnv: "WECOM_CALLBACK_URL",
    env: [
      "WECOM_CALLBACK_URL",
      "WECOM_CALLBACK_TOKEN",
      "WECOM_CALLBACK_AES_KEY",
    ],
    fields: [
      { env: "WECOM_CALLBACK_TOKEN", label: "Verify token", secret: true },
      {
        env: "WECOM_CALLBACK_AES_KEY",
        label: "Encoding AES key (43 chars)",
        secret: true,
      },
    ],
    staticEnv: {
      WECOM_CALLBACK_PORT: "8645",
      WECOM_CALLBACK_HOST: "0.0.0.0",
      WECOM_CALLBACK_PATH: "/wecom",
    },
    webhookPath: "/wecom",
    webhookUrlEnv: "WECOM_CALLBACK_URL",
    docs: "https://developer.work.weixin.qq.com/document/path/90930",
    accent: "text-[#07C160]",
  },
  {
    slug: "feishu-webhook",
    label: "Feishu / Lark (webhook)",
    blurb:
      "Feishu event subscriptions — push messages and bot mentions to a public URL.",
    kind: "token",
    primaryEnv: "FEISHU_WEBHOOK_URL",
    env: [
      "FEISHU_APP_ID",
      "FEISHU_APP_SECRET",
      "FEISHU_VERIFY_TOKEN",
      "FEISHU_ENCRYPT_KEY",
      "FEISHU_WEBHOOK_URL",
    ],
    fields: [
      { env: "FEISHU_APP_ID", label: "App ID" },
      { env: "FEISHU_APP_SECRET", label: "App secret", secret: true },
      { env: "FEISHU_VERIFY_TOKEN", label: "Verify token", secret: true },
      {
        env: "FEISHU_ENCRYPT_KEY",
        label: "Encrypt key (if event encryption enabled)",
        secret: true,
        optional: true,
      },
    ],
    staticEnv: {
      FEISHU_WEBHOOK_PORT: "8765",
      FEISHU_WEBHOOK_HOST: "0.0.0.0",
      FEISHU_WEBHOOK_PATH: "/feishu",
    },
    webhookPath: "/feishu",
    webhookUrlEnv: "FEISHU_WEBHOOK_URL",
    docs: "https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration",
    accent: "text-[#3370FF]",
  },
  {
    slug: "bluebubbles-webhook",
    label: "BlueBubbles (webhook)",
    blurb:
      "Lower-latency iMessage via BlueBubbles webhook mode (BlueBubbles pushes events to you).",
    kind: "token",
    primaryEnv: "BLUEBUBBLES_WEBHOOK_URL",
    env: [
      "BLUEBUBBLES_SERVER_URL",
      "BLUEBUBBLES_PASSWORD",
      "BLUEBUBBLES_WEBHOOK_URL",
    ],
    fields: [
      {
        env: "BLUEBUBBLES_SERVER_URL",
        label: "BlueBubbles server URL",
        placeholder: "https://bb.example.com",
      },
      { env: "BLUEBUBBLES_PASSWORD", label: "Server password", secret: true },
    ],
    staticEnv: {
      BLUEBUBBLES_WEBHOOK_PORT: "8649",
      BLUEBUBBLES_WEBHOOK_HOST: "0.0.0.0",
      BLUEBUBBLES_WEBHOOK_PATH: "/bluebubbles",
    },
    webhookPath: "/bluebubbles",
    webhookUrlEnv: "BLUEBUBBLES_WEBHOOK_URL",
    docs: "https://bluebubbles.app",
    accent: "text-[#007AFF]",
  },

  {
    slug: "line",
    label: "LINE",
    blurb:
      "Japan's LINE Messaging API — paste the URL into the LINE Developers Console webhook field.",
    kind: "token",
    primaryEnv: "LINE_CHANNEL_ACCESS_TOKEN",
    env: [
      "LINE_CHANNEL_ACCESS_TOKEN",
      "LINE_CHANNEL_SECRET",
      "LINE_PUBLIC_URL",
      "LINE_ALLOWED_USERS",
    ],
    fields: [
      {
        env: "LINE_CHANNEL_ACCESS_TOKEN",
        label: "Channel access token",
        secret: true,
        hint: "LINE Developers Console → Messaging API → Channel access token (long-lived).",
      },
      {
        env: "LINE_CHANNEL_SECRET",
        label: "Channel secret",
        secret: true,
        hint: "Used for HMAC-SHA256 verification of every incoming webhook.",
      },
      {
        env: "LINE_ALLOWED_USERS",
        label: "Allowed LINE user IDs",
        placeholder: "U1234…,U5678…",
        optional: true,
      },
    ],
    staticEnv: {
      LINE_PORT: "8647",
      LINE_HOST: "0.0.0.0",
    },
    webhookPath: "/line/webhook",
    webhookUrlEnv: "LINE_PUBLIC_URL",
    docs: "https://developers.line.biz/console/",
    accent: "text-[#06C755]",
  },
  {
    slug: "teams",
    label: "Microsoft Teams",
    blurb:
      "Microsoft Teams via Bot Framework — paste the URL into your bot's Messaging endpoint in Azure.",
    kind: "token",
    primaryEnv: "TEAMS_CLIENT_ID",
    env: [
      "TEAMS_CLIENT_ID",
      "TEAMS_CLIENT_SECRET",
      "TEAMS_TENANT_ID",
      "TEAMS_ALLOWED_USERS",
    ],
    fields: [
      {
        env: "TEAMS_CLIENT_ID",
        label: "Azure AD client ID",
        hint: "Bot Framework / Azure AD app registration.",
      },
      {
        env: "TEAMS_CLIENT_SECRET",
        label: "Azure AD client secret",
        secret: true,
      },
      { env: "TEAMS_TENANT_ID", label: "Azure AD tenant ID" },
      {
        env: "TEAMS_ALLOWED_USERS",
        label: "Allowed Teams user IDs / UPNs",
        placeholder: "alice@contoso.com,bob@contoso.com",
        optional: true,
      },
    ],
    staticEnv: {
      TEAMS_PORT: "3978",
      TEAMS_HOST: "0.0.0.0",
    },
    webhookPath: "/teams/api/messages",
    docs: "https://learn.microsoft.com/azure/bot-service/bot-builder-authentication",
    accent: "text-[#5059C9]",
  },

  // ----------------------- still infra-blocked --------------------------
  {
    slug: "teams-meetings",
    label: "Teams Meetings",
    blurb: "Real-time meeting bot — needs a media relay (SRTP/ICE/TURN).",
    kind: "infra",
    primaryEnv: "TEAMS_MEETING_APP_ID",
    env: ["TEAMS_MEETING_APP_ID", "TEAMS_MEETING_APP_PASSWORD"],
    setupHint:
      "Teams Meeting bots aren't a plain webhook — they need a real-time media relay (SRTP, ICE/TURN) to join calls. Plain HTTPS ingress isn't enough. Tracked separately from the bot-framework Teams connector above.",
  },
];

export const CONNECTOR_BY_SLUG: Record<string, Connector> = Object.fromEntries(
  CONNECTORS.map((c) => [c.slug, c]),
);
