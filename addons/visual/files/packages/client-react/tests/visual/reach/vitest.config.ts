import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { FRAMING } from "../framing.ts";

// `pnpm visual:coverage`: every scenario rendered in Chromium, through the
// host's own `showScenario`, with no picture taken, and the UI's coverage
// collected. What it leaves out is what no picture shows.
//
// The provider is v8, as in the `coverage` add-on: Vitest collects it from
// Chromium over the DevTools protocol, so the code is not rewritten first.
//
// This file is the add-on's, and an update replaces it.
export default defineConfig({
  // packages/client-react, so the globs below read from the package.
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  // A cache of its own, so this run and the package's unit tests never
  // invalidate each other's.
  cacheDir: fileURLToPath(
    new URL("../../../node_modules/.vite-visual-reach", import.meta.url),
  ),
  // The host's plugins, so the code measured is built as the pictures build it.
  plugins: [react()],
  test: {
    // Not `*.spec` or `*.test`: the package's unit test runner collects those
    // names, and this file can only run in a browser.
    include: ["tests/visual/reach/reach.browser.tsx"],
    browser: {
      enabled: true,
      headless: true,
      // Chromium as the pictures launch it. See playwright.config.ts.
      provider: playwright({
        launchOptions: { args: ["--disable-partial-raster"] },
      }),
      instances: [{ browser: "chromium" }],
      viewport: FRAMING.viewport,
    },
    coverage: {
      provider: "v8",
      include: ["src/ui/**/*.tsx"],
      exclude: ["src/ui/**/*.test.tsx", "src/ui/**/*.page.tsx"],
      reporter: ["json", "json-summary", "html"],
      reportsDirectory: "tests/visual/reports/coverage",
    },
  },
});
