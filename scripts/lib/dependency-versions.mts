// What an update does with a dependency the add-on sets and the project
// already has at another version.
//
// Renovate and Dependabot move a project's dependencies, the add-on's among
// them. Refusing every one of those would refuse every update of a project
// that has a bot, so the newer of the two is kept, as for a workflow's actions
// (`action-pins.mts`). Only two values that cannot both be read as versions of
// the same package are still a conflict.

import { compareVersions } from "./action-pins.mts";

/** `keep` the project's, `take` the add-on's, or a `conflict` a person decides. */
export type VersionVerdict = "keep" | "take" | "conflict";

interface Version {
  /** The package of an `npm:` alias, or "" for none. */
  alias: string;
  numbers: number[];
}

/**
 * The project's version is kept when it is the newer or the same, whatever its
 * range operator; the add-on's is taken when the project's is older.
 */
export function judgeDependencyVersion(project: string, addon: string): VersionVerdict {
  const theirs = readVersion(project);
  const ours = readVersion(addon);

  if (theirs === undefined || ours === undefined || theirs.alias !== ours.alias) {
    return "conflict";
  }

  return compareVersions(theirs.numbers, ours.numbers) >= 0 ? "keep" : "take";
}

/** `2.6.2`, `^2.6`, `~1.0.0`, `>=26`, `npm:@typescript/typescript6@^6.0.2`; anything else is undefined. */
function readVersion(value: string): Version | undefined {
  const match = /^(?:npm:(@?[^@\s]+)@)?(?:\^|~|>=)?(\d+(?:\.\d+){0,2})$/.exec(value.trim());

  if (match === null) {
    return undefined;
  }

  return { alias: match[1] ?? "", numbers: (match[2] ?? "").split(".").map(Number) };
}
