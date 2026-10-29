// The commits a workflow's actions are pinned to, which an update bot moves.
//
// Renovate and Dependabot move `uses: owner/repo@<commit> # <version>` in a
// project's workflows every week, and an add-on wrote those workflows. Without
// this, each moved file reads as edited in the project, and the add-on's next
// update refuses it. With it, a file whose only changes are such lines takes
// the add-on's new copy, at whichever version of each action is newer.

/** The workflows an update bot moves. Only these are compared without their action refs. */
export function isWorkflow(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
}

// One `uses:` of a step, pinned with `@`, with the version comment the bots
// write beside a commit. A local action (`./…`) has no `@` and is not one.
const USES = /^(\s*(?:-\s+)?uses:\s*)(["']?)([^@\s"']+)@([^\s"'#]+)\2(?:\s+#\s*(\S+))?\s*$/;

interface Use {
  action: string;
  ref: string;
  comment: string | undefined;
}

function parseUse(line: string): ({ prefix: string; quote: string } & Use) | undefined {
  const match = USES.exec(line);

  if (match === null) {
    return undefined;
  }

  const [, prefix = "", quote = "", action = "", ref = "", comment] = match;

  return { prefix, quote, action, ref, comment };
}

/** The text with every action's ref and version comment taken out, so two files that differ only in those read the same. */
export function withoutActionRefs(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const use = parseUse(line);

      return use === undefined ? line : `${use.prefix}${use.quote}${use.action}@${use.quote}`;
    })
    .join("\n");
}

/** The numbers of a version comment (`v7`, `v4.2.0`), or undefined when it is not one. */
function versionOf(comment: string | undefined): number[] | undefined {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(comment ?? "");

  return match?.[1]?.split(".").map(Number);
}

/** Above zero when `a` is the newer version. A missing part counts as 0: v7 is v7.0.0. */
export function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/**
 * The shipped text, with each action at the project's ref wherever the
 * project's version comment names a newer version than the shipped one. An
 * action whose versions cannot both be read stays as shipped.
 */
export function keepNewerActionRefs(project: string, shipped: string): string {
  const newest = new Map<string, Use & { version: number[] }>();

  for (const line of project.split("\n")) {
    const use = parseUse(line);
    const version = versionOf(use?.comment);

    if (use === undefined || version === undefined) {
      continue;
    }

    const seen = newest.get(use.action);

    if (seen === undefined || compareVersions(version, seen.version) > 0) {
      newest.set(use.action, { ...use, version });
    }
  }

  return shipped
    .split("\n")
    .map((line) => {
      const use = parseUse(line);
      const version = versionOf(use?.comment);
      const theirs = use === undefined ? undefined : newest.get(use.action);

      if (use === undefined || version === undefined || theirs === undefined || compareVersions(theirs.version, version) <= 0) {
        return line;
      }

      return `${use.prefix}${use.quote}${use.action}@${theirs.ref}${use.quote} # ${theirs.comment}`;
    })
    .join("\n");
}
