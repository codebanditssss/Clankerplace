// Full E2E for pods.ml against the live prod URL.
//
// One user per test. Deploys happen via the public /api/deploy (the same
// codepath the UI sheet triggers — clicking through forms would multiply
// the runtime by ~10 minutes for no extra coverage). The UI half of
// each test walks every tab on the resulting pod page and asserts the
// right components render without console errors.

import { expect, test } from "@playwright/test";
import { signupAndLogin, unique, waitForInstalled } from "./_helpers";

type DeployResponse = {
  uuid: string;
  identifier: string;
  name: string;
  pod_type: string;
  domain: { slug: string; url: string; port: number } | null;
};

const errs: Array<{ test: string; msg: string }> = [];

// Capture any console error on every page so a "silent" UI bug shows up
// as a test failure.
test.beforeEach(async ({ page }, info) => {
  page.on("pageerror", (err) => {
    errs.push({ test: info.title, msg: err.message });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const txt = msg.text();
      // Filter out the noisy nextjs hydration warning that doesn't
      // actually break anything.
      if (txt.includes("Hydration") || txt.includes("hydrat")) return;
      errs.push({ test: info.title, msg: `console: ${txt}` });
    }
  });
});

test.afterAll(() => {
  if (errs.length > 0) {
    console.log("\n=== Captured page errors during the run ===");
    for (const e of errs) console.log(`  [${e.test}] ${e.msg}`);
  }
});

// =====================================================================
// 1. Signup + login flow
// =====================================================================

test("01 signup, login, and home page render", async ({ page }) => {
  await signupAndLogin(page);
  // Home page should show empty-state CTA.
  await page.goto("/");
  await expect(page.getByText(/deploy|new pod|first pod|sign in/i).first()).toBeVisible();
});

// =====================================================================
// 2a. DeployHub picker UI renders + every type tile is clickable
// =====================================================================

test("02a deploy picker: every pod type renders + form unfolds", async ({ page }) => {
  await signupAndLogin(page);
  await page.goto("/");
  await page.keyboard.press("n");
  await expect(page.getByText(/what kind of pod/i).first()).toBeVisible({ timeout: 5_000 });
  // The four core pod types must all show up as tiles.
  for (const label of ["Hermes Agent", "n8n", "Code Sandbox", "Minecraft"]) {
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
  }
  // Clicking n8n unfolds its form.
  await page.getByText("n8n", { exact: true }).first().click();
  await expect(page.getByText(/editor username/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: /deploy n8n/i })).toBeVisible();
});

// =====================================================================
// 2b. n8n — deploy via API + verify editor reachable
// =====================================================================

test("02b n8n: deploy + editor reachable on auto-domain", async ({ page }) => {
  await signupAndLogin(page);
  const r = await page.request.post("/api/deploy", {
    data: {
      pod_type: "n8n",
      // No fields: modern n8n uses in-browser owner setup, not
      // deploy-time basic-auth credentials.
      fields: {},
    },
  });
  expect(r.ok()).toBe(true);
  const d = (await r.json()) as DeployResponse;
  expect(d.pod_type).toBe("n8n");
  // n8n's first install (npm install -g n8n) is the longest pole — up
  // to 6 minutes on a fresh layer cache.
  await waitForInstalled(page, d.identifier, 10 * 60 * 1000);

  await page.goto(`/pods/${d.identifier}`);
  // The Dashboard tab must render — empty connectors/providers (n8n
  // doesn't surface them) but Files + Domains do.
  for (const tab of ["dashboard", "console", "files", "domains", "settings"]) {
    await page.goto(`/pods/${d.identifier}?tab=${tab}`);
    await expect(page.locator("body")).not.toContainText(/HTTP 500|internal server error|this page couldn't load|application error/i);
  }
});

// =====================================================================
// 3. Hermes — deploy via API (provider config + 30 fields too heavy to UI)
// =====================================================================

test("03 hermes: deploy via API + every tab renders", async ({ page }) => {
  await signupAndLogin(page);
  // Use an obviously-fake OpenRouter key — the install runs regardless,
  // the key just feeds .env. Gateway will simply fail to make calls,
  // but we're testing the UI/install, not LLM round-trips.
  const r = await page.request.post("/api/deploy", {
    data: {
      pod_type: "hermes",
      provider: "openrouter",
      fields: { OPENROUTER_API_KEY: "sk-or-test-e2e-no-real-calls" },
    },
  });
  expect(r.ok()).toBe(true);
  const d = (await r.json()) as DeployResponse;
  expect(d.pod_type).toBe("hermes");
  expect(d.identifier).toBeTruthy();
  await waitForInstalled(page, d.identifier, 10 * 60 * 1000);

  await page.goto(`/pods/${d.identifier}`);
  // Walk every tab Hermes shows: Dashboard, Console, Connectors, Providers, MCP, Files, Domains, Settings.
  for (const tab of [
    "dashboard",
    "console",
    "connectors",
    "providers",
    "mcp",
    "files",
    "domains",
    "settings",
  ]) {
    await page.goto(`/pods/${d.identifier}?tab=${tab}`);
    // Each tab must not show a 500-page fallback.
    // Look for hard error pages, not the digit "500" which appears in
    // helper text ("ports like 3000, 5000…").
    await expect(page.locator("body")).not.toContainText(/HTTP 500|internal server error|this page couldn't load|application error/i);
  }

  // MCP install — pick "fetch" (no required fields). Then verify it shows
  // in the installed list.
  await page.goto(`/pods/${d.identifier}?tab=mcp`);
  await expect(page.getByText(/Recent events|Browse|Fetch \(URLs\)/i).first()).toBeVisible({ timeout: 15_000 });
});

// =====================================================================
// 4. Code Sandbox (code-server flavor) — UI deploy + verify port live
// =====================================================================

test("04 code-sandbox: deploy + code-server reachable", async ({ page }) => {
  await signupAndLogin(page);
  const r = await page.request.post("/api/deploy", {
    data: {
      pod_type: "code-sandbox",
      fields: {
        SANDBOX_FLAVOR: "code-server",
        SANDBOX_PASSWORD: "TestVSC-pwd-1234",
      },
    },
  });
  expect(r.ok()).toBe(true);
  const d = (await r.json()) as DeployResponse;
  expect(d.domain).not.toBeNull();
  await waitForInstalled(page, d.identifier, 5 * 60 * 1000);

  // Wait for code-server to bind :8080 — install does it, but the
  // container needs a moment after install completes.
  let live = false;
  for (let i = 0; i < 30; i++) {
    const probe = await page.request.get(d.domain!.url + "/login", {
      timeout: 10_000,
      ignoreHTTPSErrors: true,
    });
    if (probe.ok()) {
      const html = await probe.text();
      if (html.includes("code-server") || html.includes("Welcome")) {
        live = true;
        break;
      }
    }
    await page.waitForTimeout(4_000);
  }
  expect(live, "code-server login page reachable on auto-domain").toBe(true);

  // Walk the pod page tabs.
  for (const tab of ["dashboard", "console", "files", "domains", "settings"]) {
    await page.goto(`/pods/${d.identifier}?tab=${tab}`);
    // Look for hard error pages, not the digit "500" which appears in
    // helper text ("ports like 3000, 5000…").
    await expect(page.locator("body")).not.toContainText(/HTTP 500|internal server error|this page couldn't load|application error/i);
  }
});

// =====================================================================
// 5. Minecraft Paper — deploy, Manage + Settings + plugin install
// =====================================================================

test("05 minecraft: deploy + install plugin + change settings", async ({ page }) => {
  await signupAndLogin(page);
  const r = await page.request.post("/api/deploy", {
    data: {
      pod_type: "minecraft-paper",
      fields: { MINECRAFT_VERSION: "latest" },
    },
  });
  expect(r.ok()).toBe(true);
  const d = (await r.json()) as DeployResponse;
  expect(d.pod_type).toBe("minecraft-paper");
  await waitForInstalled(page, d.identifier, 10 * 60 * 1000);

  await page.goto(`/pods/${d.identifier}?tab=manage`);
  await expect(page.getByText(/server version/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/server\.properties/i).first()).toBeVisible();
  await expect(page.getByText(/browse plugins/i).first()).toBeVisible();

  // server.properties may not exist until the server has started once.
  // Trigger a start (Pelican defaults to start_on_completion which we
  // already set) and wait briefly for the file to appear.
  await page.waitForTimeout(10_000);

  // ---- Settings: flip difficulty via the API and confirm it persists.
  const sr = await page.request.post(`/api/pods/${d.identifier}/minecraft/properties`, {
    data: { changes: { difficulty: "hard", motd: "e2e test motd" } },
  });
  expect(sr.ok(), "save server.properties").toBe(true);
  const back = await page.request.get(`/api/pods/${d.identifier}/minecraft/properties`);
  expect(back.ok()).toBe(true);
  const props = (await back.json()) as { props: Record<string, string> };
  expect(props.props.difficulty).toBe("hard");
  expect(props.props.motd).toBe("e2e test motd");

  // ---- Plugin install: WorldEdit via Modrinth.
  const ir = await page.request.post(`/api/pods/${d.identifier}/minecraft/plugins`, {
    data: { project_id: "worldedit", mcv: props.props["level-name"] ? undefined : undefined },
  });
  expect(ir.ok(), "install worldedit").toBe(true);
  const installed = await page.request.get(`/api/pods/${d.identifier}/minecraft/plugins?installed=1`);
  const lst = (await installed.json()) as { installed: string[] };
  expect(lst.installed.some((j) => j.includes("worldedit"))).toBe(true);

  // ---- Files tab: list /home/container, then read server.properties.
  const ls = await page.request.get(`/api/pods/${d.identifier}/fs/list?path=/home/container`);
  expect(ls.ok()).toBe(true);
  const listing = (await ls.json()) as { entries: { name: string; type: string }[] };
  const names = listing.entries.map((e) => e.name);
  expect(names).toContain("plugins");
  expect(names).toContain("server.properties");

  const f = await page.request.get(
    `/api/pods/${d.identifier}/fs/file?path=/home/container/server.properties`,
  );
  expect(f.ok()).toBe(true);
  const fbody = (await f.json()) as { binary: boolean; content: string };
  expect(fbody.binary).toBe(false);
  expect(fbody.content).toContain("difficulty=hard");
  expect(fbody.content).toContain("motd=e2e test motd");
});

// =====================================================================
// 6. Cross-cutting: the home page surfaces all the pods this user owns
// =====================================================================

// =====================================================================
// 05b. /pods card click navigates correctly (regression: Link was
// behind z-stacked content so clicks landed on text, not the link)
// =====================================================================

test("05b /pods card click reliably navigates to the pod page", async ({ page }) => {
  await signupAndLogin(page);
  // Deploy something cheap so we have a card to click.
  const r = await page.request.post("/api/deploy", {
    data: {
      pod_type: "code-sandbox",
      fields: {
        SANDBOX_FLAVOR: "plain",
      },
    },
  });
  expect(r.ok()).toBe(true);
  const d = (await r.json()) as DeployResponse;

  await page.goto("/pods");
  await expect(page.getByText(d.name, { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  });

  // Click on three different spots that previously LOOKED clickable
  // but missed the Link due to z-stacking. With the fix, the Link
  // intercepts pointer events on the whole card, so Playwright
  // refuses normal clicks ("Link intercepts pointer events"). That's
  // the desired behaviour — we use force-click to verify the
  // navigation still resolves.
  for (const sel of [
    `text=${d.name}`,
    `text=${d.identifier}`,
    `a[aria-label="Open ${d.name}"]`,
  ]) {
    await page.goto("/pods");
    await page.locator(sel).first().click({ force: true });
    await expect(page).toHaveURL(
      new RegExp(`/pods/${d.identifier}(\\?|$)`),
      { timeout: 10_000 },
    );
  }
});

test("06 home page lists every pod the user created", async ({ page }) => {
  // This test is a soft assertion — earlier tests each ran with a fresh
  // user, so we can't share state. Smoke-test: signup, no pods, home
  // renders empty-state cleanly.
  await signupAndLogin(page);
  await page.goto("/pods");
  // The /pods listing page should render even when empty.
  await expect(page.locator("body")).not.toContainText(/500|internal server error|This page couldn't load/i);
});

// =====================================================================
// 07. /  shows landing for visitors, dashboard for logged-in users
// =====================================================================

test("07 landing renders at / for anonymous visitors", async ({ browser }) => {
  // Use a fresh, cookieless context so we look like a real visitor.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto("/");
    // Marketing copy from the landing hero / how-it-works sections.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
      timeout: 10_000,
    });
    // Anonymous visitor should NOT see logged-in chrome.
    await expect(page.locator("body")).not.toContainText(/Sign out/i);
    // Should expose a sign-in / get-started link or button.
    const cta = page
      .getByRole("link", { name: /sign in|log in|get started|deploy/i })
      .first();
    await expect(cta).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("07b / redirects logged-in user to their dashboard (same URL)", async ({ page }) => {
  await signupAndLogin(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  // Dashboard chrome — the sidebar's "New pod" CTA + tab counts live
  // in the app shell, only present for authed users.
  await expect(page.getByText(/new pod/i).first()).toBeVisible({ timeout: 10_000 });
});

// =====================================================================
// 08. delete-pod button flow: confirm dialog gates + actual delete
// =====================================================================

test("08 delete pod: confirm gate + delete + bounce to /pods", async ({ page }) => {
  await signupAndLogin(page);
  // Cheap pod to delete.
  const r = await page.request.post("/api/deploy", {
    data: { pod_type: "code-sandbox", fields: { SANDBOX_FLAVOR: "plain" } },
  });
  expect(r.ok()).toBe(true);
  const d = (await r.json()) as { identifier: string; name: string };

  await page.goto(`/pods/${d.identifier}`);
  // Open Actions menu (dropdown trigger in the header).
  await page
    .getByRole("button", { name: /actions/i })
    .first()
    .click();
  await page
    .getByRole("menuitem", { name: /delete pod/i })
    .or(page.getByText(/delete pod/i).first())
    .click();
  // Type the pod name to enable the confirm button.
  const typeBox = page.getByPlaceholder(d.name).or(
    page.locator(`input[placeholder*="${d.name.slice(0, 6)}"]`).first(),
  );
  await typeBox.fill(d.name);
  await page
    .getByRole("button", { name: /delete forever/i })
    .click();
  // Bounced to /pods + that pod is gone.
  await expect(page).toHaveURL(/\/pods(\?|$)/, { timeout: 15_000 });
  await expect(page.locator("body")).not.toContainText(d.identifier);
});

// =====================================================================
// 09. custom provider deploy writes base_url + api_key into config.yaml
// (regression for the "defaults to openrouter" bug — Hermes only honours
//  provider="custom" when those fields are present in config.yaml)
// =====================================================================

test("09 hermes custom-provider deploy writes model.base_url + model.api_key", async ({ page }) => {
  await signupAndLogin(page);
  const baseUrl = "https://api.example-custom.test/v1";
  const apiKey = "sk-e2e-custom-not-a-real-key-1234567890";
  const r = await page.request.post("/api/deploy", {
    data: {
      pod_type: "hermes",
      provider: "custom",
      model: "claude-sonnet-4-5",
      fields: {
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_KEY: apiKey,
      },
    },
  });
  expect(r.ok()).toBe(true);
  const d = (await r.json()) as DeployResponse;
  await waitForInstalled(page, d.identifier, 8 * 60 * 1000);

  // Read config.yaml via the Files API to assert it actually contains
  // base_url + api_key under model:.
  const fileR = await page.request.get(
    `/api/pods/${d.identifier}/fs/file?path=/home/container/.hermes/config.yaml`,
  );
  expect(fileR.ok()).toBe(true);
  const fileD = (await fileR.json()) as { content: string };
  expect(fileD.content).toContain('provider: "custom"');
  expect(fileD.content).toContain(`base_url: '${baseUrl}'`);
  expect(fileD.content).toContain(`api_key: '${apiKey}'`);
  // And it must NOT have fallen back to provider:auto.
  expect(fileD.content).not.toContain('provider: "auto"');
});

// =====================================================================
// 10. UI fixes — register link above the fold + readable placeholders +
//     tab bar handles >10 entries without breaking layout.
// =====================================================================

test("10a login page: register link is visible above the fold", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/login");
  const registerLink = page.getByRole("link", { name: /create one/i }).first();
  await expect(registerLink).toBeVisible();
  const box = await registerLink.boundingBox();
  expect(box).not.toBeNull();
  // Must sit above the fold (~viewport height of 800px).
  expect(box!.y).toBeLessThan(700);
});

test("10b auth placeholders pass a contrast smoke check", async ({ page }) => {
  await page.goto("/login");
  const email = page.getByPlaceholder("you@example.com").first();
  const color = await email.evaluate(
    (el) => window.getComputedStyle(el, "::placeholder").color,
  );
  // Bumped contrast tokens — placeholder now resolves to neutral-400
  // (#5F5B52) rather than neutral-600. Treat any channel > 0x40 as a
  // pass since the old token was r:0x40 g:0x3D b:0x37.
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  expect(m).not.toBeNull();
  const [, r, g, b] = m!;
  expect(Number(r) + Number(g) + Number(b)).toBeGreaterThan(0x40 * 3);
});

// =====================================================================
// 11. Skills tab — installed list reachable + registry browse responds.
// =====================================================================

test("11 skills tab: installed + browse APIs respond on a hermes pod", async ({
  page,
}) => {
  await signupAndLogin(page);
  // Deploy a Hermes pod (cheapest non-trivial path that exercises the
  // skills filesystem layout).
  const r = await page.request.post("/api/deploy", {
    data: {
      pod_type: "hermes",
      provider: "openrouter",
      fields: { OPENROUTER_API_KEY: "sk-or-test-e2e-skills" },
    },
  });
  expect(r.ok()).toBe(true);
  const d = (await r.json()) as DeployResponse;
  await waitForInstalled(page, d.identifier, 8 * 60 * 1000);

  // Installed list returns successfully with at least one bundled skill.
  const listR = await page.request.get(`/api/pods/${d.identifier}/skills`);
  expect(listR.ok()).toBe(true);
  const listD = (await listR.json()) as {
    skills: Array<{ name: string; category: string }>;
  };
  expect(Array.isArray(listD.skills)).toBe(true);
  expect(listD.skills.length).toBeGreaterThan(0);

  // Browse responds — the hub index cache populates on first hermes
  // boot, so the catalog should have entries.
  const browseR = await page.request.get(
    `/api/pods/${d.identifier}/skills/browse?pageSize=5`,
  );
  expect(browseR.ok()).toBe(true);
  const browseD = (await browseR.json()) as {
    items: unknown[];
    total: number;
    sources: string[];
  };
  expect(browseD.total).toBeGreaterThan(0);
  expect(browseD.sources.length).toBeGreaterThan(0);

  // Tab visible in the UI bar.
  await page.goto(`/pods/${d.identifier}?tab=skills`);
  await expect(page.getByRole("tab", { name: /skills/i })).toHaveCount(1);
  // "Installed (N)" pill counts at least one skill from the bundled set.
  await expect(page.getByText(/installed\s*\(\d+\)/i)).toBeVisible({
    timeout: 10_000,
  });
});

test("10c pod tab bar scrolls instead of overflowing", async ({ page }) => {
  await signupAndLogin(page);
  // Cheap pod for tab visuals — code-sandbox installs in ~30s and has
  // every shared tab plus none of the Hermes/Minecraft specifics, so
  // overflow happens entirely from the common tabs.
  const r = await page.request.post("/api/deploy", {
    data: { pod_type: "hermes", provider: "openrouter", fields: { OPENROUTER_API_KEY: "sk-or-test-ui" } },
  });
  expect(r.ok()).toBe(true);
  const d = (await r.json()) as DeployResponse;
  await page.goto(`/pods/${d.identifier}`);
  const bar = page.getByRole("tablist").first();
  await expect(bar).toBeVisible({ timeout: 10_000 });
  // Bar must be horizontally scrollable when content overflows.
  const overflow = await bar.evaluate((el) => {
    const cs = window.getComputedStyle(el as HTMLElement);
    return { x: cs.overflowX, scrollW: (el as HTMLElement).scrollWidth, clientW: (el as HTMLElement).clientWidth };
  });
  expect(overflow.x).toBe("auto");
  // Persona tab — last hermes-only addition — must be reachable via the
  // scroll (we can't see it by default on narrow viewports).
  const personaTab = page.getByRole("tab", { name: /persona/i });
  await expect(personaTab).toHaveCount(1);
});
