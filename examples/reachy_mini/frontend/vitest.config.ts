import path from "path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../../packages/framework-core-ui/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-dev-runtime"],
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
