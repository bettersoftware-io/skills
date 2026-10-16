// Runs before `claude plugin eval`, in `pnpm evals:trigger` and
// `pnpm evals:outcome`: refuses a checkout with the starter installed in it.
//
// The checkout is the plugin, and a run is given a rule for every file it
// holds. With the starter's own `node_modules`, `.turbo` and `dist` under
// `starter/`, about 13,000 git-ignored files, Claude Code 2.1.301 could not
// start a single run: `E2BIG: argument list too long, posix_spawn`, a score
// of 0 for every case, and nothing in the report to say why. So the run is
// stopped here, with the command that clears them.
//
//   node scripts/evals-preflight.mts [checkout]   exit 0: nothing installed; 1: refused

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "../kit/gates/lib/files.mts";

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));
const STARTER = "starter";
const SHOWN = 3;

/** Runs git in a folder and returns what it printed; replaced in tests. */
export type Git = (args: string[], cwd: string) => { status: number; stdout: string };

const git: Git = (args, cwd) => {
  const ran = spawnSync("git", args, { cwd, encoding: "utf8" });

  return { status: ran.status ?? 1, stdout: ran.stdout ?? "" };
};

/** What git ignores under `starter/`, a folder once: what an install, a build or a test there left. */
export function findInstalled(root: string, run: Git = git): string[] {
  const listed = run(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--", STARTER], root);

  if (listed.status !== 0) {
    throw new Error(`git could not list the ignored files under ${STARTER}/`);
  }

  return listed.stdout.split("\n").filter(Boolean);
}

/** The refusal, or undefined when a run may start. */
export function refusal(installed: string[]): string | undefined {
  if (installed.length === 0) {
    return undefined;
  }

  const named = installed.slice(0, SHOWN).join(", ");
  const more = installed.length > SHOWN ? `, and ${installed.length - SHOWN} more` : "";

  return [
    `evals: not started. ${STARTER}/ holds what an install left there (${named}${more}).`,
    "With it in the checkout every run fails before the agent starts (E2BIG at posix_spawn), and scores 0.",
    `Remove it, then run this again:  git clean -fdX ${STARTER}`,
  ].join("\n");
}

if (isMainModule(import.meta.url)) {
  const refused = refusal(findInstalled(process.argv[2] ?? REPOSITORY));

  if (refused !== undefined) {
    console.error(refused);
    process.exit(1);
  }
}
