// Reads CHANGELOG.md and judges one week's entry against the pull requests
// that were merged in that week.
//
// What a week's entry says is a matter of judgement. These things are not, so
// they are checked:
//
//   1. every pull request merged in the week is cited in the week's section;
//   2. every pull request the section cites was merged in the week;
//   3. the link definitions of citations are the ones `changelog defs` writes.

import { lastFinishedWeek, parseWeek, startOf, type Week, weekAfter, weekOf } from "./week.mts";

const HEADING = /^## (\d{4}-W\d{2})\b.*$/gm;
/** `[#12]`, but not the `[#12]:` that starts a definition. */
const CITATION = /\[#(\d+)\](?!:)/g;
/** ``[`abc1234`]``, but not the definition that starts with the same text. */
const COMMIT_CITATION = /\[`([0-9a-f]{7,40})`\](?!:)/g;
/** A definition of citation form: `[#12]: url` or ``[`abc1234`]: url``. */
const DEFINITION = /^\[(#\d+|`[0-9a-f]{7,40}`)\]:[ \t]*(\S+)[ \t]*$/gm;
/** Any line that defines a link, read as `DEFINITION` reads one: every citation definition is one, and so is `[the doc]: url`. */
export const LINK_DEFINITION = /^\[[^\]]+\]:[ \t]*\S+[ \t]*$/;
/** The start of any line that defines a citation, whatever follows. */
const DEFINITION_LINE = /^(?:\[#\d+\]:|\[`[0-9a-f]{7,40}`\]:)/;

/** A reason `changelog` could not judge anything. */
export class ChangelogError extends Error {}

export interface MergedPullRequest {
  number: number;
  title: string;
  /** ISO timestamp, UTC. */
  mergedAt: string;
}

/** The names of the weeks that have a heading, in the order they appear. */
export function weeksIn(text: string): string[] {
  return [...text.matchAll(HEADING)].map((match) => match[1] as string);
}

/** The text of one week's section: from its heading to the next `## ` heading, or to the end of the file. */
export function sectionOf(text: string, week: string): string | undefined {
  const heading = [...text.matchAll(HEADING)].find((match) => match[1] === week);

  if (heading === undefined) {
    return undefined;
  }

  const body = text.slice(heading.index + heading[0].length);
  const end = body.search(/^## /m);

  return end === -1 ? body : body.slice(0, end);
}

export function citationsIn(text: string): number[] {
  return [...new Set([...text.matchAll(CITATION)].map((match) => Number(match[1])))];
}

/** The commits cited, as the labels written between the backticks, in the order first cited. */
export function commitCitationsIn(text: string): string[] {
  return [...new Set([...text.matchAll(COMMIT_CITATION)].map((match) => match[1] as string))];
}

/** Every definition of citation form, in file order. The label is `#12` or ``\`abc1234\` ``. */
export function definitionsIn(text: string): { label: string; url: string }[] {
  return [...text.matchAll(DEFINITION)].map((match) => ({ label: match[1] as string, url: match[2] as string }));
}

/**
 * The definition lines the text's citations need, as `[#N]: <repo>/pull/N`
 * for each pull request, ascending, then one for each commit, by label. A
 * commit keeps the address it already has when that address is its own.
 */
export function expectedDefinitions(text: string, repo: string): string[] {
  const existing = definitionsIn(text);
  const pulls = [...citationsIn(text)].sort((a, b) => a - b).map((number) => `[#${number}]: ${repo}/pull/${number}`);
  const commits = [...commitCitationsIn(text)].sort().map((sha) => {
    const kept = existing.find((definition) => definition.label === `\`${sha}\``)?.url;
    const url = kept?.startsWith(`${repo}/commit/${sha}`) ? kept : `${repo}/commit/${sha}`;

    return `[\`${sha}\`]: ${url}`;
  });

  return [...pulls, ...commits];
}

/**
 * The text with its citation definitions taken from wherever they are and
 * written as one block at the end. Other reference definitions stay put.
 */
export function withDefinitions(text: string, repo: string): string {
  const body = text.split("\n").filter((line) => !DEFINITION_LINE.test(line)).join("\n");
  const definitions = expectedDefinitions(text, repo);

  return definitions.length === 0 ? body : `${body.trimEnd()}\n\n${definitions.join("\n")}\n`;
}

/** What is wrong with the week's entry, one line each. Empty when nothing is. */
export function checkWeek(text: string, week: string, merged: number[], repo: string): string[] {
  const problems: string[] = [];
  const section = sectionOf(text, week);

  if (section === undefined) {
    if (merged.length > 0) {
      problems.push(`there is no "## ${week}" heading, and ${merged.length} pull request(s) were merged that week: ${list(merged)}`);
    }
  } else {
    const cited = citationsIn(section);
    const missing = merged.filter((number) => !cited.includes(number));
    const notMerged = cited.filter((number) => !merged.includes(number));

    if (missing.length > 0) {
      problems.push(`merged in ${week} and not cited in its section: ${list(missing)}`);
    }

    if (notMerged.length > 0) {
      problems.push(`cited in ${week} and not merged in it: ${list(notMerged)}. A reference to earlier work is a plain link, not a citation`);
    }
  }

  if (withDefinitions(text, repo) !== text) {
    problems.push("the link definitions are not what `pnpm changelog defs` writes: run `pnpm changelog defs --write`");
  }

  return problems;
}

/**
 * The weeks to write: every week after the newest one in the file, up to and
 * including the week `now` is in. When the newest week in the file is the
 * current one, that week alone: its entry is partial and is extended in
 * place. With no week in the file, the last finished week and the current one.
 */
export function weeksToWrite(text: string, now: Date): Week[] {
  const newest = weeksIn(text).map(parseWeek).sort((a, b) => startOf(b) - startOf(a))[0];
  const current = weekOf(now);

  if (newest === undefined) {
    return [lastFinishedWeek(now), current];
  }

  if (newest.name === current.name) {
    return [current];
  }

  const weeks: Week[] = [];

  for (let week = weekAfter(newest); startOf(week) <= startOf(current); week = weekAfter(week)) {
    weeks.push(week);
  }

  return weeks;
}

function list(numbers: number[]): string {
  return [...numbers].sort((a, b) => a - b).map((number) => `#${number}`).join(", ");
}
