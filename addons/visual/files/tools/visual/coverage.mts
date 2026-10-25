#!/usr/bin/env node
// Ranks the UI files by what no visual scenario renders.
//
//   node tools/visual/coverage.mts              the thirty files with most left out
//   node tools/visual/coverage.mts --limit 10   the ten (or --limit=10)
//
// Every scenario is rendered in Chromium through the host's own render path
// (tests/visual/reach/), with no picture taken, and the coverage of
// `src/ui/**/*.tsx` is collected. The list names each file with statements no
// scenario reaches, the most first, and under it the lines of branches never
// taken and the functions never called: states no picture shows yet. The
// reports (json, summary, html) are in tests/visual/reports/coverage/.
//
// This is a report, not a gate. Exit 0: every scenario was rendered, and the
// list is printed. Exit 2: there is no list, and the reason is printed: an
// argument it cannot read; Vitest and its two packages here missing or on
// different versions; a scenario that could not be rendered; or a run that
// wrote no coverage. After a run, its full output is printed with the reason.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatReach, type IstanbulFile, rankReach } from "./lib/reach.mts";
import { checkVitestVersions, VITEST_PACKAGES } from "./lib/vitestVersions.mts";

const PACKAGE = "packages/client-react";
const CONFIG = "tests/visual/reach/vite.config.ts";
const COVERAGE = "tests/visual/reports/coverage/coverage-final.json";
const DEFAULT_LIMIT = 30;

/** The number of files to list: `--limit 10` or `--limit=10`, thirty when not given. */
export function parseLimit(argv: string[]): number {
  if (argv.length === 0) {
    return DEFAULT_LIMIT;
  }

  const [flag, value] = argv.length === 1 ? (argv[0] ?? "").split(/=(.*)/s) : argv;

  if (flag !== "--limit" || argv.length > 2 || !Number.isInteger(Number(value)) || Number(value) < 1) {
    throw new Error(`usage: node tools/visual/coverage.mts [--limit <a whole number above 0>], got "${argv.join(" ")}"`);
  }

  return Number(value);
}

function main(root: string, argv: string[]): number {
  let limit: number;

  try {
    limit = parseLimit(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 2;
  }

  const directory = join(root, PACKAGE);
  const versions = checkVitestVersions(readInstalledVersions(directory));

  if (versions !== undefined) {
    console.error(`visual:coverage: ${versions}`);

    return 2;
  }

  const vitest = join(directory, "node_modules/.bin/vitest");

  if (!existsSync(vitest)) {
    console.error(`visual:coverage: vitest is not installed in ${PACKAGE} (there is no node_modules/.bin/vitest). Run pnpm install.`);

    return 2;
  }

  // `--coverage` turns on the coverage the config sets. Vitest empties the
  // reports folder first, so a file from an earlier run is never read as this one's.
  // The module cache off, as in every test script: the kit's package-scripts gate says why.
  const run = spawnSync(vitest, ["run", "--config", CONFIG, "--coverage", "--no-fsModuleCache"], {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (run.status !== 0) {
    console.error([run.stdout, run.stderr, run.error?.message].filter(Boolean).join("\n"));
    console.error(`visual:coverage: the run ${run.status === null ? "did not finish" : `exited ${run.status}`}, so a scenario was not rendered. Nothing is ranked from a partial run.`);

    return 2;
  }

  const path = join(directory, COVERAGE);

  if (!existsSync(path)) {
    console.error([run.stdout, run.stderr].filter(Boolean).join("\n"));
    console.error(`visual:coverage: the run passed but wrote no ${PACKAGE}/${COVERAGE}. No coverage is no answer.`);

    return 2;
  }

  const coverage = JSON.parse(readFileSync(path, "utf8")) as Record<string, IstanbulFile>;

  console.log(`Not rendered by any visual scenario (reports in ${PACKAGE}/tests/visual/reports/coverage/):\n`);
  console.log(formatReach(rankReach(coverage, realpathSync(root)), limit));

  return 0;
}

/** Each package's version as the client package resolves it; `undefined` when it is not installed there. */
function readInstalledVersions(directory: string): Record<string, string | undefined> {
  return Object.fromEntries(
    VITEST_PACKAGES.map((name) => {
      const manifest = join(directory, "node_modules", name, "package.json");

      return [name, existsSync(manifest) ? (JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }).version : undefined];
    }),
  );
}

/** True when Node was asked to run this file. Real paths, so a symlinked copy still runs. */
function isMainModule(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  process.exit(main(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), process.argv.slice(2)));
}
