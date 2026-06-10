import path from "path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "zustand/middleware",
      "recharts",
      "@base-ui/react/input",
      "@base-ui/react/field",
      "@base-ui/react/select",
      "@base-ui/react/slider",
      "@base-ui/react/dialog",
      "@base-ui/react/scroll-area",
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
});
