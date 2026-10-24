import { spawnSync } from "node:child_process";
import { cpSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { lastFinishedWeek } from "../files/tools/agent-workflow/lib/week.mts";
import { commit, createFolder, createRemote, git, TOOLS } from "./support.mts";

const HOOK = join(TOOLS, "hooks/changelog-due.mts");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Runs the hook (or a copy of it at `hook`) as a host does: a payload on its standard input, started in `cwd`. */
function runHook(cwd: string, payload: unknown = { hook_event_name: "SessionStart", source: "startup", cwd }, hook = HOOK): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [hook], { cwd, input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8" });

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

  it.each([
    ["is missing", (file: string) => rmSync(file)],
    ["does not parse", (file: string) => writeFileSync(file, "export const = ;\n")],
    ["throws as it loads", (file: string) => writeFileSync(file, 'throw new Error("half updated");\n')],
  ])("says nothing and exits 0 when a lib file it needs %s", (_name, damage) => {
    const due = createDueProject();
    const tools = join(createFolder(), "tools/agent-workflow");

    cpSync(TOOLS, tools, { recursive: true });
    expect(runHook(due, { cwd: due }, join(tools, "hooks/changelog-due.mts")).stdout).toContain("SessionStart");

    for (const lib of ["due.mts", "week.mts", "system.mts", "due-reminder.mts"]) {
      const copy = join(createFolder(), "tools/agent-workflow");

      cpSync(TOOLS, copy, { recursive: true });
      damage(join(copy, "lib", lib));

      expect(runHook(due, { cwd: due }, join(copy, "hooks/changelog-due.mts")), lib).toEqual({ status: 0, stdout: "", stderr: "" });
    }
  });

  it("says nothing and exits 0 when the host has closed the pipe", () => {
    const ran = spawnSync("sh", ["-c", `echo '{}' | node ${JSON.stringify(HOOK)} | true; echo done`], { cwd: createDueProject(), encoding: "utf8" });

    expect(ran.stderr).toBe("");
    expect(ran.stdout).toBe("done\n");
  });
});
