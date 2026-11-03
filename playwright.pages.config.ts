import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pages-e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:8788",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  webServer: {
    command: "npm run preview:pages",
    url: "http://127.0.0.1:8788/live-sports-tracker/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
