// The cases under evals/ are run by hand, against a model, and each run costs
// money (`pnpm evals:trigger`, `pnpm evals:outcome`). These tests cost nothing
// and run with the rest. They hold what a case file can get wrong without any
// run noticing: a skill with no case, a case naming a skill that was renamed, a
// prompt that gives the answer away, a project the agent was meant to start in
// and did not, a planted change that no longer applies.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EVALS, expectedSkillsOf, NO_SKILL, readCases, readSkills, REPOSITORY } from "./lib/eval-cases.mts";

const KINDS = ["trigger", "outcome"];

// The skills with no outcome case, and why. A skill leaves this list when it gets one.
const NO_OUTCOME_CASE: Record<string, string> = {
  "documenting-architecture": "it starts readers of its own and fetches a 230 MB toolset; a run cannot hold that",
};

// What a fixture.sh may run, line by line. The harness runs it as the person, with bash.
const PROJECT_COMMANDS = [
  'node "$(dirname "$0")/../../scripts/create-project.mts" . --scope @acme > /dev/null',
  'cp -R "$(dirname "$0")/../fixtures/plain-project/." .',
];
const CHANGE_COMMAND = 'node "$(dirname "$0")/change.mts"';

const SKILLS = readSkills();
const CASES = readCases();
const EACH = CASES.map((each) => [each.folder, each] as const);
const TRIGGERS = CASES.filter((each) => each.kind === "trigger");
const OUTCOMES = CASES.filter((each) => each.kind === "outcome");

describe("the eval cases", () => {
  it("are found, of both kinds", () => {
    expect(TRIGGERS.length).toBeGreaterThan(0);
    expect(OUTCOMES.length).toBeGreaterThan(0);
  });

  it.each(EACH)("%s is named after its folder", (folder, each) => {
    expect(each.name).toBe(folder);
  });

  it.each(EACH)("%s is tagged with its kind and what it is for", (_folder, each) => {
    expect(each.tags).toHaveLength(2);
    expect(KINDS).toContain(each.kind);
    expect(each.kind === "outcome" ? SKILLS : [...SKILLS, NO_SKILL]).toContain(each.skill);
  });

  it.each(EACH)("%s counts the skill its tag names", (_folder, each) => {
    const { loads: loaded, leaves: forbidden } = expectedSkillsOf(each);

    if (each.skill === NO_SKILL) {
      expect(loaded).toEqual([]);
      expect(forbidden.sort()).toEqual(SKILLS);
    } else {
      expect(loaded).toEqual([each.skill]);
      expect(forbidden).not.toContain(each.skill);
    }
  });

  it.each(EACH)("%s names only skills that exist, one to a grader", (_folder, each) => {
    for (const grader of each.graders.filter((candidate) => candidate.type === "tool_used")) {
      expect(grader.skills).toHaveLength(1);
      expect(SKILLS).toContain(grader.skills[0]);
    }
  });

  it.each(EACH)("%s grades with what this suite knows how to read", (_folder, each) => {
    for (const grader of each.graders) {
      expect(["tool_used", "regex", "llm"]).toContain(grader.type);
    }
  });

  it.each(EACH)("%s does not name a skill in its prompt", (_folder, each) => {
    for (const skill of SKILLS) {
      expect(each.prompt).not.toContain(skill);
    }
  });

  it.each(EACH)("%s has the fixture script it names, and it runs only known commands", (folder, each) => {
    const script = join(EVALS, folder, "fixture.sh");
    const change = join(EVALS, folder, "change.mts");

    if (each.scaffold === undefined) {
      expect(existsSync(script)).toBe(false);
      expect(existsSync(change)).toBe(false);

      return;
    }

    expect(each.scaffold).toBe("fixture.sh");

    const [project, ...rest] = commandsOf(readFileSync(script, "utf8"));

    expect(PROJECT_COMMANDS).toContain(project);
    expect(rest).toEqual(existsSync(change) ? [CHANGE_COMMAND] : []);
  });
});

describe("an outcome case", () => {
  it.each(OUTCOMES.map((each) => [each.folder, each] as const))("%s grades the result, not only the skill it loaded", (_folder, each) => {
    expect(each.graders.filter((grader) => grader.type !== "tool_used").length).toBeGreaterThan(0);
  });

  const changed = OUTCOMES.filter((each) => existsSync(join(EVALS, each.folder, "change.mts")));

  it.each(changed.map((each) => [each.folder] as const))("%s has a change that applies to a project created now", (folder) => {
    const project = mkdtempSync(join(tmpdir(), "eval-change-"));

    try {
      execFileSync(process.execPath, [join(REPOSITORY, "scripts", "create-project.mts"), project, "--scope", "@acme", "--name", "eval-change"], { stdio: "ignore" });
      const before = contentsOf(project);

      execFileSync(process.execPath, [join(EVALS, folder, "change.mts")], { cwd: project, stdio: "pipe" });

      expect(contentsOf(project)).not.toEqual(before);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("every skill", () => {
  it.each(SKILLS)("%s has two requests or more that should load it", (skill) => {
    expect(TRIGGERS.filter((each) => each.skill === skill).length).toBeGreaterThanOrEqual(2);
  });

  it.each(SKILLS)("%s has an outcome case, or a reason it has none", (skill) => {
    const cases = OUTCOMES.filter((each) => each.skill === skill).length;

    expect(cases > 0 || skill in NO_OUTCOME_CASE).toBe(true);
    expect(cases > 0 && skill in NO_OUTCOME_CASE).toBe(false);
  });

  it("is kept out by one request or more that should load none", () => {
    expect(TRIGGERS.filter((each) => each.skill === NO_SKILL).length).toBeGreaterThan(0);
  });
});

describe("running them", () => {
  const scripts = (JSON.parse(readFileSync(join(REPOSITORY, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  const trigger = scripts["evals:trigger"] ?? "";
  const outcome = scripts["evals:outcome"] ?? "";

  it("runs each kind by its tag", () => {
    expect(trigger).toContain(" --tag trigger");
    expect(outcome).toContain(" --tag outcome");
  });

  it("builds the project each case starts in: without --scaffold the agent starts in an empty folder and the run still passes", () => {
    expect(trigger).toContain(" --scaffold");
    expect(outcome).toContain(" --scaffold");
  });

  it("runs a trigger case in one arm: a second, with no plugin, can load no skill and would double the cost", () => {
    expect(trigger).toContain(" --ablation none");
  });

  it("runs an outcome case in two arms, so the score says what the plugin added", () => {
    expect(outcome).toContain(" --ablation with-without");
  });

  it("keeps the report on this machine, and out of git", () => {
    expect(trigger).toContain(" --no-publish");
    expect(outcome).toContain(" --no-publish");
    expect(readFileSync(join(REPOSITORY, ".gitignore"), "utf8").split("\n")).toContain("evals/results/");
  });
});


function commandsOf(script: string): string[] {
  return script.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
}

function contentsOf(folder: string): string {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
    .map((file) => `${file}\n${readFileSync(file, "utf8")}`)
    .join("\n");
}
