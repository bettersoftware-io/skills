import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { changelog } from "../files/tools/agent-workflow/changelog.mts";
import { withDefinitions } from "../files/tools/agent-workflow/lib/changelog.mts";
import { describeDue, dueWeeks, findDue } from "../files/tools/agent-workflow/lib/due.mts";
import type { Merge } from "../files/tools/agent-workflow/lib/history.mts";
import { type Run, run } from "../files/tools/agent-workflow/lib/system.mts";
import { parseWeek } from "../files/tools/agent-workflow/lib/week.mts";
import { commit, createFolder, createRemote, git, REAL_PROCESS_TIMEOUT } from "./support.mts";

/** A changelog with one section per `weeks` entry (name → numbers it cites). */
function createText(weeks: Record<string, number[]> = {}): string {
  const sections = Object.entries(weeks).map(([name, cited]) => `## ${name} — a week\n\n${cited.map((number) => `- change [#${number}]`).join("\n")}\n`);

  return ["# Changelog\n", ...sections].join("\n");
}

function createMerge(number: number, mergedAt: string): Merge {
  return { number, mergedAt };
}

const NOW_IN_W41 = new Date("2026-10-08T09:00:00Z");

describe("the weeks due", () => {
  it("is due when a finished week has merges and no section", () => {
    const due = dueWeeks([createText()], [createMerge(1, "2026-10-01T10:00:00Z")], NOW_IN_W41);

    expect(due).toEqual([{ week: parseWeek("2026-W40"), merged: [1], missing: [1], extend: false }]);
  });

  it("is due to extend when a section written early misses merges after it", () => {
    const merges = [createMerge(1, "2026-09-29T10:00:00Z"), createMerge(2, "2026-09-30T10:00:00Z"), createMerge(3, "2026-10-02T10:00:00Z")];
    const due = dueWeeks([createText({ "2026-W40": [1, 2] })], merges, NOW_IN_W41);

    expect(due).toEqual([{ week: parseWeek("2026-W40"), merged: [1, 2, 3], missing: [3], extend: true }]);
  });

  it("never judges the current week", () => {
    expect(dueWeeks([createText({ "2026-W40": [] })], [createMerge(5, "2026-10-06T10:00:00Z")], NOW_IN_W41)).toEqual([]);
  });

  it("never judges a week with no merges, with or without a section", () => {
    expect(dueWeeks([createText()], [], NOW_IN_W41)).toEqual([]);
    expect(dueWeeks([createText({ "2026-W40": [] })], [], NOW_IN_W41)).toEqual([]);
  });

  it("counts a week written when either the working or the remote text cites it all", () => {
    const merges = [createMerge(1, "2026-10-01T10:00:00Z"), createMerge(2, "2026-10-02T10:00:00Z")];
    const whole = createText({ "2026-W40": [1, 2] });
    const partial = createText({ "2026-W40": [1] });

    expect(dueWeeks([whole, partial], merges, NOW_IN_W41)).toEqual([]);
    expect(dueWeeks([partial, whole], merges, NOW_IN_W41)).toEqual([]);
    expect(dueWeeks([partial, createText()], merges, NOW_IN_W41).map(({ missing }) => missing)).toEqual([[2]]);
  });

  it("judges only the last finished week in a file with no week yet", () => {
    const merges = [createMerge(1, "2026-09-17T10:00:00Z"), createMerge(2, "2026-09-24T10:00:00Z"), createMerge(3, "2026-10-01T10:00:00Z")];

    expect(dueWeeks([createText()], merges, NOW_IN_W41).map(({ week }) => week.name)).toEqual(["2026-W40"]);
  });

  it("judges the newest heading's week, when it is finished, and every finished week after it, oldest first", () => {
    const merges = [createMerge(1, "2026-09-24T10:00:00Z"), createMerge(2, "2026-09-30T10:00:00Z"), createMerge(3, "2026-10-07T10:00:00Z"), createMerge(4, "2026-10-14T10:00:00Z")];
    const due = dueWeeks([createText({ "2026-W39": [], "2026-W40": [] }), createText()], merges, new Date("2026-10-20T09:00:00Z"));

    expect(due.map(({ week, missing }) => [week.name, missing])).toEqual([
      ["2026-W40", [2]],
      ["2026-W41", [3]],
      ["2026-W42", [4]],
    ]);
  });

  it("takes the newest heading over all texts", () => {
    const merges = [createMerge(1, "2026-09-24T10:00:00Z"), createMerge(2, "2026-10-01T10:00:00Z")];

    expect(dueWeeks([createText({ "2026-W39": [] }), createText({ "2026-W40": [2] })], merges, NOW_IN_W41)).toEqual([]);
  });

  it("lists W53 and the next year's W01 across the turn of 2026", () => {
    const merges = [createMerge(1, "2026-12-30T10:00:00Z"), createMerge(2, "2027-01-05T10:00:00Z")];
    const due = dueWeeks([createText({ "2026-W52": [] })], merges, new Date("2027-01-12T09:00:00Z"));

    expect(due.map(({ week, missing }) => [week.name, missing])).toEqual([
      ["2026-W53", [1]],
      ["2027-W01", [2]],
    ]);
  });

  it("leaves a merge at Monday 00:00:00Z to the next week", () => {
    const merges = [createMerge(1, "2026-10-04T23:59:59Z"), createMerge(2, "2026-10-05T00:00:00Z")];
    const due = dueWeeks([createText({ "2026-W40": [1] })], merges, new Date("2026-10-14T09:00:00Z"));

    expect(due).toEqual([{ week: parseWeek("2026-W41"), merged: [2], missing: [2], extend: false }]);
  });
});

describe("describing a week due", () => {
  it("names the merges not cited, and says to extend", () => {
    const week = parseWeek("2026-W41");

    expect(describeDue({ week, merged: Array.from({ length: 12 }, (_, index) => index + 10), missing: [20, 21, 22], extend: true })).toBe(
      "2026-W41  12 merged, 3 not cited (#20, #21, #22): extend it with /workflow:changelog 2026-W41",
    );
  });

  it("says there is no entry, and to write it, for a week with no heading", () => {
    const week = parseWeek("2026-W41");

    expect(describeDue({ week, merged: Array.from({ length: 12 }, (_, index) => index + 10), missing: Array.from({ length: 12 }, (_, index) => index + 10), extend: false })).toBe(
      "2026-W41  12 merged, no entry: write it with /workflow:changelog 2026-W41",
    );
  });
});

describe("the command", { timeout: REAL_PROCESS_TIMEOUT }, () => {
  it("reads the remote text and history through git, and skips with no CHANGELOG.md or no remote branch", () => {
    const { clone } = createRemote();

    // No CHANGELOG.md anywhere.
    expect(runDue(clone)).toMatchObject({ status: 2 });
    expect(runDue(clone).lines.at(-1)).toMatch(/^SKIP changelog: there is no CHANGELOG\.md.*Nothing was judged$/);

    // A week merged on origin that its CHANGELOG.md cites in full.
    commit(clone, "Add a (#12)", { "CHANGELOG.md": createText({ "2026-W40": [12] }) }, "2026-09-30T12:00:00Z");
    git(clone, "push", "--quiet", "origin", "main");
    expect(runDue(clone)).toEqual({ status: 0, lines: [] });

    // A merge that is not pushed is not read.
    commit(clone, "Add b (#13)", { b: "1" }, "2026-10-01T12:00:00Z");
    expect(runDue(clone)).toEqual({ status: 0, lines: [] });

    // Pushed, it is due, and the section on origin makes it an extension.
    git(clone, "push", "--quiet", "origin", "main");
    expect(runDue(clone)).toEqual({ status: 1, lines: ["2026-W40  2 merged, 1 not cited (#13): extend it with /workflow:changelog 2026-W40"] });

    // The remote text counts when the working one has lost the section.
    writeFileSync(join(clone, "CHANGELOG.md"), createText());
    expect(runDue(clone).lines).toEqual(["2026-W40  2 merged, 1 not cited (#13): extend it with /workflow:changelog 2026-W40"]);

    // --ref names the history and the text to read.
    git(clone, "branch", "older", "HEAD~1");
    expect(runDue(clone, ["--ref", "older"])).toEqual({ status: 0, lines: [] });

    const bad = runDue(clone, ["--ref", "nowhere"]);

    expect(bad.status).toBe(2);
    expect(bad.lines.at(-1)).toMatch(/^SKIP changelog: git could not read the history of nowhere[\s\S]*Nothing was judged$/);
    expect(runDue(clone, ["--ref"]).status).toBe(2);

    // No remote branch.
    const alone = createFolder({ "CHANGELOG.md": createText() });

    git(alone, "init", "--quiet", "--initial-branch=main");

    const none = runDue(alone);

    expect(none.status).toBe(2);
    expect(none.lines.at(-1)).toMatch(/^SKIP changelog: .*remote branch.*Nothing was judged$/);
  });

  it("refuses a ref that starts with a dash, so git writes no file", () => {
    const { clone } = createRemote();
    const target = join(createFolder(), "written");

    commit(clone, "Add a (#12)", { "CHANGELOG.md": createText() }, "2026-09-30T12:00:00Z");
    git(clone, "push", "--quiet", "origin", "main");

    const refused = runDue(clone, ["--ref", `--output=${target}`]);

    expect(refused.status).toBe(2);
    expect(refused.lines).toEqual([`SKIP changelog: --ref needs a git ref, and "--output=${target}" starts with a dash. Nothing was judged`]);
    expect(existsSync(target)).toBe(false);
  });

  it("reads the whole first-parent history, never git's --since, which stops at the first commit dated too early", () => {
    const { clone } = createRemote();
    const logged: string[][] = [];
    const recording: Run = (program, args, cwd) => {
      if (args[0] === "log") {
        logged.push(args);
      }

      return run(program, args, cwd);
    };

    commit(clone, "Add a (#12)", { "CHANGELOG.md": createText() }, "2026-09-30T12:00:00Z");
    git(clone, "push", "--quiet", "origin", "main");
    findDue(clone, recording, new Date("2026-10-08T09:00:00Z"));

    writeFileSync(join(clone, "CHANGELOG.md"), createText({ "2026-W39": [] }));
    findDue(clone, recording, new Date("2026-10-08T09:00:00Z"));

    expect(logged).toHaveLength(2);
    expect(logged.flat().filter((arg) => arg.startsWith("--since") || arg.startsWith("--after"))).toEqual([]);
  });

  it("reads a commit pushed straight to main with (#N) in its subject as a merge, which gh does not list: due and check disagree", () => {
    const { clone } = createRemote();
    const check = (): { status: number; lines: string[] } => {
      const lines: string[] = [];
      // `--merged ""` is gh's answer: no pull request was merged in the week.
      const status = changelog({ root: clone, argv: ["check", "2026-W40", "--merged", ""], now: new Date("2026-10-08T09:00:00Z"), run, report: (line) => lines.push(line) });

      return { status, lines };
    };

    commit(clone, "Fix a typo (#40)", { "CHANGELOG.md": createText() }, "2026-09-30T12:00:00Z");
    git(clone, "push", "--quiet", "origin", "main");
    git(clone, "remote", "set-url", "origin", "https://github.com/acme/app.git");

    // Not cited: due names the week, and check passes it.
    expect(runDue(clone)).toEqual({ status: 1, lines: ["2026-W40  1 merged, no entry: write it with /workflow:changelog 2026-W40"] });
    expect(check().status).toBe(0);

    // Cited: due is satisfied, and check fails the citation.
    writeFileSync(join(clone, "CHANGELOG.md"), withDefinitions(createText({ "2026-W40": [40] }), "https://github.com/acme/app"));
    expect(runDue(clone)).toEqual({ status: 0, lines: [] });
    expect(check()).toEqual({
      status: 1,
      lines: ["  cited in 2026-W40 and not merged in it: #40. A reference to earlier work is a plain link, not a citation", "FAIL changelog 2026-W40: 1 problem(s). Fix CHANGELOG.md and run this again"],
    });
  });

  it("weeks adds the newest week to extend", () => {
    const { clone } = createRemote();

    commit(clone, "Add a (#12)", { "CHANGELOG.md": createText({ "2026-W40": [12] }) }, "2026-09-30T12:00:00Z");
    commit(clone, "Add b (#13)", { b: "1" }, "2026-10-01T12:00:00Z");
    git(clone, "push", "--quiet", "origin", "main");

    const lines: string[] = [];
    const status = changelog({ root: clone, argv: ["weeks"], now: new Date("2026-10-08T09:00:00Z"), run, report: (line) => lines.push(line) });

    expect(status).toBe(0);
    expect(lines).toEqual(["2026-W41  2026-10-05..2026-10-11", "2026-W40  2026-09-28..2026-10-04  extend: 1 not cited"]);
  });

  it("weeks prints nothing extra when due cannot judge", () => {
    const root = createFolder({ "CHANGELOG.md": createText({ "2026-W40": [12] }) });
    const lines: string[] = [];

    git(root, "init", "--quiet", "--initial-branch=main");

    const status = changelog({ root, argv: ["weeks"], now: new Date("2026-10-08T09:00:00Z"), run, report: (line) => lines.push(line) });

    expect(status).toBe(0);
    expect(lines).toEqual(["2026-W41  2026-10-05..2026-10-11"]);
  });
});

function runDue(root: string, extra: string[] = []): { status: number; lines: string[] } {
  const lines: string[] = [];
  const status = changelog({ root, argv: ["due", ...extra], now: new Date("2026-10-08T09:00:00Z"), run, report: (line) => lines.push(line) });

  return { status, lines };
}
