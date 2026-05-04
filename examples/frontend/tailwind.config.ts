import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/framework-core-ui/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
