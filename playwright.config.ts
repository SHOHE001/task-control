import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:3199",
    viewport: { width: 390, height: 844 },
  },
  workers: 1,
  webServer: {
    command: "npx tsx tests/browser-server.ts",
    url: "http://127.0.0.1:3199",
    reuseExistingServer: false,
  },
  reporter: "list",
});
