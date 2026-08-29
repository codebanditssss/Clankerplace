import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
await p.screenshot({ path: '/tmp/pods-screenshots/login-glyph.png', fullPage: false });
await b.close();
console.log('done');
