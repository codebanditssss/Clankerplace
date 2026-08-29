// Hover-screenshot script for the pod-family rows.
// Run with: node landing/scripts-hover-shot.mjs
import { chromium } from "playwright";

const URL  = "http://localhost:4000/";
const OUT  = "/tmp/pods-dev/screens";
const W    = 1440;
const H    = 3400;

const browser = await chromium.launch();
const ctx     = await browser.newContext({ viewport: { width: W, height: H } });
const page    = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });

const rows = page.locator('#pods ol > li');
const count = await rows.count();
console.log(`Found ${count} pod rows.`);

async function shotHover(i, name) {
  await rows.nth(i).scrollIntoViewIfNeeded();
  await rows.nth(i).hover();
  await page.waitForTimeout(450);
  const box = await rows.nth(i).boundingBox();
  if (!box) return;
  await page.screenshot({
    path: `${OUT}/podrow-hover-${name}.png`,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width:  Math.min(W,  box.width  + 16),
      height: Math.min(H,  box.height + 16),
    },
  });
  console.log(`✓ shot ${name}  (${Math.round(box.width)}×${Math.round(box.height)})`);
}

// Move cursor to top-left so the default-state shot has no row hovered.
await page.mouse.move(0, 0);
await page.waitForTimeout(200);
const section = page.locator('#pods');
const sbox0 = await section.boundingBox();
if (sbox0) {
  await page.screenshot({
    path: `${OUT}/podrow-default-all-collapsed.png`,
    clip: { x: 0, y: sbox0.y, width: W, height: Math.min(H, sbox0.height + 32) },
  });
  console.log("✓ shot section (default, all collapsed)");
}

await shotHover(0, "hermes");
await shotHover(1, "code-sandbox");
await shotHover(2, "n8n");
await shotHover(3, "minecraft");

// Hermes-hovered section overview.
await rows.nth(0).scrollIntoViewIfNeeded();
await rows.nth(0).hover();
await page.waitForTimeout(450);
const sbox = await section.boundingBox();
if (sbox) {
  await page.screenshot({
    path: `${OUT}/podrow-hover-section.png`,
    clip: { x: 0, y: sbox.y, width: W, height: Math.min(H, sbox.height + 32) },
  });
  console.log("✓ shot section (hermes hovered)");
}

await browser.close();
