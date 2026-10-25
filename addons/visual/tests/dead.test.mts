import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkDead } from "../../strict-lint/files/tools/strict-lint/check-dead.mts";
import { installedTools } from "../../strict-lint/files/tools/strict-lint/lib/run.mts";
import { copyInto, createPackageJson, createProject, createTsconfig, REAL_TOOL_TIMEOUT, writeFiles } from "../../strict-lint/tests/support.mts";

// An update replaces the add-on's files and leaves the project's own as they
// were. The project then runs `gate:full`, whose `lint:dead` is the real knip
// with strict-lint's config. Nothing the add-on ships may need an edit of a
// project's file to count as used. This runs that: the add-on's files over
// the starting files of release 0.18.1, whose scenarios.ts does not know
// `Picture` and which has no registry.tsx. And a fresh install, with every
// starting file as the add-on ships it.

const VISUAL = "packages/client-react/tests/visual";
const ADDON_FILES = join(import.meta.dirname, "..", "files");

/** The starting files as 0.18.1 wrote them, in the parts knip looks at. */
const OLD_PROJECT_FILES = {
  [`${VISUAL}/scenarios.ts`]: "export interface Scenario {\n  prices: readonly { symbol: string; mid: number }[];\n}\n\nexport const scenarios: Record<string, Scenario> = {\n  app: { prices: [] },\n};\n",
  [`${VISUAL}/seeding.ts`]:
    'import type { Scenario } from "./scenarios.ts";\n\nexport function seedScenario(scenario: Scenario): number {\n  return scenario.prices.length;\n}\n',
  [`${VISUAL}/tolerance.ts`]: "export const TOLERANCE = { maxDiffPixelRatio: 0, threshold: 0 };\n",
};

/**
 * Playwright and Vite are not installed in this repository, so knip cannot
 * load their configs. Each is replaced by a config that reaches the same
 * files; those are the add-on's own.
 */
const CONFIG_STUBS = {
  [`${VISUAL}/playwright.config.ts`]: 'import { HOST_URL } from "./host/address.ts";\n\nexport default { testDir: ".", testMatch: "visual.pw.ts", use: { baseURL: HOST_URL } };\n',
  [`${VISUAL}/host/vite.config.ts`]: 'import { HOST, PORT } from "./address.ts";\n\nexport default { root: import.meta.dirname, server: { host: HOST, port: PORT } };\n',
  [`${VISUAL}/reach/vite.config.ts`]: 'export default { root: new URL("../../..", import.meta.url).pathname, test: { include: ["tests/visual/reach/reach.browser.tsx"] } };\n',
};

/** A project with the add-on's files, before any starting file is replaced. */
function createProjectWithAddon(): string {
  const project = createProject({
    "package.json": createPackageJson({ name: "fixture", scripts: { "lint:dead": "node tools/strict-lint/check-dead.mts" }, devDependencies: { knip: "^6.17.1" } }),
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
    "packages/client-react/package.json": createPackageJson({
      name: "@app/client-react",
      exports: { ".": "./src/index.ts", "./*": "./src/*" },
      devDependencies: { "@playwright/test": "1.63.0" },
    }),
    "packages/client-react/tsconfig.json": createTsconfig(["src"]),
    "packages/client-react/src/index.ts": 'console.info("app");\n',
  });

  copyInto(project, ADDON_FILES, new Set(["goldens"]));
  writeFiles(project, CONFIG_STUBS);

  return project;
}

/** The project after an update: the add-on's files, its own files as 0.18.1 left them. */
function createUpdatedProject(): string {
  const project = createProjectWithAddon();

  rmSync(join(project, VISUAL, "registry.tsx"));
  writeFiles(project, OLD_PROJECT_FILES);

  return project;
}

/** The parts of knip's JSON report read here: one entry per file with an issue, each kind a list of names. An unused file lists itself under `files`. */
interface KnipReport {
  issues: ({ file: string } & Partial<Record<"files" | "exports" | "types", { name: string }[]>>)[];
}

/**
 * The unused files and exports knip finds, from its JSON report: the same run
 * as the gate's, with `--reporter json`. Only files and exports: the packages
 * the add-on's files name (React, Playwright) are not installed in this
 * fixture, so its dependency findings mean nothing.
 */
function findUnused(project: string): string[] {
  const run = installedTools(project);
  const { report } = checkDead(project, (name, args) => run(name, [...args, "--reporter", "json"]));
  const { issues } = JSON.parse(report === "" ? '{"issues":[]}' : report) as KnipReport;

  return issues.flatMap((issue) => (["files", "exports", "types"] as const).flatMap((kind) => (issue[kind] ?? []).map(({ name }) => `${kind}: ${name} in ${issue.file}`)));
}

describe("lint:dead with the project's files untouched", { timeout: REAL_TOOL_TIMEOUT }, () => {
  it("reports no file and no export of the add-on's after an update", () => {
    expect(findUnused(createUpdatedProject())).toEqual([]);
  });

  it("reports no file and no export of the add-on's after a fresh install", () => {
    expect(findUnused(createProjectWithAddon())).toEqual([]);
  });
});
