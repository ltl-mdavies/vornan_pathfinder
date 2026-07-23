import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5190",
    browserName: "chromium",
    colorScheme: "light",
    locale: "en-US",
    serviceWorkers: "block",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npx vite --config tests/browser/fixtures/vite.config.ts",
    url: "http://127.0.0.1:5190",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
