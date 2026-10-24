import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { lastFinishedWeek } from "../files/tools/agent-workflow/lib/week.mts";
import { commit, createFolder, createRemote, git, TOOLS } from "./support.mts";

const HOOK = join(TOOLS, "hooks/changelog-due.mts");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Runs the hook as a host does: a payload on its standard input, started in `cwd`. */
function runHook(cwd: string, payload: unknown = { hook_event_name: "SessionStart", source: "startup", cwd }): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [HOOK], { cwd, input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8" });

  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** A project whose origin has one pull request merged in the last finished week, and no entry for it. */
function createDueProject(): string {
  const { clone } = createRemote();
  const merged = new Date(Date.now() - 7 * DAY_MS).toISOString();

  commit(clone, "Add a (#12)", { "CHANGELOG.md": "# Changelog\n" }, merged);
  git(clone, "push", "--quiet", "origin", "main");

  return clone;
}

describe("the session-start reminder", () => {
  it("gives the due weeks as session context, with the command for each host", () => {
    const { status, stdout, stderr } = runHook(createDueProject());
    const output = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    const { name } = lastFinishedWeek(new Date());

    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(Object.keys(output)).toEqual(["hookSpecificOutput"]);
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext.split("\n")).toEqual([
      "Changelog: as of the last fetch of the default branch, these weeks are due in CHANGELOG.md:",
      `${name}  1 merged, no entry: write it with /workflow:changelog ${name}`,
      "Mention this to the person at a natural point; do not drop the task you were given to write it. In Codex the command is $workflow-changelog <week>.",
    ]);
  });

  it("reads the folder the host names, and the folder it was started in when none is named", () => {
    const due = createDueProject();
    const elsewhere = createFolder();

    expect(runHook(elsewhere, { cwd: due }).stdout).toContain("SessionStart");
    expect(runHook(due, {}).stdout).toContain("SessionStart");
    expect(runHook(due, "not json").stdout).toContain("SessionStart");
    expect(runHook(due, { cwd: 7 }).stdout).toContain("SessionStart");
    expect(runHook(elsewhere, {})).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("says nothing when nothing is due", () => {
    const { clone } = createRemote();
    const { name } = lastFinishedWeek(new Date());

    commit(clone, "Add a (#12)", { "CHANGELOG.md": `# Changelog\n\n## ${name} — a week\n\n- change [#12]\n` }, new Date(Date.now() - 7 * DAY_MS).toISOString());
    git(clone, "push", "--quiet", "origin", "main");

    expect(runHook(clone)).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("says nothing and exits 0 with no git, no origin, or no CHANGELOG.md, within a second", () => {
    const noGit = createFolder({ "CHANGELOG.md": "# Changelog\n" });
    const noOrigin = createFolder({ "CHANGELOG.md": "# Changelog\n" });
    const noChangelog = createRemote().clone;

    git(noOrigin, "init", "--quiet", "--initial-branch=main");

    for (const folder of [noGit, noOrigin, noChangelog]) {
      const started = Date.now();

      expect(runHook(folder)).toEqual({ status: 0, stdout: "", stderr: "" });
      expect(Date.now() - started).toBeLessThan(1000);
    }
  });
});
