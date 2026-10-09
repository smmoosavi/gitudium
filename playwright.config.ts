import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser",
  testMatch: "**/*.browser.ts",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:5174", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { command: "pnpm exec vite --host 127.0.0.1 --port 5174", url: "http://127.0.0.1:5174", reuseExistingServer: false },
});
