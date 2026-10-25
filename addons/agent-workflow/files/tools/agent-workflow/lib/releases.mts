// Renders each week of CHANGELOG.md as the notes of a GitHub Release, and
// plans which releases to write. Nothing here reaches GitHub or the disk.
//
// A release body has no link-definition block and no file to resolve relative
// links against, so the section gets three rewrites:
//   [#123]          -> #123            (GitHub autolinks it, with the pull request's title)
//   [`abc123456`]   -> [`abc123456`](<commit url from the definition>)
//   ](docs/x.md)    -> ](<repo>/blob/<branch>/docs/x.md)

import { definitionsIn, LINK_DEFINITION } from "./changelog.mts";

/** A week of the file: its tag (`2026-W41`), its whole heading, and the text under it. */
export interface ReleaseWeek {
  tag: string;
  title: string;
  section: string;
}

export interface Release {
  id: number;
  tag: string;
  name: string;
  body: string;
}

export interface RemoteState {
  tags: string[];
  releases: Release[];
  latestTag: string | null;
}

export interface PlannedRelease {
  action: "create" | "update";
  tag: string;
  name: string;
  body: string;
  latest: boolean;
  id?: number;
}

export interface Plan {
  changes: PlannedRelease[];
  unchanged: string[];
  /** Weeks with a section and no tag yet: they get no release until the tag exists. */
  untagged: string[];
}

/** A section that cannot be turned into notes. */
export class ReleaseError extends Error {}

/** The address the check renders with. Whether a week renders does not depend on it. */
const CHECK_REPO = "https://github.com/owner/repo";

/** The weeks in file order. The definitions at the end of the file are not part of the last week. */
export function parseWeeks(text: string): ReleaseWeek[] {
  const body = text
    .split("\n")
    .filter((line) => !LINK_DEFINITION.test(line))
    .join("\n");

  return body
    .split(/\n(?=## \d{4}-W\d\d\b)/)
    .slice(1)
    .map((part) => {
      const [heading = "", ...rest] = part.split("\n");
      const title = heading.slice(3).trim();

      return { tag: title.slice(0, 8), title, section: rest.join("\n").trim() };
    });
}

/** Label to address, for every citation the file defines. A commit's label keeps its backticks. */
export function definitionMap(text: string): Map<string, string> {
  return new Map(definitionsIn(text).map(({ label, url }) => [label, url]));
}

/** The notes of one week, ending with a link back to its heading. Throws ReleaseError for a commit with no definition. */
export function renderReleaseBody(week: ReleaseWeek, definitions: Map<string, string>, repo: string, branch: string): string {
  const blob = `${repo}/blob/${branch}`;
  const notes = week.section
    .replace(/\[(#\d+)\](?![(:[])/g, "$1")
    .replace(/\[`([0-9a-f]{7,40})`\](?![(:[])/g, (_, sha: string) => {
      const url = definitions.get(`\`${sha}\``);

      if (url === undefined) {
        throw new ReleaseError(`${week.tag}: commit [\`${sha}\`] has no definition`);
      }

      return `[\`${sha}\`](${url})`;
    })
    .replace(/\]\(([^)\s]+)\)/g, (link, target: string) => {
      if (/^[a-z][a-z0-9+.-]*:/.test(target) || target.startsWith("//")) {
        return link;
      }

      return target.startsWith("#") ? `](${blob}/CHANGELOG.md${target})` : `](${blob}/${target.replace(/^\.\//, "")})`;
    });
  const anchor = `${blob}/CHANGELOG.md#${slugifyHeading(week.title)}`;

  return `${notes}\n\n---\n\nGenerated from the [${week.tag} entry](${anchor}) in \`CHANGELOG.md\`. Edit it there: this release is rewritten whenever that section changes.`;
}

/**
 * What is wrong with rendering every week of the text, one line each. Empty
 * when every week renders. It needs no network: `repo` and `branch` shape the
 * links and nothing else.
 */
export function checkRendering(text: string, repo: string, branch: string): string[] {
  const definitions = definitionMap(text);
  const problems: string[] = [];

  for (const week of parseWeeks(text)) {
    try {
      renderReleaseBody(week, definitions, repo, branch);
    } catch (error) {
      if (!(error instanceof ReleaseError)) {
        throw error;
      }

      problems.push(error.message);
    }
  }

  return problems;
}

/**
 * The one offline check both `sync-releases --check` and the add-on's check
 * run: how many weeks the text has, and what stops each from rendering. With
 * no week there is nothing to render, and the caller says so.
 */
export function renderCheck(text: string): { weeks: number; problems: string[] } {
  const weeks = parseWeeks(text).length;

  return { weeks, problems: weeks === 0 ? [] : checkRendering(text, CHECK_REPO, "main") };
}

/**
 * GitHub's heading anchor for the characters a week heading uses: lowercased,
 * punctuation such as the em and en dashes dropped, and each space turned
 * into a hyphen, so " — " becomes "--".
 */
function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/ /g, "-");
}

/**
 * What to write: oldest tagged week first, so the releases page lists them in
 * week order. Only the newest tagged week is Latest. A release whose name and
 * body already match is left alone.
 */
export function planReleases(weeks: ReleaseWeek[], state: RemoteState, render: (week: ReleaseWeek) => string): Plan {
  const tags = new Set(state.tags);
  const byTag = new Map(state.releases.map((release): [string, Release] => [release.tag, release]));
  const tagged = weeks.filter((week) => tags.has(week.tag)).sort((a, b) => a.tag.localeCompare(b.tag));
  const newest = tagged.at(-1)?.tag;
  const plan: Plan = { changes: [], unchanged: [], untagged: weeks.filter((week) => !tags.has(week.tag)).map((week) => week.tag) };

  for (const week of tagged) {
    const body = render(week);
    const latest = week.tag === newest;
    const existing = byTag.get(week.tag);

    if (existing === undefined) {
      plan.changes.push({ action: "create", tag: week.tag, name: week.title, body, latest });
    } else if (existing.name !== week.title || existing.body.trim() !== body.trim() || (latest && state.latestTag !== week.tag)) {
      plan.changes.push({ action: "update", id: existing.id, tag: week.tag, name: week.title, body, latest });
    } else {
      plan.unchanged.push(week.tag);
    }
  }

  return plan;
}
