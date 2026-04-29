import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  optimizeDeps: {
    // zustand/middleware is a CJS module that Vite does not pre-bundle by default
    // in browser mode. Without this, Vite unexpectedly reloads mid-test run which
    // can cause flaky behaviour and duplicated test runs.
    include: ["zustand/middleware"],
  },
  test: {
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["dist/**"],
  },
});
