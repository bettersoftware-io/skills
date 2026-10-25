// Reads, from git alone, which pull requests were merged and when, and where
// the repository lives on GitHub. Nothing here reaches a network, so it works
// offline and in a hook.
//
// A pull request is recognised by its merge commit's subject: GitHub's
// "Merge pull request #12 from ...", RTC's "Merge PR #12: ..." or a squash's
// trailing " (#12)". Only the first parent of the branch is followed, so a
// commit that came in on a merged side branch is not counted.

import { type Run } from "./system.mts";

export class HistoryError extends Error {}

export interface Merge {
  number: number;
  /** ISO, UTC. */
  mergedAt: string;
}

const GITHUB_MERGE = /^Merge pull request #(\d+) from /;
const RTC_MERGE = /^Merge PR #(\d+): /;
const TRAILING_NUMBER = / \(#(\d+)\)$/;

/** The pull request a subject names, or `undefined`. With several trailing numbers, the last counts. */
function numberIn(subject: string): number | undefined {
  const match = GITHUB_MERGE.exec(subject) ?? RTC_MERGE.exec(subject) ?? TRAILING_NUMBER.exec(subject);

  return match === null ? undefined : Number(match[1]);
}

/** Turns `git log` lines of `<sha>\t<committer ISO date>\t<subject>` into merges, oldest first. */
export function parseHistory(log: string): Merge[] {
  const merges: Merge[] = [];

  for (const line of log.split("\n")) {
    const [, date, ...subject] = line.split("\t");
    const number = numberIn(subject.join("\t"));

    if (date !== undefined && number !== undefined) {
      const time = new Date(date);

      if (Number.isNaN(time.getTime())) {
        throw new HistoryError(`git printed a date that is not one: ${date}`);
      }

      merges.push({ number, mergedAt: time.toISOString() });
    }
  }

  return merges.reverse();
}

/**
 * The pull requests merged into `ref`, following first parents only. With
 * `since` (an ISO instant), only those committed at or after it.
 *
 * The bound is applied here, not with git's `--since`: git stops walking at
 * the first commit dated before it, so one older commit pushed straight to
 * the branch would hide every merge behind it. The whole first-parent list
 * is read instead; 1552 commits of RTC took 28 ms.
 */
export function readHistory(root: string, ref: string, run: Run, since?: string): Merge[] {
  const log = run("git", ["log", "--first-parent", "--format=%H%x09%cI%x09%s", "--end-of-options", ref], root);

  if (log.status !== 0) {
    throw new HistoryError(`git could not read the history of ${ref}: ${log.stderr.trim()}`);
  }

  const merges = parseHistory(log.stdout);

  return since === undefined ? merges : merges.filter(({ mergedAt }) => Date.parse(mergedAt) >= Date.parse(since));
}

/** `origin/HEAD` when it exists, else `origin/main`, else `undefined`. */
export function remoteBranch(root: string, run: Run): string | undefined {
  return ["origin/HEAD", "origin/main"].find((ref) => run("git", ["rev-parse", "--verify", "--quiet", ref], root).status === 0);
}

/**
 * The repository's `https://github.com/owner/name`, from `origin`; `undefined`
 * for any other host. An https origin may carry credentials, as the one
 * claude-code-action writes does (`https://x-access-token:<token>@github.com/…`):
 * they are dropped, and the origin is never printed.
 */
export function repositoryUrl(root: string, run: Run): string | undefined {
  const origin = run("git", ["remote", "get-url", "origin"], root);

  if (origin.status !== 0) {
    return undefined;
  }

  const match = /^(?:git@github\.com:|https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(origin.stdout.trim());

  return match === null ? undefined : `https://github.com/${match[1]}`;
}
