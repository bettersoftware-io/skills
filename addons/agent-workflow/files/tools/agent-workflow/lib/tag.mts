// Creates a week's annotated tag through the GitHub API. The tag is dated by
// its week, not by the run, so a late or manual run gives the same tag.

import { type Ran } from "./system.mts";
import { endOf, type Week } from "./week.mts";

/** Monday 00:05 UTC after the week, as `2026-10-05T00:05:00Z`. */
export function tagDate(week: Week): string {
  return new Date(endOf(week) + 5 * 60_000).toISOString().replace(".000Z", "Z");
}

export type TagResult = { ok: true } | { ok: false; step: "object" | "ref"; error: string };

/** Tags `sha` as the week's name: the tag object first, then the ref that points at it. */
export function createWeekTag(week: Week, sha: string, repository: string, gh: (...args: string[]) => Ran): TagResult {
  const message = `${week.name} - the default branch at the end of ${week.start} .. ${week.end} (UTC). See CHANGELOG.md.`;
  const tag = gh(
    "api",
    `repos/${repository}/git/tags`,
    ...["-f", `tag=${week.name}`, "-f", `message=${message}`, "-f", `object=${sha}`, "-f", "type=commit"],
    ...["-f", "tagger[name]=github-actions[bot]", "-f", "tagger[email]=41898282+github-actions[bot]@users.noreply.github.com"],
    ...["-f", `tagger[date]=${tagDate(week)}`, "--jq", ".sha"],
  );

  if (tag.status !== 0 || tag.stdout.trim() === "") {
    return { ok: false, step: "object", error: tag.stderr.trim() || `exit ${tag.status}` };
  }

  const ref = gh("api", `repos/${repository}/git/refs`, "-f", `ref=refs/tags/${week.name}`, "-f", `sha=${tag.stdout.trim()}`, "--silent");

  return ref.status === 0 ? { ok: true } : { ok: false, step: "ref", error: ref.stderr.trim() || `exit ${ref.status}` };
}
