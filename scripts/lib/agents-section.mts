// An add-on's section of a project's AGENTS.md: the text between its two
// markers. The installer writes it, and an update replaces it, as it does a
// file of the add-on. So a section the project edited is treated as an edited
// file is: never replaced in silence.
//
// What was installed is kept as a copy in `tools/templates/`, an installed
// file of the add-on like any other, so `tools/installed.json` records its
// hash and the copy about to be replaced is the old text to compare with. A
// record from before the copy was kept has only the add-on's history to go
// on: `agents-sections-shipped.json` holds a hash of every version of each
// add-on's section that was shipped before then. It never needs a new entry:
// a project that updates after this has the copy.

import { createHash } from "node:crypto";

/** Where the project keeps the section as the add-on last installed it. */
export function sectionTemplateOf(unit: string): string {
  return `tools/templates/${unit}.AGENTS.section.md.txt`;
}

/** The two lines that hold the unit's section. */
export function sectionMarkers(unit: string): { start: string; end: string } {
  return { start: `<!-- add-on: ${unit} -->`, end: `<!-- /add-on: ${unit} -->` };
}

/** Where the unit's section is in the file: its first start marker, and the first end marker after it. Undefined when there are not both. */
export function findSection(agents: string, unit: string): { from: number; to: number } | undefined {
  const { start, end } = sectionMarkers(unit);
  const from = agents.indexOf(start);
  const to = from === -1 ? -1 : agents.indexOf(end, from);

  return to === -1 ? undefined : { from, to };
}

/** The text between the unit's markers, trimmed. Undefined when the file has no section for the unit. */
export function readSection(agents: string, unit: string): string | undefined {
  const found = findSection(agents, unit);

  return found === undefined ? undefined : agents.slice(found.from + sectionMarkers(unit).start.length, found.to).trim();
}

/**
 * `absent`: AGENTS.md has no section for the unit (never had one, or the
 * project deleted it): it is added. `same`: the project's section is the
 * add-on's text now. `untouched`: it is what was installed, and is replaced.
 * `kept`: the project changed it and the add-on did not: it stays. `edited`:
 * the project changed it and the update would replace it: refused, as an
 * edited file is, unless forced.
 */
export type SectionState = "absent" | "same" | "untouched" | "kept" | "edited";

export interface SectionFacts {
  /** The project's section, trimmed. */
  current: string | undefined;
  /** The copy of what was installed, trimmed. Undefined when the project has none. */
  installed: string | undefined;
  /** The add-on's section now, in the project's scope, trimmed. */
  shipped: string;
  /** True when `current` is a version of the section the add-on shipped before the copy was kept. */
  shippedBefore: boolean;
}

export function judgeSection({ current, installed, shipped, shippedBefore }: SectionFacts): SectionState {
  if (current === undefined) {
    return "absent";
  }

  if (current === shipped) {
    return "same";
  }

  if (installed === undefined) {
    // No copy: only a text the add-on is known to have shipped was never changed here.
    return shippedBefore ? "untouched" : "edited";
  }

  if (current === installed) {
    return "untouched";
  }

  return installed === shipped ? "kept" : "edited";
}

/** The hash a version of a section is known by. `text` is trimmed, and in the starter's scope. */
export function sectionHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
