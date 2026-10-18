import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  use: {
    headless: true,
    baseURL: "http://localhost:3000",
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  },
  webServer: {
    command: "npm run dev -w @restaurant/web -- --hostname localhost",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
});
