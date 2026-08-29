import { defineConfig, devices } from "@playwright/test";

// Runs the full E2E suite against the live prod URL.
// Each test owns its account so they can run in parallel without
// stomping each other's pods. Deploys take minutes — most tests use a
// long action timeout + a few retries on flakiness from cold container
// boots.

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: false, // serial — sharing a single VM, no point flooding it
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./e2e/.report", open: "never" }],
  ],
  timeout: 30 * 60 * 1000, // 30 min — a Paper install + first boot can take 4-6 minutes
  expect: {
    timeout: 15 * 1000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://pods-ml-prototype.eastus.cloudapp.azure.com",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 30 * 1000,
    navigationTimeout: 60 * 1000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
