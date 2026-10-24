// Names the finished weeks whose CHANGELOG.md entry is missing or does not
// cite every pull request merged in them. It reads git alone, the working
// file and the remote branch's copy, so it works offline and in a hook.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { citationsIn, ChangelogError, sectionOf, weeksIn } from "./changelog.mts";
import { type Merge, readHistory, remoteBranch } from "./history.mts";
import { type Run } from "./system.mts";
import { isInWeek, lastFinishedWeek, parseWeek, startOf, type Week, weekAfter } from "./week.mts";

export interface DueWeek {
  week: Week;
  /** Every pull request merged in the week, in number order. */
  merged: number[];
  /** The merged ones the best text does not cite in the week's section. */
  missing: number[];
  /** True when either text already has a heading for the week. */
  extend: boolean;
}

/**
 * The finished weeks to write or extend, oldest first. `texts` holds the
 * working and the remote CHANGELOG.md. A week is judged from the newest
 * heading in any text, when it is finished, up to the last finished week;
 * with no heading, only the last finished week is. It is due when it has
 * merges and no text cites them all in its section.
 */
export function dueWeeks(texts: string[], merges: Merge[], now: Date): DueWeek[] {
  const last = lastFinishedWeek(now);
  const newest = texts
    .flatMap(weeksIn)
    .map(parseWeek)
    .sort((a, b) => startOf(b) - startOf(a))[0];
  const due: DueWeek[] = [];

  for (let week = newest === undefined ? last : newest; startOf(week) <= startOf(last); week = weekAfter(week)) {
    const merged = [...new Set(merges.filter(({ mergedAt }) => isInWeek(week, mergedAt)).map(({ number }) => number))].sort((a, b) => a - b);
    const missing = texts.map((text) => notCitedIn(text, week.name, merged));

    if (!missing.some((numbers) => numbers.length === 0)) {
      due.push({
        week,
        merged,
        missing: missing.reduce((fewest, numbers) => (numbers.length < fewest.length ? numbers : fewest)),
        extend: texts.some((text) => sectionOf(text, week.name) !== undefined),
      });
    }
  }

  return due;
}

/** One line for the session reminder and the weekly issue. */
export function describeDue({ week, merged, missing, extend }: DueWeek): string {
  if (!extend) {
    return `${week.name}  ${merged.length} merged, no entry: write it with /workflow:changelog ${week.name}`;
  }

  return `${week.name}  ${merged.length} merged, ${missing.length} not cited (${missing.map((number) => `#${number}`).join(", ")}): extend it with /workflow:changelog ${week.name}`;
}

/** The weeks due at `ref` (the remote branch when none is given), from the working file and the file at `ref`. */
export function findDue(root: string, run: Run, now: Date, ref?: string): DueWeek[] {
  const file = join(root, "CHANGELOG.md");

  if (!existsSync(file)) {
    throw new ChangelogError("there is no CHANGELOG.md at the project root");
  }

  const at = ref ?? remoteBranch(root, run);

  if (at === undefined) {
    throw new ChangelogError("there is no remote branch (origin/HEAD or origin/main) to read the merged pull requests from");
  }

  const merges = readHistory(root, at, run);
  const shown = run("git", ["show", "--end-of-options", `${at}:CHANGELOG.md`], root);

  return dueWeeks([readFileSync(file, "utf8"), shown.status === 0 ? shown.stdout : ""], merges, now);
}

/** The merged numbers the week's section in `text` does not cite; all of them when it has no section. */
function notCitedIn(text: string, week: string, merged: number[]): number[] {
  const cited = citationsIn(sectionOf(text, week) ?? "");

  return merged.filter((number) => !cited.includes(number));
}
