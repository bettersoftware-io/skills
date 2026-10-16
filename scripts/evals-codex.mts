// Puts the trigger cases under evals/ to Codex: `claude plugin eval` runs
// Claude Code only. Each case starts in the project its fixture.sh makes, as
// it does under `claude plugin eval`, and passes when Codex loads the skill
// the case expects and none it expects left alone.
//
// This is not the eval harness. Codex runs with your own Codex configuration,
// your other plugins and their skills included, in a read-only sandbox. The
// plugin must be installed and enabled in Codex, and it is the installed copy
// that is tested, not this checkout.
//
//   pnpm evals:codex [--runs 3] [--case trigger-extend-] [-j 4] [--traces <folder>]
//
// --traces writes each run's events to <folder>/<case>-<run>.jsonl, to read why a run failed.

import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";

import { skillsLoadedIn, verdictOf } from "./lib/codex-trace.mts";
import { EVALS, type EvalCase, expectedSkillsOf, readCases, readSkills } from "./lib/eval-cases.mts";

const run = promisify(execFile);
const RUN_LIMIT_MS = 300_000;

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "1" },
    case: { type: "string", default: "" },
    concurrency: { type: "string", short: "j", default: "4" },
    traces: { type: "string" },
  },
});

const skills = readSkills();
const cases = readCases().filter((each) => each.kind === "trigger" && each.name.startsWith(values.case));
const jobs = cases.flatMap((each) => Array.from({ length: Number(values.runs) }, (_unused, index) => ({ each, index })));

if (jobs.length === 0) {
  console.error(`No trigger case starts with "${values.case}".`);
  process.exit(1);
}

const traces = values.traces === undefined ? undefined : resolve(values.traces);

if (traces !== undefined) {
  mkdirSync(traces, { recursive: true });
}

const results = await runAll(jobs, Number(values.concurrency), async ({ each, index }) => {
  const trace = await traceOf(each);

  if (traces !== undefined) {
    writeFileSync(join(traces, `${each.name}-${index + 1}.jsonl`), trace);
  }

  const loaded = skillsLoadedIn(trace, skills);

  return { each, loaded, ...verdictOf(loaded, expectedSkillsOf(each)) };
});

for (const each of cases) {
  const runs = results.filter((result) => result.each === each);
  const passed = runs.filter((result) => result.passed).length;
  const notes = runs
    .filter((result) => !result.passed)
    .map((result) => [...result.missing.map((skill) => `did not load ${skill}`), ...result.unwanted.map((skill) => `loaded ${skill}`)].join(", "));

  console.log(`${passed === runs.length ? "✓" : "✗"} ${each.name}  ${passed}/${runs.length}${notes.length > 0 ? `  ${notes.join("; ")}` : ""}`);
}

const failed = results.filter((result) => !result.passed).length;

console.log(`\n${cases.length} case(s), ${results.length - failed}/${results.length} runs passed`);
process.exit(failed === 0 ? 0 : 1);

async function traceOf(each: EvalCase): Promise<string> {
  const scratch = mkdtempSync(join(tmpdir(), "codex-eval-"));
  // A created project takes its package name from its folder, so the folder gets a plain one.
  const project = join(scratch, "project");

  mkdirSync(project);

  try {
    if (each.scaffold !== undefined) {
      await run("bash", [join(EVALS, each.folder, each.scaffold)], { cwd: project });
    }

    const codex = run(
      "codex",
      ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--cd", project, each.prompt],
      { maxBuffer: 64 * 1024 * 1024, timeout: RUN_LIMIT_MS },
    );

    // codex exec reads more of the prompt from its input until that closes.
    codex.child.stdin?.end();

    const { stdout } = await codex.catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));

    return stdout;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function runAll<Job, Result>(all: Job[], concurrency: number, work: (job: Job) => Promise<Result>): Promise<Result[]> {
  const results: Result[] = new Array(all.length);
  let next = 0;

  async function takeJobs(): Promise<void> {
    while (next < all.length) {
      const index = next;

      next += 1;
      results[index] = await work(all[index] as Job);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, all.length) }, takeJobs));

  return results;
}
