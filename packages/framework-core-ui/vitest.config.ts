import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    optimizeDeps: {
      include: [
        "zustand/middleware",
        "@base-ui/react/input",
        "@base-ui/react/field",
        "@base-ui/react/select",
        "@base-ui/react/slider",
      ],
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
  }),
);
