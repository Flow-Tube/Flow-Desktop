import { defineConfig } from "vitest/config";

// Standalone from vite.config so tests don't load the React/Tailwind plugins.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
