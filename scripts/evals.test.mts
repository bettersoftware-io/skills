// The cases under evals/ are run by hand, against a model, and each run costs
// money (`pnpm evals:trigger`). These tests cost nothing and run with the
// rest. They hold what a case file can get wrong without any run noticing: a
// skill with no case, a case naming a skill that was renamed, a prompt that
// gives the answer away, a project the agent was meant to start in and did not.
//
// The case files are read with patterns, not a YAML parser: this repository
// installs none, and every case is written in the one shape these patterns read.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));
const EVALS = join(REPOSITORY, "evals");
const NOT_A_CASE = new Set(["fixtures", "results"]);
const NO_SKILL = "none";

// What a fixture.sh may run. The harness runs it as the person, with bash.
const FIXTURE_COMMANDS = [
  'node "$(dirname "$0")/../../scripts/create-project.mts" . --scope @acme > /dev/null',
  'cp -R "$(dirname "$0")/../fixtures/plain-project/." .',
];

interface Grader {
  skills: string[];
  forbids: boolean;
}

interface Case {
  folder: string;
  name: string;
  tags: string[];
  prompt: string;
  scaffold: string | undefined;
  graders: Grader[];
}

const SKILLS = foldersIn(join(REPOSITORY, "skills"));
const CASES = foldersIn(EVALS)
  .filter((folder) => !NOT_A_CASE.has(folder))
  .map(readCase);

describe("the eval cases", () => {
  it("are found", () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  it.each(CASES.map((each) => [each.folder, each] as const))("%s is named after its folder", (folder, each) => {
    expect(each.name).toBe(folder);
  });

  it.each(CASES.map((each) => [each.folder, each] as const))("%s is tagged with what it is for: a skill, or none", (_folder, each) => {
    expect(each.tags).toHaveLength(2);
    expect(each.tags[0]).toBe("trigger");
    expect([...SKILLS, NO_SKILL]).toContain(each.tags[1]);
  });

  it.each(CASES.map((each) => [each.folder, each] as const))("%s grades what its tag says", (_folder, each) => {
    const expected = each.tags[1] as string;
    const loaded = each.graders.filter((grader) => !grader.forbids).flatMap((grader) => grader.skills);
    const forbidden = each.graders.filter((grader) => grader.forbids).flatMap((grader) => grader.skills);

    if (expected === NO_SKILL) {
      expect(loaded).toEqual([]);
      expect(forbidden.sort()).toEqual(SKILLS);
    } else {
      expect(loaded).toEqual([expected]);
      expect(forbidden).not.toContain(expected);
    }
  });

  it.each(CASES.map((each) => [each.folder, each] as const))("%s names only skills that exist", (_folder, each) => {
    expect(each.graders.length).toBeGreaterThan(0);

    for (const grader of each.graders) {
      expect(grader.skills).toHaveLength(1);

      for (const skill of grader.skills) {
        expect(SKILLS).toContain(skill);
      }
    }
  });

  it.each(CASES.map((each) => [each.folder, each] as const))("%s does not name a skill in its prompt", (_folder, each) => {
    for (const skill of SKILLS) {
      expect(each.prompt).not.toContain(skill);
    }
  });

  it.each(CASES.map((each) => [each.folder, each] as const))("%s has the fixture script it names, and no other", (folder, each) => {
    const script = join(EVALS, folder, "fixture.sh");

    if (each.scaffold === undefined) {
      expect(existsSync(script)).toBe(false);

      return;
    }

    expect(each.scaffold).toBe("fixture.sh");
    expect(FIXTURE_COMMANDS).toContain(commandOf(readFileSync(script, "utf8")));
  });
});

describe("every skill", () => {
  it.each(SKILLS)("%s has two requests or more that should load it", (skill) => {
    expect(CASES.filter((each) => each.tags[1] === skill).length).toBeGreaterThanOrEqual(2);
  });

  it("is kept out by one request or more that should load none", () => {
    expect(CASES.filter((each) => each.tags[1] === NO_SKILL).length).toBeGreaterThan(0);
  });
});

describe("running them", () => {
  const script = (JSON.parse(readFileSync(join(REPOSITORY, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts["evals:trigger"] ?? "";

  it("builds the project each case starts in: without --scaffold the agent starts in an empty folder and the run still passes", () => {
    expect(script).toContain(" --scaffold");
  });

  it("runs one arm: a second, with no plugin, can load no skill and would double the cost", () => {
    expect(script).toContain(" --ablation none");
  });

  it("keeps the report on this machine, and out of git", () => {
    expect(script).toContain(" --no-publish");
    expect(readFileSync(join(REPOSITORY, ".gitignore"), "utf8").split("\n")).toContain("evals/results/");
  });
});

function foldersIn(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readCase(folder: string): Case {
  const text = readFileSync(join(EVALS, folder, "case.yaml"), "utf8");
  const [head = "", ...graders] = text.split(/\n {2}- type: /);

  return {
    folder,
    name: /^name: (.+)$/m.exec(head)?.[1] ?? "",
    tags: (/^tags: \[(.+)\]$/m.exec(head)?.[1] ?? "").split(", "),
    prompt: JSON.parse(/^ {2}prompt: (".*")$/m.exec(head)?.[1] ?? '""') as string,
    scaffold: /^ {2}scaffold_script: (.+)$/m.exec(head)?.[1],
    graders: graders.map(readGrader),
  };
}

// A grader's pattern ends with the skill it counts: …)?extending-a-project"
// One skill to a grader, so that a failed run says which skill it was.
function readGrader(block: string): Grader {
  const pattern = /^ {4}input_match: '(.*)'$/m.exec(block)?.[1] ?? "";
  const named = pattern.slice(pattern.lastIndexOf(")?") + 2, -1);

  return {
    skills: named === "" ? [] : [named],
    forbids: /^ {4}max: 0$/m.test(block),
  };
}

function commandOf(script: string): string {
  const commands = script.split("\n").filter((line) => line !== "" && !line.startsWith("#"));

  expect(commands).toHaveLength(1);

  return commands[0] as string;
}
