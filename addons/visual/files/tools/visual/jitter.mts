#!/usr/bin/env node
// Measures how much the visual tier's screenshots differ when nothing changed.
//
//   pnpm visual:jitter                  capture this commit 3 times here, compare
//   pnpm visual:jitter --runs 5         the same, with 5 captures
//   pnpm visual:jitter --scenario a --scenario b
//                                       capture only those scenarios
//   pnpm visual:jitter <dirA> <dirB>    compare captures made elsewhere, e.g. the
//                                       artifacts of several update-workflow runs
//
// The answer is the noise floor: the tolerance in tolerance.ts has to sit above
// it, and as little above it as you can bear. Each image is judged by the
// tolerance its own scenario resolves to, so a scenario with a `maxDiffPixels`,
// `pixelThreshold` or `strict` of its own is held to that. Run this before
// changing any of them, and measure the scenario you are changing. A tolerance
// set by feel is wrong in one of two ways: too tight and the tier fails on its
// own, too loose and it stops seeing real changes.
//
// Only the scenarios measured are read for their tolerance, so one that
// contradicts itself stops the run (exit 2, naming it) only when its pictures
// are captured or compared.
//
// Exit 0: measured, and the tolerance sits above the noise. 1: it does not.
// 2: nothing could be measured.

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Framing, PictureError, type Tolerance } from "../../packages/client-react/tests/visual/host/picture.ts";
import { grepFor, type JitterRequest, parseArguments, UsageError } from "./lib/arguments.mts";
import { createToleranceOf, judgeNoise, listPngs, measureNoise, scenarioNameOf } from "./lib/measure.mts";

const PROJECT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CLIENT = join(PROJECT, "packages", "client-react");
const CAPTURES = join(CLIENT, "tests", "visual", "reports", "jitter");

/**
 * Takes the screenshot of every scenario (or of the `chosen` ones) `runs`
 * times, each time with a server of its own, into a folder of its own. The
 * committed goldens are not touched. Returns the folders, or undefined if a
 * run failed.
 */
function captureRuns(runs: number, chosen: string[]): string[] | undefined {
  const playwright = join(CLIENT, "node_modules", ".bin", "playwright");

  if (!existsSync(playwright)) {
    console.error(`No measurement: ${playwright} is not there. Run pnpm install first.`);

    return undefined;
  }

  rmSync(CAPTURES, { recursive: true, force: true });

  const directories: string[] = [];

  for (let run = 1; run <= runs; run += 1) {
    const directory = join(CAPTURES, `run-${run}`);
    const result = spawnSync(
      playwright,
      [
        "test",
        "--config",
        "tests/visual/playwright.config.ts",
        "--update-snapshots=all",
        "--reporter=line",
        ...(chosen.length > 0 ? ["-g", grepFor(chosen)] : []),
      ],
      { cwd: CLIENT, encoding: "utf8", env: { ...process.env, VISUAL_GOLDENS_DIR: directory } },
    );

    if (result.status !== 0) {
      // The whole output, unfiltered: a cut-down summary can hide the line that matters.
      console.error(`${result.stdout}${result.stderr}`);
      console.error(`No measurement: capture ${run} of ${runs} failed (see above). Fix that first; \`pnpm visual\` shows the same failure.`);

      return undefined;
    }

    console.log(`Capture ${run} of ${runs}: done`);
    directories.push(directory);
  }

  return directories;
}

/** Why a project file Node could not load stops the measurement: its imports and syntax are the project's to fix. */
const NODE_LOADS_THEM =
  "pnpm visual:jitter runs them in plain Node, so their imports must be type-only or Node-loadable, name their file with `.ts`, and use only erasable syntax (no `enum`, `namespace` or parameter property).";

interface ProjectFiles {
  scenarios: Record<string, unknown>;
  FRAMING: Framing;
  TOLERANCE: Tolerance;
}

/**
 * Loads the project's `scenarios.ts`, `framing.ts` and `tolerance.ts` in plain
 * Node, as they are. A failure is the project's to fix, so it is said in a
 * sentence and not thrown.
 */
async function loadProjectFiles(): Promise<ProjectFiles | string> {
  try {
    const [{ scenarios }, { FRAMING }, { TOLERANCE }] = await Promise.all([
      import("../../packages/client-react/tests/visual/scenarios.ts"),
      import("../../packages/client-react/tests/visual/framing.ts"),
      import("../../packages/client-react/tests/visual/tolerance.ts"),
    ]);

    return { scenarios, FRAMING, TOLERANCE };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0];

    return `No measurement: Node could not load the project's visual files (scenarios.ts, framing.ts, tolerance.ts): ${reason}\n${NODE_LOADS_THEM}`;
  }
}

async function runJitter(argv: string[]): Promise<number> {
  let request: JitterRequest;

  try {
    request = parseArguments(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) {
      throw error;
    }

    console.error(`${error.message}\n\nusage: pnpm visual:jitter [--runs N] [--scenario NAME ...]\n       pnpm visual:jitter <dirA> <dirB> [dirC ...]`);

    return 2;
  }

  const project = await loadProjectFiles();

  if (typeof project === "string") {
    console.error(project);

    return 2;
  }

  const { scenarios, FRAMING, TOLERANCE } = project;
  const unknown = request.mode === "capture" ? request.scenarios.filter((name) => !Object.hasOwn(scenarios, name)) : [];

  if (unknown.length > 0) {
    console.error(`No measurement: no scenario named ${unknown.map((name) => `"${name}"`).join(", ")} in scenarios.ts.`);

    return 2;
  }

  // The scenarios whose pictures are measured: the only ones resolved.
  const measured =
    request.mode === "compare"
      ? request.directories.flatMap((directory) => [...listPngs(directory).keys()].map(scenarioNameOf))
      : request.scenarios.length > 0
        ? request.scenarios
        : Object.keys(scenarios);
  let toleranceOf: ReturnType<typeof createToleranceOf>;

  try {
    toleranceOf = createToleranceOf(scenarios, FRAMING, TOLERANCE, measured);
  } catch (error) {
    if (!(error instanceof PictureError)) {
      throw error;
    }

    console.error(`No measurement: ${error.message}`);

    return 2;
  }

  const directories = request.mode === "capture" ? captureRuns(request.runs, request.scenarios) : request.directories;

  if (directories === undefined) {
    return 2;
  }

  const measurement = measureNoise(directories, (image) => toleranceOf(image).threshold);
  const verdict = judgeNoise(measurement, toleranceOf);
  const orphans = measurement.images.map((noise) => noise.image).filter((image) => !Object.hasOwn(scenarios, scenarioNameOf(image)));

  console.log(`\n${verdict.lines.join("\n")}`);

  if (orphans.length > 0) {
    console.log(`\nNo scenario owns ${orphans.join(", ")}, so ${orphans.length === 1 ? "it was" : "they were"} judged by the global tolerance.`);
  }

  return verdict.exitCode;
}

/** True when Node was asked to run this file. Real paths, so a symlinked copy still runs. */
function isMainModule(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  process.exit(await runJitter(process.argv.slice(2)));
}
