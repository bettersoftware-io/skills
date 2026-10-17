#!/usr/bin/env node
// Turns the visual run's results file into a short summary for the CI job page.
//
//   node tools/visual/summary.mts >> "$GITHUB_STEP_SUMMARY"
//
// It reads the JSON report the Playwright config writes on every run. If that
// file is not there the run never reached the tests, and the summary says so:
// no results is no verdict, not a pass.
//
// Exit 0: every scenario passed. 1: at least one failed. 2: no results to read.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Level } from "../../packages/client-react/tests/visual/host/picture.ts";

/** The spec's one test that is not a scenario. It has no picture, so it has no level. */
const ORPHAN_CHECK = "every golden belongs to a scenario";

const RESULTS = "packages/client-react/tests/visual/reports/results.json";

/** The parts of Playwright's JSON report this reads. */
export interface Report {
  suites?: ReportSuite[];
  errors?: { message?: string }[];
}

interface ReportSuite {
  specs?: ReportSpec[];
  suites?: ReportSuite[];
}

interface ReportSpec {
  title: string;
  ok: boolean;
  tests?: {
    annotations?: { type?: string; description?: string }[];
    results?: { error?: { message?: string } }[];
  }[];
}

export interface Summary {
  exitCode: 0 | 1 | 2;
  /** How many pictures each level has, from the `level` annotation of each test. */
  levels: Record<Level, number>;
  markdown: string;
}

export function summarise(report: Report | undefined): Summary {
  if (report === undefined) {
    return {
      exitCode: 2,
      levels: countLevels([]),
      markdown: [
        "### Visual goldens: no verdict",
        "",
        `There is no results file (\`${RESULTS}\`), so the run stopped before any scenario was compared. Read the job log for the step that failed. This is not a pass.`,
      ].join("\n"),
    };
  }

  const specs = (report.suites ?? []).flatMap(listSpecs);
  const failed = specs.filter((spec) => !spec.ok);
  const levels = countLevels(specs);
  const pictures = `Pictures: ${count(levels.component, "component")}, ${count(levels.section, "section")}, ${count(levels.page, "page")}`;
  const startupErrors = (report.errors ?? []).map((error) => firstLine(error.message));

  if (specs.length === 0) {
    return {
      exitCode: 2,
      levels,
      markdown: [
        "### Visual goldens: no verdict",
        "",
        "The run compared no scenario. This is not a pass.",
        ...startupErrors.map((error) => `- ${error}`),
      ].join("\n"),
    };
  }

  if (failed.length === 0 && startupErrors.length === 0) {
    return { exitCode: 0, levels, markdown: `### Visual goldens: passed\n\n${specs.length} of ${specs.length} checks match the committed images.\n\n${pictures}` };
  }

  return {
    exitCode: 1,
    levels,
    markdown: [
      "### Visual goldens: failed",
      "",
      `${failed.length} of ${specs.length} checks failed.`,
      "",
      pictures,
      "",
      "| Check | Why |",
      "|---|---|",
      ...failed.map((spec) => `| \`${spec.title}\` | ${escapeCell(firstLine(firstError(spec)))} |`),
      ...startupErrors.map((error) => `| (run) | ${escapeCell(error)} |`),
      "",
      "Download the `visual-report` artifact of this run and open `index.html`: each failed check shows the committed image, the new one and the difference.",
      "",
      "- The change was not meant: fix the code.",
      "- The change was meant: regenerate the images (`pnpm visual:update` for your own system, the **Update visual goldens** workflow for Linux) and commit them with the change.",
      "- Do not regenerate to make a failure go away before you have looked at the difference.",
    ].join("\n"),
  };
}

function listSpecs(suite: ReportSuite): ReportSpec[] {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(listSpecs)];
}

/** A test with no level annotation is a page: that is what a scenario with no `Picture` field is. */
function countLevels(specs: ReportSpec[]): Record<Level, number> {
  const levels: Record<Level, number> = { component: 0, section: 0, page: 0 };

  for (const spec of specs) {
    if (spec.title !== ORPHAN_CHECK) {
      levels[readLevel(spec)] += 1;
    }
  }

  return levels;
}

function readLevel(spec: ReportSpec): Level {
  for (const test of spec.tests ?? []) {
    for (const annotation of test.annotations ?? []) {
      if (annotation.type === "level" && (annotation.description === "component" || annotation.description === "section")) {
        return annotation.description;
      }
    }
  }

  return "page";
}

/** "1 page", "2 pages", "0 pages". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function firstError(spec: ReportSpec): string | undefined {
  for (const test of spec.tests ?? []) {
    for (const result of test.results ?? []) {
      if (result.error?.message !== undefined) {
        return result.error.message;
      }
    }
  }

  return undefined;
}

/**
 * The line of an error that says what happened, without the colour codes a
 * terminal reporter adds. A failed comparison opens with a line that only
 * names the assertion; the line that counts is the one with the pixels or the
 * sizes, so that one is preferred. Otherwise the first line.
 */
function firstLine(message: string | undefined): string {
  const lines = (message ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return lines.find((line) => /pixels .* different|Expected an image/.test(line)) ?? lines[0] ?? "no error message";
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|");
}

/** True when Node was asked to run this file. Real paths, so a symlinked copy still runs. */
function isMainModule(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  const file = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), RESULTS);
  const summary = summarise(existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Report) : undefined);

  console.log(summary.markdown);
  process.exit(summary.exitCode);
}
