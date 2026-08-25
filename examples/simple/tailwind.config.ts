import type { Config } from "tailwindcss";

export default {
  content: [
    "./frontend/**/*.{ts,tsx}",
    "../../packages/framework-core-ui/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
