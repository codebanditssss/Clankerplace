import { test, chromium } from "@playwright/test";

test("login shot", async () => {
  const browser = await chromium.launch();
  for (const [name, w, h] of [["desktop",1280,800],["mobile",375,812]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
    await page.screenshot({ path: `/tmp/pods-screenshots/login-fresh-${name}.png`, fullPage: true });
    await ctx.close();
  }
  await browser.close();
});
