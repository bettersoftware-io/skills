// Which status checks a ruleset can ask for, read from the project's own
// workflow files.
//
// A required check that never reports holds a pull request for good, so a
// job is named only when every pull request runs it:
//
//   - its workflow has `pull_request` under `on:` with nothing under it. Any
//     filter there (`paths`, `paths-ignore`, `branches`, `branches-ignore`,
//     `types`) means some pull requests do not start the workflow;
//   - the job has no `if:` of its own. A step's `if:` does not count;
//   - its checks have names that the file gives: no `uses:` on the job (the
//     checks are named after the jobs of the workflow it calls), no
//     expression in its `name:` other than a value of its matrix.
//
// The check's name is the job's `name:`, or its id when it has none. A job
// with a `strategy:` has one check per combination of its matrix, read when
// every value is written out in the file: its name with `${{ matrix.<key> }}`
// replaced, or, when its name names no value, the name and the values in
// brackets, as GitHub writes them (`test (24, ubuntu-latest)`). A matrix with
// an `include:` or an `exclude:`, or one computed in an expression, is left
// out.
//
// This is not a YAML parser, and the project is given no package for one. It
// reads the block form every workflow here is written in: `on:` and `jobs:`
// at the left edge, a job as a key under `jobs:`, the job's own keys under
// that. A workflow written another way is named as not read. It is never
// taken as having no job.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listWorkflows } from "./lint.mts";

export interface LeftOut {
  /** The workflow, as a path from the project root. */
  file: string;
  /** The check's name when the file gives one, the job's id otherwise. */
  job: string;
  reason: string;
}

export interface WorkflowChecks {
  /** The checks every pull request runs, in the order of the file. */
  contexts: string[];
  leftOut: LeftOut[];
  /** Why the workflow could not be read. Undefined: it was read. */
  unread?: string;
}

export interface RequiredChecks {
  /** The checks every pull request runs, each named once, in the order of the files. */
  contexts: string[];
  leftOut: LeftOut[];
  /** The workflows that could not be read, with the reason. */
  unread: { file: string; reason: string }[];
}

interface Line {
  indent: number;
  text: string;
}

/** A key, plain or in quotes, and what is written after it on the same line. */
const KEY = /^([\w-]+|"[^"]*"|'[^']*')\s*:(.*)$/;
/** A job: an id GitHub accepts, with nothing after the colon. */
const JOB = /^([A-Za-z_][\w-]*)\s*:$/;

/** The required checks of every workflow in the project at `root`. */
export function requiredChecks(root: string): RequiredChecks {
  const result: RequiredChecks = { contexts: [], leftOut: [], unread: [] };

  for (const file of listWorkflows(root)) {
    const { contexts, leftOut, unread } = readWorkflow(file, readFileSync(join(root, file), "utf8"));

    if (unread !== undefined) {
      result.unread.push({ file, reason: unread });
    }

    result.leftOut.push(...leftOut);

    for (const context of contexts) {
      if (!result.contexts.includes(context)) {
        result.contexts.push(context);
      }
    }
  }

  return result;
}

/** The required checks of one workflow, given its text. */
export function readWorkflow(file: string, text: string): WorkflowChecks {
  const lines = linesOf(text);
  const trigger = readTrigger(lines);

  if (typeof trigger === "string") {
    return { contexts: [], leftOut: [], unread: trigger };
  }

  const jobs = readJobs(lines);

  if (typeof jobs === "string") {
    return { contexts: [], leftOut: [], unread: jobs };
  }

  const result: WorkflowChecks = { contexts: [], leftOut: [] };

  for (const { id, keys, own } of jobs) {
    const name = keys.has("name") ? unquote(keys.get("name") ?? "") : id;
    const reason = trigger.skips ?? whyNotRequired(keys);
    const named = reason !== undefined || name === undefined ? undefined : checkNames(name, keys.has("strategy") ? readMatrix(own) : []);

    if (Array.isArray(named)) {
      result.contexts.push(...named);
    } else {
      result.leftOut.push({ file, job: name ?? id, reason: reason ?? named ?? "its `name:` is not written on one line, so the check's name cannot be read" });
    }
  }

  return result;
}

/** Why a job that every pull request starts is still not one to require. Undefined: it is. */
function whyNotRequired(keys: Map<string, string>): string | undefined {
  if (keys.has("if")) {
    return "it has an `if:`, so a pull request can skip it";
  }

  return keys.has("uses") ? "it calls another workflow, and the checks are named after that workflow's jobs" : undefined;
}

/** One combination of a matrix: each key with its value, in the order of the file. */
type Combination = [key: string, value: string][];

/**
 * The checks of a job named `name`, one per combination of its matrix. A
 * string: why the names are not in the file.
 */
function checkNames(name: string, matrix: Combination[] | string): string[] | string {
  if (typeof matrix === "string") {
    return matrix;
  }

  if (matrix.length === 0) {
    return name.includes("${{") ? "its `name:` holds an expression, so the check's name is not in the file" : [name];
  }

  const names: string[] = [];

  for (const combination of matrix) {
    const values = new Map(combination);
    const replaced = name.replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (expression, key: string) => values.get(key) ?? expression);

    if (replaced.includes("${{")) {
      return "its `name:` holds an expression other than a value of its matrix, so the check's name is not in the file";
    }

    // GitHub adds the values only to a name that shows none of them.
    names.push(replaced === name ? `${name} (${combination.map(([, value]) => value).join(", ")})` : replaced);
  }

  return names;
}

/**
 * Every combination of the matrix under the job's `strategy:`, or none when
 * it has no matrix. A string: why the combinations are not in the file.
 */
function readMatrix(own: Line[]): Combination[] | string {
  const strategy = own.findIndex(({ indent, text }) => indent === own[0]?.indent && /^strategy\s*:/.test(text));
  const under = strategy === -1 ? [] : blockAfter(own, strategy);
  const at = under.findIndex(({ indent, text }) => indent === under[0]?.indent && /^matrix\s*:/.test(text));

  if (at === -1) {
    return [];
  }

  if (((under[at] as Line).text.replace(/^matrix\s*:/, "").trim()) !== "") {
    return "its matrix is not written out as a block, so its combinations are not in the file";
  }

  const block = blockAfter(under, at);
  const keys: { key: string; values: string[] }[] = [];

  for (const [index, { indent, text }] of block.entries()) {
    if (indent !== block[0]?.indent) {
      continue;
    }

    const [, rawKey = "", rawValue = ""] = KEY.exec(text) ?? [];
    const key = unquote(rawKey) ?? "";

    if (key === "include" || key === "exclude") {
      return `its matrix has an \`${key}:\`, so its combinations are not read`;
    }

    const written = rawValue.trim();
    const items = written.startsWith("[") && written.endsWith("]") ? splitList(written.slice(1, -1)) : written === "" ? blockAfter(block, index).map(({ text: item }) => item.replace(/^-\s*/, "")) : undefined;
    const values = items?.map((item) => plainValue(item.trim()));

    if (key === "" || values === undefined || values.length === 0 || values.some((value) => value === undefined)) {
      return `its matrix's \`${key || text}\` is not a list of values written out, so its combinations are not in the file`;
    }

    keys.push({ key, values: values as string[] });
  }

  return keys.reduce<Combination[]>((combinations, { key, values }) => combinations.flatMap((combination) => values.map((value) => [...combination, [key, value] as [string, string]])), [[]]);
}

/** The items of a list written in brackets, split at the commas outside quotes. */
function splitList(inside: string): string[] {
  const items: string[] = [];
  let quote = "";
  let current = "";

  for (const character of inside) {
    if (quote === "" && character === ",") {
      items.push(current);
      current = "";
      continue;
    }

    if (quote === "" && (character === '"' || character === "'")) {
      quote = character;
    } else if (character === quote) {
      quote = "";
    }

    current += character;
  }

  return current.trim() === "" && items.length === 0 ? [] : [...items, current];
}

/** A value of a matrix as GitHub writes it in a check's name. Undefined: an object, a list, an expression, or a number GitHub may write otherwise. */
function plainValue(item: string): string | undefined {
  const value = unquote(item);

  if (value === undefined || value.includes("${{") || (!/^["']/.test(item) && /^[-+]?\d*\.\d+$/.test(item))) {
    return undefined;
  }

  return value;
}

/** `skips` says why some pull requests do not start the workflow. A string in place of the object: `on:` could not be read. */
function readTrigger(lines: Line[]): { skips?: string } | string {
  const at = lines.findIndex(({ indent, text }) => indent === 0 && /^(on|"on"|'on')\s*:/.test(text));

  if (at === -1) {
    return "it has no `on:` at the left edge";
  }

  const inline = (lines[at] as Line).text.replace(/^[^:]+:/, "").trim();
  const block = blockAfter(lines, at);
  const notOnPullRequests = { skips: "its workflow does not run on pull requests" };

  if (inline !== "") {
    if (inline.startsWith("{")) {
      return "its `on:` is written in braces on one line";
    }

    const events = inline.startsWith("[") ? inline.replace(/^\[|\]$/g, "").split(",") : [inline];

    return events.some((event) => unquote(event.trim()) === "pull_request") ? {} : notOnPullRequests;
  }

  const [first] = block;

  if (first === undefined) {
    return "its `on:` is empty";
  }

  if (first.text.startsWith("-")) {
    return block.some(({ text }) => unquote(text.replace(/^-\s*/, "")) === "pull_request") ? {} : notOnPullRequests;
  }

  const start = block.findIndex(({ indent, text }) => indent === first.indent && unquote(KEY.exec(text)?.[1] ?? "") === "pull_request");

  if (start === -1) {
    return notOnPullRequests;
  }

  const value = (KEY.exec((block[start] as Line).text)?.[2] ?? "").trim();
  const under = blockAfter(block, start);
  const filters = under.filter(({ indent }) => indent === under[0]?.indent).map(({ text }) => `\`${text.replace(/:.*$/, "")}\``);

  if (filters.length > 0) {
    return { skips: `its workflow runs on some pull requests only (${filters.join(", ")})` };
  }

  return value === "" || value === "~" || value === "null" || value === "{}" ? {} : { skips: "its workflow runs on some pull requests only" };
}

/** Each job with its own keys and what is written after each on the same line. A string: `jobs:` could not be read. */
function readJobs(lines: Line[]): { id: string; keys: Map<string, string>; own: Line[] }[] | string {
  const at = lines.findIndex(({ indent, text }) => indent === 0 && /^jobs\s*:/.test(text));

  if (at === -1) {
    return "it has no `jobs:` at the left edge";
  }

  const block = blockAfter(lines, at);
  const [first] = block;

  if (first === undefined) {
    return "its `jobs:` is not written as a block";
  }

  const jobs: { id: string; keys: Map<string, string>; own: Line[] }[] = [];

  for (const [index, { indent, text }] of block.entries()) {
    if (indent !== first.indent) {
      continue;
    }

    const id = JOB.exec(text)?.[1];

    if (id === undefined) {
      return `under \`jobs:\`, \`${text}\` is not a job written as a block`;
    }

    const own = blockAfter(block, index);
    const keys = new Map<string, string>();

    for (const line of own) {
      const key = line.indent === own[0]?.indent ? KEY.exec(line.text) : null;

      if (key !== null) {
        keys.set(unquote(key[1] ?? "") ?? "", (key[2] ?? "").trim());
      }
    }

    jobs.push({ id, keys, own });
  }

  return jobs;
}

/** The lines that belong to the key at `at`: those after it that are further in. A list may start at the key's own indent. */
function blockAfter(lines: Line[], at: number): Line[] {
  const { indent } = lines[at] as Line;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => line.indent < indent || (line.indent === indent && !line.text.startsWith("-")));

  return end === -1 ? rest : rest.slice(0, end);
}

/** The lines that say something: no blank line, no comment. */
function linesOf(text: string): Line[] {
  return text
    .split("\n")
    .map(withoutComment)
    .filter((line) => line.trim() !== "")
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
}

/** The line up to its comment. A `#` inside quotes is text, and so is one with no space before it. */
function withoutComment(line: string): string {
  let quote = "";

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] as string;
    const before = index === 0 ? " " : (line[index - 1] as string);

    if (quote !== "") {
      // An escaped character in double quotes, and a doubled quote in single ones, are text.
      if ((character === "\\" && quote === '"') || (character === "'" && quote === "'" && line[index + 1] === "'")) {
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
    } else if ((character === '"' || character === "'") && /[\s:[,{-]/.test(before)) {
      quote = character;
    } else if (character === "#" && /\s/.test(before)) {
      return line.slice(0, index);
    }
  }

  return line;
}

/** A value written on one line, as the text it stands for. Undefined: it is not one (a block, a list, an anchor, nothing). */
function unquote(value: string): string | undefined {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);

      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  if (value.startsWith("'")) {
    return value.length > 1 && value.endsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : undefined;
  }

  return value === "" || /^[|>&*![{]/.test(value) ? undefined : value;
}
