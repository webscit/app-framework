import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";

export default defineConfig({
  plugins: [tailwindcss() as PluginOption],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "zustand/middleware", "recharts"],
  },
});
