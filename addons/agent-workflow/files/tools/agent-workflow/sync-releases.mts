#!/usr/bin/env node
// Mirrors CHANGELOG.md onto GitHub Releases: one release per tagged week,
// titled like its heading, its notes made from that week's section.
// CHANGELOG.md stays the only source. A release is never edited by hand: it
// is rewritten here whenever its section changes.
//
//   node tools/agent-workflow/sync-releases.mts [--apply]   plan against GitHub; --apply carries the plan out
//   node tools/agent-workflow/sync-releases.mts --body 2026-W41   print one week's release notes
//   node tools/agent-workflow/sync-releases.mts --check     render every week offline
//
//   --repo <owner/name>   defaults to the repository `gh repo view` names
//   --branch <name>       the branch relative links point at; defaults to the repository's default branch, asked of gh
//   --only <week>         write just that week's release (Latest is still judged across every week)
//   --state <file>        read {tags, releases, latestTag} from a JSON file instead of GitHub
//
// A week gets a release only once its tag exists (`changelog tag` or the
// weekly-tag workflow makes it). The newest tagged week is marked Latest.
//
// Exit 0: nothing wrong (a plan, or --check with no week yet). Exit 1: a week
// does not render, GitHub refused a write, or --only names no tagged week.
// Exit 2: nothing was judged (no CHANGELOG.md, no repository, GitHub could
// not be asked).

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { isMainModule } from "./lib/main.mts";
import { definitionMap, parseWeeks, type Plan, planReleases, type Release, ReleaseError, type RemoteState, renderCheck, renderReleaseBody } from "./lib/releases.mts";
import { type Run, run } from "./lib/system.mts";

export interface SyncOptions {
  root: string;
  argv: string[];
  run: Run;
  report: (line: string) => void;
}

/** A reason nothing could be judged. */
class SkipError extends Error {}

const USAGE = "usage: sync-releases.mts [--repo owner/name] [--branch main] [--apply] [--only <week>] [--body <week>] [--state <file>] [--check]";

export function syncReleases({ root, argv, run: runProgram, report }: SyncOptions): number {
  try {
    return sync({ root, argv, run: runProgram, report });
  } catch (error) {
    if (error instanceof SkipError) {
      report(`SKIP sync-releases: ${error.message}. Nothing was judged`);

      return 2;
    }

    if (error instanceof ReleaseError) {
      report(`FAIL sync-releases: ${error.message}. Add the definition, or run \`pnpm changelog defs --write\``);

      return 1;
    }

    throw error;
  }
}

function sync({ root, argv, run: runProgram, report }: SyncOptions): number {
  const args = readArgs(argv);
  const file = join(root, "CHANGELOG.md");

  if (!existsSync(file)) {
    throw new SkipError("there is no CHANGELOG.md at the project root");
  }

  const text = readFileSync(file, "utf8");
  const weeks = parseWeeks(text);

  if (args.check) {
    return check(text, report);
  }

  const repo = args.repo ?? nameRepository(root, runProgram);
  // An empty --branch is no branch: a scheduled workflow run has no default branch in its event.
  const branch = args.branch ? args.branch : defaultBranch(repo, root, runProgram);
  const repoUrl = `https://github.com/${repo}`;
  const definitions = definitionMap(text);

  if (args.body !== undefined) {
    const week = weeks.find(({ tag }) => tag === args.body);

    if (week === undefined) {
      throw new SkipError(`there is no ${args.body} section in CHANGELOG.md`);
    }

    report(renderReleaseBody(week, definitions, repoUrl, branch));

    return 0;
  }

  const state = args.state === undefined ? fetchRemoteState(repo, root, runProgram) : (JSON.parse(readFileSync(resolve(root, args.state), "utf8")) as RemoteState);
  const full = planReleases(weeks, state, (week) => renderReleaseBody(week, definitions, repoUrl, branch));

  // A week that is not tagged, or has no section, would give an empty plan that reads as nothing to do.
  if (args.only !== undefined && ![...full.changes.map(({ tag }) => tag), ...full.unchanged].includes(args.only)) {
    report(`FAIL sync-releases: no tagged week ${args.only} in CHANGELOG.md`);

    return 1;
  }

  const plan = args.only === undefined ? full : { ...full, changes: full.changes.filter(({ tag }) => tag === args.only) };

  printPlan(plan, report);

  return args.apply ? applyPlan(plan, repo, root, runProgram, report) : 0;
}

/** Renders every week with no network. A file with no week yet has nothing to judge, and that is not a failure. */
function check(text: string, report: (line: string) => void): number {
  const { weeks: count, problems } = renderCheck(text);

  if (count === 0) {
    report("SKIP sync-releases: CHANGELOG.md has no week yet, so there is no release to render");

    return 0;
  }

  for (const problem of problems) {
    report(`  ${problem}`);
  }

  report(
    problems.length === 0
      ? `PASS sync-releases: ${count} week(s) render as release notes`
      : `FAIL sync-releases: ${problems.length} week(s) do not render. Fix CHANGELOG.md and run this again`,
  );

  return problems.length === 0 ? 0 : 1;
}

function readArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        repo: { type: "string" },
        branch: { type: "string" },
        apply: { type: "boolean", default: false },
        body: { type: "string" },
        only: { type: "string" },
        state: { type: "string" },
        check: { type: "boolean", default: false },
      },
    }).values;
  } catch (error) {
    throw new SkipError(`${(error as Error).message}. ${USAGE}`);
  }
}

function nameRepository(root: string, runProgram: Run): string {
  const named = runProgram("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], root);
  const repo = named.stdout.trim();

  if (named.status !== 0 || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new SkipError(`gh could not name the repository (${named.stderr.trim() || `exit ${named.status}`}). Pass --repo owner/name`);
  }

  return repo;
}

function defaultBranch(repo: string, root: string, runProgram: Run): string {
  const asked = runProgram("gh", ["api", `repos/${repo}`, "--jq", ".default_branch"], root);
  const branch = asked.stdout.trim();

  if (asked.status !== 0 || branch === "") {
    throw new SkipError(`gh could not name the default branch of ${repo} (${asked.stderr.trim() || `exit ${asked.status}`}). Pass --branch`);
  }

  return branch;
}

function fetchRemoteState(repo: string, root: string, runProgram: Run): RemoteState {
  const tags = fetchAllPages(`repos/${repo}/tags?per_page=100`, root, runProgram).map((tag) => (tag as { name: string }).name);
  const releases = fetchAllPages(`repos/${repo}/releases?per_page=100`, root, runProgram).map((found): Release => {
    const { id, tag_name, name, body } = found as { id: number; tag_name: string; name: string | null; body: string | null };

    return { id, tag: tag_name, name: name ?? "", body: body ?? "" };
  });
  let latestTag: string | null = null;

  if (releases.length > 0) {
    const latest = runProgram("gh", ["api", `repos/${repo}/releases/latest`, "--jq", ".tag_name"], root);

    if (latest.status !== 0) {
      throw new SkipError(`gh could not read the latest release (${latest.stderr.trim() || `exit ${latest.status}`})`);
    }

    latestTag = latest.stdout.trim();
  }

  return { tags, releases, latestTag };
}

function fetchAllPages(path: string, root: string, runProgram: Run): unknown[] {
  const got = runProgram("gh", ["api", "--paginate", "--slurp", path], root);

  if (got.status !== 0) {
    throw new SkipError(`gh could not read ${path} (${got.stderr.trim() || `exit ${got.status}`})`);
  }

  return (JSON.parse(got.stdout) as unknown[][]).flat();
}

function printPlan(plan: Plan, report: (line: string) => void): void {
  for (const change of plan.changes) {
    report(`${change.action} ${change.tag}${change.latest ? " (latest)" : ""}`);
  }

  report(`sync-releases: ${plan.changes.length} to write, ${plan.unchanged.length} unchanged${plan.untagged.length > 0 ? `, waiting for a tag: ${plan.untagged.join(" ")}` : ""}`);
}

/** Writes each change, oldest first, and stops at the first one GitHub refuses. */
function applyPlan(plan: Plan, repo: string, root: string, runProgram: Run, report: (line: string) => void): number {
  for (const change of plan.changes) {
    const [method, path] = change.action === "create" ? ["POST", `repos/${repo}/releases`] : ["PATCH", `repos/${repo}/releases/${change.id}`];
    const fields = [`tag_name=${change.tag}`, `name=${change.name}`, `body=${change.body}`, `make_latest=${change.latest ? "true" : "false"}`];
    const wrote = runProgram("gh", ["api", "-X", method as string, path, ...fields.flatMap((field) => ["-f", field]), "--silent"], root);

    if (wrote.status !== 0) {
      report(`FAIL sync-releases: GitHub did not ${change.action} the release of ${change.tag} (${wrote.stderr.trim() || `exit ${wrote.status}`})`);

      return 1;
    }

    report(`${change.action}d ${change.tag}`);
  }

  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = syncReleases({
    root: process.cwd(),
    argv: process.argv.slice(2),
    run,
    report: (line) => console.log(line),
  });
}
