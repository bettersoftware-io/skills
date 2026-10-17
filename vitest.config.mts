import { defineConfig } from "vitest/config";

export default defineConfig({
  // The add-ons ship TypeScript whose tsconfig extends a file that exists only
  // in a project, so the transform must not look for one.
  // (Vite's transform reads this option; its type does not list it yet.)
  oxc: { tsconfig: false } as Record<string, unknown>,
  test: {
    include: ["kit/**/*.test.mts", "scripts/**/*.test.mts", "addons/*/tests/**/*.test.mts"],
  },
});
