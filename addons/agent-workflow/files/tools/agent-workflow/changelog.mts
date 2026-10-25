#!/usr/bin/env node
// The checkable half of writing CHANGELOG.md.
//
//   node tools/agent-workflow/changelog.mts weeks            which weeks have no entry yet
//   node tools/agent-workflow/changelog.mts due [--ref <ref>]  which finished weeks still need writing or extending, offline
//   node tools/agent-workflow/changelog.mts prs 2026-W40     what was merged in a week
//   node tools/agent-workflow/changelog.mts check 2026-W40   do the week's citations equal its merges?
//   node tools/agent-workflow/changelog.mts defs [--write]   are the link definitions the generated ones?
//   node tools/agent-workflow/changelog.mts tag 2026-W40 [--apply]  tag a finished week that has no tag; never moves one
//
// `prs` and `check` ask GitHub, through `gh`, which pull requests were merged
// in the week (by merge time, in UTC). They only read. For a run with no
// network, `--merged 12,15,19` gives `check` the numbers instead.
//
// Exit 0: `check` found nothing wrong. Exit 1: it found something, named
// above the FAIL line. Exit 2: nothing was judged (no `gh`, no network, a
// name that is no week, no CHANGELOG.md, an `origin` that is not on GitHub).
// `due` exits 0 when nothing is due, 1 when it lists weeks, and 2 when it
// could not judge (no CHANGELOG.md, no remote branch, a ref git cannot read,
// or a ref that starts with `-`).
// `tag` plans by default and writes only with `--apply`. It refuses a week
// that is not over, and a week that already has a tag. Exit 1 for those and
// for a GitHub step that failed.
//
// `defs` prints the definition lines that differ and exits 1, or with
// `--write` rewrites the file and exits 0. Exit 2 is not a pass.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ChangelogError, checkWeek, type MergedPullRequest, weeksIn, weeksToWrite, withDefinitions } from "./lib/changelog.mts";
import { describeDue, type DueWeek, findDue } from "./lib/due.mts";
import { HistoryError, remoteBranch, repositoryUrl } from "./lib/history.mts";
import { isMainModule } from "./lib/main.mts";
import { type Run, run } from "./lib/system.mts";
import { createWeekTag, tagDate } from "./lib/tag.mts";
import { endOf, isInWeek, parseWeek, type Week, WeekError } from "./lib/week.mts";

/** `gh pr list` returns at most this many. A week that reaches it may be cut short. */
const LIMIT = 500;

export { ChangelogError };

export interface ChangelogOptions {
  root: string;
  argv: string[];
  now: Date;
  run: Run;
  report: (line: string) => void;
}

/** Runs one subcommand and returns the exit code. */
export function changelog({ root, argv, now, run: runProgram, report }: ChangelogOptions): number {
  const [command, weekName] = argv;

  try {
    if (command === "weeks") {
      for (const week of weeksToWrite(readChangelog(root), now)) {
        report(describeWeek(week));
      }

      const extend = newestExtension(root, runProgram, now);

      if (extend !== undefined) {
        report(`${describeWeek(extend.week)}  extend: ${extend.missing.length} not cited`);
      }

      return 0;
    }

    if (command === "due") {
      const at = argv.indexOf("--ref");
      const ref = at === -1 ? undefined : argv[at + 1];

      if (at !== -1 && ref === undefined) {
        throw new ChangelogError("--ref needs a git ref");
      }

      // git would read it as an option: `--output=<file>` makes `git log` write a file.
      if (ref?.startsWith("-")) {
        throw new ChangelogError(`--ref needs a git ref, and "${ref}" starts with a dash`);
      }

      const due = findDue(root, runProgram, now, ref);

      for (const week of due) {
        report(describeDue(week));
      }

      return due.length === 0 ? 0 : 1;
    }

    if (command === "prs" && weekName !== undefined) {
      const week = parseWeek(weekName);
      const merged = listMerged(week, root, runProgram);

      report(`${describeWeek(week)}  ${merged.length} merged`);

      for (const { number, title, mergedAt } of merged) {
        report(`${mergedAt.slice(0, 10)}\t#${number}\t${title}`);
      }

      return 0;
    }

    if (command === "check" && weekName !== undefined) {
      const week = parseWeek(weekName);
      const given = argv.indexOf("--merged");
      const merged = given === -1 ? listMerged(week, root, runProgram).map(({ number }) => number) : parseNumbers(argv[given + 1]);
      const problems = checkWeek(readChangelog(root), week.name, merged, requireRepository(root, runProgram));

      for (const problem of problems) {
        report(`  ${problem}`);
      }

      report(
        problems.length === 0
          ? `PASS changelog ${week.name}: ${merged.length} merged pull request(s), all cited, every citation defined`
          : `FAIL changelog ${week.name}: ${problems.length} problem(s). Fix CHANGELOG.md and run this again`,
      );

      return problems.length === 0 ? 0 : 1;
    }

    if (command === "tag" && weekName !== undefined) {
      return tagWeek(parseWeek(weekName), { root, now, run: runProgram, report, apply: argv.includes("--apply") });
    }

    if (command === "defs") {
      const text = readChangelog(root);
      const wanted = withDefinitions(text, requireRepository(root, runProgram));

      if (argv.includes("--write")) {
        writeFileSync(join(root, "CHANGELOG.md"), wanted);
        report("wrote the link definitions of CHANGELOG.md");

        return 0;
      }

      if (wanted === text) {
        report("PASS changelog defs: the link definitions are the generated ones");

        return 0;
      }

      const differing = differingLines(text, wanted);

      for (const line of differing) {
        report(line);
      }

      report("FAIL changelog defs: the link definitions differ. Run `pnpm changelog defs --write`");

      return 1;
    }
  } catch (error) {
    if (error instanceof ChangelogError || error instanceof HistoryError || error instanceof WeekError) {
      report(`SKIP changelog: ${error.message}. Nothing was judged`);

      return 2;
    }

    throw error;
  }

  report("usage: changelog.mts weeks | due [--ref <ref>] | prs <week> | check <week> [--merged 12,15] | defs [--write] | tag <week> [--apply]   (a week is written 2026-W40)");

  return 2;
}

/** The pull requests merged inside the week, oldest first. */
export function listMerged(week: Week, root: string, runProgram: Run): MergedPullRequest[] {
  const listed = runProgram(
    "gh",
    ["pr", "list", "--state", "merged", "--search", `merged:${week.start}..${week.end}`, "--limit", String(LIMIT), "--json", "number,title,mergedAt"],
    root,
  );

  if (listed.status !== 0) {
    throw new ChangelogError(`gh could not list the merged pull requests (${listed.stderr.trim() || `exit ${listed.status}`})`);
  }

  const found = JSON.parse(listed.stdout) as MergedPullRequest[];

  if (found.length >= LIMIT) {
    throw new ChangelogError(`gh returned ${found.length} pull requests, its limit, so the list may be cut short`);
  }

  // GitHub's search takes days; the week is exact to the instant.
  return found.filter(({ mergedAt }) => isInWeek(week, mergedAt)).sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
}

interface TagOptions {
  root: string;
  now: Date;
  run: Run;
  report: (line: string) => void;
  apply: boolean;
}

/** Tags the last first-parent commit of a finished week that has no tag. Never moves or replaces one. */
function tagWeek(week: Week, { root, now, run: runProgram, report, apply }: TagOptions): number {
  if (endOf(week) > now.getTime()) {
    report(`FAIL changelog tag: ${week.name} is not over yet: its tag is made by the weekly workflow`);

    return 1;
  }

  const branch = remoteBranch(root, runProgram);

  if (branch === undefined) {
    throw new ChangelogError("there is no origin/HEAD or origin/main to take the week's last commit from");
  }

  const gh = (...args: string[]) => runProgram("gh", args, root);
  const named = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner");
  const repository = named.stdout.trim();

  if (named.status !== 0 || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new ChangelogError(`gh could not name the repository (${named.stderr.trim() || `exit ${named.status}`})`);
  }

  const existing = gh("api", `repos/${repository}/git/ref/tags/${week.name}`, "--silent");

  if (existing.status === 0) {
    report(`FAIL changelog tag: the tag ${week.name} exists. This never moves a tag`);

    return 1;
  }

  // Only "there is no such tag" lets this go on. Any other failure is not an answer.
  if (!/404|Not Found/i.test(existing.stderr)) {
    report(`FAIL changelog tag: could not ask GitHub whether ${week.name} exists (${existing.stderr.trim() || `exit ${existing.status}`})`);

    return 1;
  }

  // The last second of the week: `--before` includes the instant it is given.
  const boundary = new Date(endOf(week) - 1000).toISOString();
  const found = runProgram("git", ["rev-list", "-1", "--first-parent", `--before=${boundary}`, branch], root);

  if (found.status !== 0) {
    report(`FAIL changelog tag: git could not read the history (${found.stderr.trim()})`);

    return 1;
  }

  const sha = found.stdout.trim();

  if (sha === "") {
    report(`FAIL changelog tag: no commit reached the default branch before the end of ${week.name}: there is nothing to tag`);

    return 1;
  }

  if (!apply) {
    // The commit's date and subject, so that the person approves a commit they know.
    const shown = runProgram("git", ["log", "-1", "--format=%cI%x09%s", "--end-of-options", sha], root);

    if (shown.status !== 0) {
      report(`FAIL changelog tag: git could not read the commit ${sha} (${shown.stderr.trim()})`);

      return 1;
    }

    const [committed = "", ...subject] = shown.stdout.trim().split("\t");

    report(`would tag ${sha} (${new Date(committed).toISOString().replace(".000Z", "Z")}, "${subject.join("\t")}") as ${week.name}, dated ${tagDate(week)}`);

    return 0;
  }

  const tagged = createWeekTag(week, sha, repository, gh);

  if (!tagged.ok) {
    report(`FAIL changelog tag: GitHub did not create the tag${tagged.step === "object" ? " object" : ""} (${tagged.error})`);

    return 1;
  }

  report(`Tagged ${sha} as ${week.name}, dated ${tagDate(week)}`);

  return 0;
}

/** The lines only in `current`, marked `-`, then the lines only in `wanted`, marked `+`. */
function differingLines(current: string, wanted: string): string[] {
  const before = current.split("\n");
  const after = wanted.split("\n");

  const lines = [
    ...before.filter((line) => line !== "" && !after.includes(line)).map((line) => `- ${line}`),
    ...after.filter((line) => line !== "" && !before.includes(line)).map((line) => `+ ${line}`),
  ];

  return lines.length > 0 ? lines : ["~ the definitions are out of order, repeated, or not in one block at the end"];
}

function requireRepository(root: string, runProgram: Run): string {
  const repository = repositoryUrl(root, runProgram);

  if (repository === undefined) {
    throw new ChangelogError("the origin remote is not a GitHub address, so the link definitions cannot be judged");
  }

  return repository;
}

function readChangelog(root: string): string {
  const file = join(root, "CHANGELOG.md");

  if (!existsSync(file)) {
    throw new ChangelogError("there is no CHANGELOG.md at the project root");
  }

  return readFileSync(file, "utf8");
}

function parseNumbers(text: string | undefined): number[] {
  const numbers = (text ?? "").split(",").filter(Boolean).map(Number);

  if (text === undefined || numbers.some((number) => !Number.isInteger(number) || number <= 0)) {
    throw new ChangelogError(`--merged needs pull request numbers separated by commas, got "${text ?? ""}"`);
  }

  return numbers;
}

/** The due week that has a heading and is the newest one in the working file, when it can be judged. */
function newestExtension(root: string, runProgram: Run, now: Date): DueWeek | undefined {
  try {
    const newest = weeksIn(readChangelog(root)).sort().at(-1);

    return findDue(root, runProgram, now).find(({ week, extend }) => extend && week.name === newest);
  } catch (error) {
    if (error instanceof ChangelogError || error instanceof HistoryError) {
      return undefined;
    }

    throw error;
  }
}

function describeWeek(week: Week): string {
  return `${week.name}  ${week.start}..${week.end}`;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = changelog({
    root: dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
    argv: process.argv.slice(2),
    now: new Date(),
    run,
    report: (line) => console.log(line),
  });
}
