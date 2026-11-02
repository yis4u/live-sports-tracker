import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  webServer: {
    command: "npm run dev -- --port 3000",
    url: "http://127.0.0.1:3000/api/auth/me",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
