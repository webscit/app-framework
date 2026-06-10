import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../packages/framework-core-ui/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["dist/**"],
  },
});
