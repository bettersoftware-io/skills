// Lockfile gate: every package of the workspace has its entry under
// `importers:` in pnpm-lock.yaml.
//
// pnpm 12 writes no entry for a package with no dependency, and its frozen
// install, the one CI runs, then refuses the lockfile. Every gate passes on
// the machine that wrote it, and only CI fails. The entry of such a package
// is `packages/<name>: {}`.
//
// This is not a YAML parser. It reads the keys pnpm writes under
// `importers:`, two spaces in, plain or in single quotes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Finding, Project } from "./config.mts";

const GATE = "lockfile";
const LOCKFILE = "pnpm-lock.yaml";

/** Why this gate judged nothing, if it did. */
export function lockfileSkipReason({ root }: Pick<Project, "root">): string | undefined {
  return existsSync(join(root, LOCKFILE)) ? undefined : `there is no ${LOCKFILE} at the root, so there was nothing to check`;
}

/**
 * The keys under `importers:`: the folder of each package, `.` for the root.
 * pnpm 12 writes two documents in one file, each with an `importers:` (the
 * first is pnpm's own), so every such section is read. Undefined when the
 * file has none.
 */
export function readImporters(text: string): Set<string> | undefined {
  let importers: Set<string> | undefined;
  let inside = false;

  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inside = /^importers:\s*$/.test(line);
      importers = inside ? (importers ?? new Set()) : importers;
      continue;
    }

    const key = inside ? /^ {2}('(?:[^']|'')*'|[^\s'][^:]*):(\s|$)/.exec(line)?.[1] : undefined;

    if (key !== undefined) {
      importers?.add(key.startsWith("'") ? key.slice(1, -1).replaceAll("''", "'") : key);
    }
  }

  return importers;
}

// Not one of the per-file gates: a package's new package.json has no entry
// until `pnpm install` runs, and the editor hook would name it at every edit.
export function checkLockfile({ root, workspace }: Pick<Project, "root" | "workspace">): Finding[] {
  if (!existsSync(join(root, LOCKFILE))) {
    return [];
  }

  const importers = readImporters(readFileSync(join(root, LOCKFILE), "utf8"));

  if (importers === undefined) {
    return [
      {
        gate: GATE,
        file: LOCKFILE,
        message: `${LOCKFILE} has no importers: section, so which packages it covers cannot be read. Run pnpm install to write it again.`,
      },
    ];
  }

  return workspace
    .filter(({ path }) => !importers.has(path))
    .map(({ path }) => ({
      gate: GATE,
      file: LOCKFILE,
      message: `${path} is a package of the workspace and has no entry under importers: in ${LOCKFILE}. pnpm writes none for a package with no dependency, and the frozen install that CI runs then refuses the lockfile, while every gate passes here. Add "  ${path}: {}" under importers:, or run pnpm install if the package has dependencies.`,
    }));
}
