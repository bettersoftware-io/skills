// What the visual scenarios render: the summary `pnpm visual:coverage` writes.
// gaps only reads it. It never starts a browser.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { Metric } from "./config.mts";
import type { Count, FileCoverage } from "./measure.mts";

export const VISUAL_SUMMARY = "packages/client-react/tests/visual/reports/coverage/coverage-summary.json";

export interface VisualReach {
  files: FileCoverage[];
  /** When the summary was written: its modification time. */
  writtenAt: Date;
}

/** A summary that is there and could not be read: its section is left out, and this line says so. */
export interface UnreadableVisualReach {
  unreadable: string;
}

type SummaryEntry = Partial<Record<Metric, { total?: number; covered?: number; pct?: number | string }>>;

export function readVisualReach(root: string): VisualReach | UnreadableVisualReach | undefined {
  const path = join(root, VISUAL_SUMMARY);

  if (!existsSync(path)) {
    return undefined;
  }

  // A summary cut short by a run that stopped must not cost the units' report.
  try {
    return readSummary(root, path);
  } catch {
    return { unreadable: `${VISUAL_SUMMARY} could not be read, so what the visual scenarios render is left out. Run pnpm visual:coverage again to write it.` };
  }
}

function readSummary(root: string, path: string): VisualReach {
  const summary = JSON.parse(readFileSync(path, "utf8")) as Record<string, SummaryEntry>;
  const files = Object.entries(summary)
    .filter(([key]) => key !== "total")
    .map(([key, entry]) => ({
      file: toProjectPath(root, key),
      lines: readCount(entry.lines),
      statements: readCount(entry.statements),
      functions: readCount(entry.functions),
      branches: readCount(entry.branches),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return { files, writtenAt: statSync(path).mtime };
}

/** The summary holds absolute paths; a path outside the project is kept as written. */
function toProjectPath(root: string, absolute: string): string {
  const inProject = relative(root, absolute);

  return inProject.startsWith("..") ? absolute : inProject.split(sep).join("/");
}

function readCount(count: SummaryEntry[Metric]): Count {
  const total = count?.total ?? 0;
  const covered = count?.covered ?? 0;

  // istanbul writes "Unknown" when there is nothing to count.
  return { total, covered, pct: typeof count?.pct === "number" ? count.pct : total === 0 ? 100 : (covered / total) * 100 };
}
