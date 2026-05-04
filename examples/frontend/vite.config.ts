import tailwindcss from "@tailwindcss/vite";
import type { PluginOption } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss() as PluginOption,
    {
      name: "serve-sct-manifest",
      configureServer(server) {
        server.middlewares.use("/sct-manifest.json", (_req, res) => {
          const manifest = readFileSync(
            resolve(__dirname, "../../packages/framework-core-ui/sct-manifest.json"),
            "utf-8",
          );
          res.setHeader("Content-Type", "application/json");
          res.end(manifest);
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "../../packages/framework-core-ui/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    proxy: {
      "/ws": {
        target: "http://127.0.0.1:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
