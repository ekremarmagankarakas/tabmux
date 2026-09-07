import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom", // content/ modules touch document/window (incl. attachShadow) inside functions
    include: ["test/unit/**/*.test.js"],
  },
});
