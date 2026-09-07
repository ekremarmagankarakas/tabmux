import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  fullyParallel: false, // each test drives its own persistent browser context; keep it simple
  reporter: "list",
});
