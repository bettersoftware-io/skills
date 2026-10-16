// Reads the eval cases under evals/: for the test that holds their form, and
// for the runner that puts the trigger cases to Codex.
//
// The case files are read with patterns, not a YAML parser: this repository
// installs none, and every case is written in the one shape these patterns
// read. scripts/evals.test.mts fails on a case written in another.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const EVALS = join(REPOSITORY, "evals");
export const NO_SKILL = "none";

const NOT_A_CASE = new Set(["fixtures", "results"]);

export interface Grader {
  type: string;
  skills: string[];
  forbids: boolean;
}

export interface EvalCase {
  folder: string;
  name: string;
  kind: string;
  skill: string;
  tags: string[];
  prompt: string;
  scaffold: string | undefined;
  graders: Grader[];
}

export function readSkills(): string[] {
  return foldersIn(join(REPOSITORY, "skills"));
}

export function readCases(): EvalCase[] {
  return foldersIn(EVALS)
    .filter((folder) => !NOT_A_CASE.has(folder))
    .map(readCase);
}

/** The skills a case expects to be loaded, and those it expects to be left alone. */
export function expectedSkillsOf(each: EvalCase): { loads: string[]; leaves: string[] } {
  const counted = each.graders.filter((grader) => grader.type === "tool_used");

  return {
    loads: counted.filter((grader) => !grader.forbids).flatMap((grader) => grader.skills),
    leaves: counted.filter((grader) => grader.forbids).flatMap((grader) => grader.skills),
  };
}

export function foldersIn(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readCase(folder: string): EvalCase {
  const text = readFileSync(join(EVALS, folder, "case.yaml"), "utf8");
  const [head = "", ...graders] = text.split(/\n {2}- type: /);
  const tags = (/^tags: \[(.+)\]$/m.exec(head)?.[1] ?? "").split(", ");

  return {
    folder,
    name: /^name: (.+)$/m.exec(head)?.[1] ?? "",
    kind: tags[0] ?? "",
    skill: tags[1] ?? "",
    tags,
    prompt: JSON.parse(/^ {2}prompt: (".*")$/m.exec(head)?.[1] ?? '""') as string,
    scaffold: /^ {2}scaffold_script: (.+)$/m.exec(head)?.[1],
    graders: graders.map(readGrader),
  };
}

// A grader on the Skill tool ends its pattern with the one skill it counts:
// …)?extending-a-project"  One skill to a grader, so a failed run says which.
function readGrader(block: string): Grader {
  const type = /^(\S+)/.exec(block)?.[1] ?? "";

  if (type !== "tool_used") {
    return { type, skills: [], forbids: false };
  }

  const pattern = /^ {4}tool: Skill\n {4}input_match: '(.*)'$/m.exec(block)?.[1] ?? "";
  const named = pattern.slice(pattern.lastIndexOf(")?") + 2, -1);

  return {
    type,
    skills: named === "" ? [] : [named],
    forbids: /^ {4}max: 0$/m.test(block),
  };
}
