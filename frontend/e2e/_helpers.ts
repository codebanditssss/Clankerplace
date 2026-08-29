// Shared helpers for the pods.ml E2E suite.
//
// Each test creates its own user (so parallel runs don't share state).
// Pods get a random suffix so reruns don't collide. We always assert on
// real public DNS — no `--resolve` overrides — so we exercise the full
// Cloudflare → Caddy → docker bridge → container chain.

import { type Page, expect } from "@playwright/test";

export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export async function signupAndLogin(page: Page): Promise<{
  email: string;
  password: string;
}> {
  const email = `${unique("e2e")}@pods.ml`;
  const password = "TestPass-12345!";

  await page.goto("/signup");
  // The form's email textbox got a proper aria-label in the design refresh.
  // Fall back to placeholder if the label binding ever changes again.
  const emailField = page.getByLabel(/email/i).first();
  await expect(emailField).toBeVisible({ timeout: 10_000 });
  await emailField.fill(email);
  // Password is still type-suppressed (autofill mitigation) — locate by
  // its placeholder which remains unique on the page.
  await page.getByPlaceholder("••••••••").first().fill(password);
  await page
    .getByRole("button", { name: /create account|sign up|create/i })
    .first()
    .click();
  await expect(page).toHaveURL(
    /pods-ml-prototype\.eastus\.cloudapp\.azure\.com\/(\?|pods|$)/,
    { timeout: 30_000 },
  );
  return { email, password };
}

/**
 * Wait until the API reports `installed=1` for a given pod identifier.
 * Polls /api/pods/<id>/status. The first install of any pod is the
 * slow path — n8n (~2-3m), Paper (~1m), code-sandbox (~30s).
 */
export async function waitForInstalled(
  page: Page,
  identifier: string,
  timeoutMs = 8 * 60 * 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await page.request.get(`/api/pods/${identifier}/status`);
    if (res.ok()) {
      const d = (await res.json()) as { installed?: boolean };
      if (d.installed) return;
    }
    await page.waitForTimeout(5_000);
  }
  throw new Error(`pod ${identifier} did not install within ${timeoutMs}ms`);
}

/**
 * Open the New-pod sheet from the home page, pick a pod type tile, and
 * return without filling the form yet (caller fills + clicks Deploy).
 */
export async function openDeploySheet(page: Page): Promise<void> {
  await page.goto("/");
  // Trigger via the keyboard shortcut — fast and bypasses any sidebar
  // collapse states.
  await page.keyboard.press("n");
  // Confirm the sheet opened.
  await expect(page.getByText(/deploy new pod|pick another type/i).first()).toBeVisible({
    timeout: 5_000,
  });
}
