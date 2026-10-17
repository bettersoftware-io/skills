#!/usr/bin/env node
// Holds docs/STATUS.md to the form the AGENTS.md section of this add-on
// gives it, so that a page an agent edited still answers "what is left?".
//
//   node tools/agent-workflow/check-status.mts
//
// What it judges, all from the page and, for the date, the last commit:
//
// - The six sections are there, each once, in their order, and no other.
// - One "Last updated" line: a date that is a real day and not after today,
//   or "no entry yet" while no section has an entry.
// - Each entry is a bullet that starts with its name in bold, which may wrap
//   onto the indented line under it.
// - A page that differs from the last commit's has today's date: an edit
//   moves it. On a checkout with nothing changed, as in CI, there is nothing
//   to compare, and the date is not judged against the commit.
//
// What it does not: whether an entry is still true, whether it is in the
// right section, and its links (repo-hygiene's link check reads every
// markdown file).
//
// Exit 0: nothing wrong. Exit 1: a FAIL line, with each finding under it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isMainModule } from "./lib/main.mts";

export const STATUS_PAGE = "docs/STATUS.md";

/** The sections, in their order, as the add-on's page writes them. */
export const SECTIONS = ["In progress", "Designed, not built", "Planned, and held by something", "Next, with no plan yet", "Waiting on a person", "Known limits"];

const NO_ENTRY = "no entry yet";
const DATE_LINE = /^\*\*Last updated: (.*)\*\*$/;

export interface StatusOptions {
  /** The page as it is now. */
  text: string;
  /** The page as the last commit has it; undefined when there is no commit or the page is new. */
  committed: string | undefined;
  /** Today, as YYYY-MM-DD. */
  today: string;
}

export interface Finding {
  line: number;
  message: string;
}

export function checkStatus({ text, committed, today }: StatusOptions): Finding[] {
  const lines = text.split("\n");
  const findings: Finding[] = [];
  const headings = lines.flatMap((line, index) => (line.startsWith("## ") ? [{ name: line.slice(3).trim(), line: index + 1 }] : []));

  for (const { name, line } of headings) {
    if (!SECTIONS.includes(name)) {
      findings.push({ line, message: `"## ${name}" is not one of the page's sections (${SECTIONS.join("; ")}). Move its entries into the one that fits` });
    }
  }

  const known = headings.filter(({ name }) => SECTIONS.includes(name));

  for (const name of SECTIONS) {
    const found = known.filter((heading) => heading.name === name);

    if (found.length === 0) {
      findings.push({ line: 0, message: `"## ${name}" is not there. Put it back, empty if nothing is in it` });
    } else if (found.length > 1) {
      findings.push({ line: (found[1] as { line: number }).line, message: `"## ${name}" is there ${found.length} times. Keep one, with every entry of the others in it` });
    }
  }

  const order = known.map(({ name }) => name).filter((name, index, all) => all.indexOf(name) === index);
  const expected = SECTIONS.filter((name) => order.includes(name));

  if (order.join("\n") !== expected.join("\n")) {
    findings.push({ line: 0, message: `the sections are out of order. They go: ${SECTIONS.join("; ")}` });
  }

  // An entry is its bullet and the indented lines under it: a long bold name
  // wraps onto the next line.
  const entries = lines.flatMap((line, index) => (/^[-*] /.test(line) && headings.some((heading) => heading.line < index + 1) ? [{ text: withContinuation(lines, index), line: index + 1 }] : []));

  for (const entry of entries) {
    if (!/^- \*\*[^*]+\*\*/.test(entry.text)) {
      findings.push({ line: entry.line, message: "an entry starts with its name in bold: `- **Name** — what is left`" });
    }
  }

  const dates = lines.flatMap((line, index) => {
    const match = DATE_LINE.exec(line);

    return match === null ? [] : [{ value: match[1] as string, line: index + 1 }];
  });

  if (dates.length !== 1) {
    findings.push({ line: dates[1]?.line ?? 0, message: `the page has ${dates.length} "**Last updated: …**" lines, and has one` });
  }

  const date = dates[0];

  if (date !== undefined) {
    if (date.value === NO_ENTRY) {
      if (entries.length > 0) {
        findings.push({ line: date.line, message: `it says "${NO_ENTRY}", and the page has entries. Write today's date: ${today}` });
      }
    } else if (!isDay(date.value)) {
      findings.push({ line: date.line, message: `"${date.value}" is not a date written YYYY-MM-DD` });
    } else if (date.value > today) {
      findings.push({ line: date.line, message: `${date.value} is after today, ${today}` });
    } else if (committed !== undefined && committed !== text && date.value !== today) {
      findings.push({ line: date.line, message: `the page changed since the last commit, and its date did not move. Write today's: ${today}` });
    }
  }

  return findings;
}

/** The line at `index` and the indented, non-blank lines that follow it, joined. */
function withContinuation(lines: string[], index: number): string {
  const next = lines.slice(index + 1);
  const end = next.findIndex((line) => !/^\s+\S/.test(line));

  return [lines[index] as string, ...next.slice(0, end === -1 ? next.length : end)].join("\n");
}

/** True for YYYY-MM-DD naming a day the calendar has. */
function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const day = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return `PASS ${STATUS_PAGE} — its sections, its date and its entries are in the page's form`;
  }

  return [
    `FAIL ${STATUS_PAGE} (${findings.length})`,
    ...findings.map(({ line, message }) => `  ${line === 0 ? STATUS_PAGE : `${STATUS_PAGE}:${line}`}: ${message}`),
  ].join("\n");
}

/** Today in this machine's time zone, as YYYY-MM-DD: the day a person writes. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The page as the last commit has it, or undefined: no git, no commit, or a page the commit does not have. */
export function readCommitted(root: string): string | undefined {
  const shown = spawnSync("git", ["show", `HEAD:${STATUS_PAGE}`], { cwd: root, encoding: "utf8" });

  return shown.status === 0 ? shown.stdout : undefined;
}

if (isMainModule(import.meta.url)) {
  const root = process.cwd();
  const path = join(root, STATUS_PAGE);

  if (!existsSync(path)) {
    console.log(`FAIL ${STATUS_PAGE} — it is not there. It is the page of what is left; the add-on's starting file has its sections`);
    process.exit(1);
  }

  const findings = checkStatus({ text: readFileSync(path, "utf8"), committed: readCommitted(root), today: localToday() });

  console.log(formatFindings(findings));
  process.exit(findings.length === 0 ? 0 : 1);
}
