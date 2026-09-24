import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, STATE_FILE } from "./support/env.js";

// See README.md. The suite drives one shared test account, so it runs one
// test at a time: parallel workers would work (every test seeds its own
// trip), but dev is a single small replica and CI time isn't the bottleneck.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.js",
  globalTeardown: "./global-teardown.js",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    storageState: STATE_FILE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // The app is laid out for phones (a 430px column), so test at a
      // phone's size.
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
  ],
});
