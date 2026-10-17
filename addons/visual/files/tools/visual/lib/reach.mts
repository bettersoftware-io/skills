// What no scenario renders: the UI files with statements, branches or
// functions the visual run never reached, read from istanbul's
// `coverage-final.json`, the most left out first.

import { relative, sep } from "node:path";

interface Position {
  line?: number;
  column?: number;
}

interface Range {
  start?: Position;
  end?: Position;
}

/** The parts of one entry of istanbul's `coverage-final.json` this reads. */
export interface IstanbulFile {
  path: string;
  statementMap: Record<string, Range>;
  s: Record<string, number>;
  fnMap: Record<string, { name: string; loc?: Range }>;
  f: Record<string, number>;
  branchMap: Record<string, { loc?: Range; locations?: Range[] }>;
  b: Record<string, number[]>;
}

export interface ReachGap {
  /** Path from the root given to `rankReach`. */
  file: string;
  uncoveredStatements: number;
  /** The share of statements rendered; 100 when there is none. */
  statementsPct: number;
  /** The lines where a branch is never taken, once each, in order. */
  branchLines: number[];
  /** The functions never called. */
  functions: string[];
}

/** Every file with something no scenario reaches: most uncovered statements first, then lower percentage, then path. */
export function rankReach(coverage: Record<string, IstanbulFile>, root: string): ReachGap[] {
  return Object.entries(coverage)
    .map(([path, file]) => toGap(relative(root, path).split(sep).join("/"), file))
    .filter((gap) => gap.uncoveredStatements + gap.branchLines.length + gap.functions.length > 0)
    .sort((a, b) => b.uncoveredStatements - a.uncoveredStatements || a.statementsPct - b.statementsPct || a.file.localeCompare(b.file));
}

function toGap(file: string, coverage: IstanbulFile): ReachGap {
  const counts = Object.values(coverage.s);
  const uncoveredStatements = counts.filter((count) => count === 0).length;
  const branchLines = new Set<number>();

  for (const [id, taken] of Object.entries(coverage.b)) {
    const branch = coverage.branchMap[id];

    taken.forEach((count, arm) => {
      // An arm with no place of its own (an `if` with no `else`) is put at the branch.
      const line = branch?.locations?.[arm]?.start?.line ?? branch?.loc?.start?.line;

      if (count === 0 && line !== undefined) {
        branchLines.add(line);
      }
    });
  }

  return {
    file,
    uncoveredStatements,
    statementsPct: counts.length === 0 ? 100 : ((counts.length - uncoveredStatements) / counts.length) * 100,
    branchLines: [...branchLines].sort((a, b) => a - b),
    functions: Object.entries(coverage.f)
      .filter(([, count]) => count === 0)
      .map(([id]) => coverage.fnMap[id]?.name ?? `(function ${id})`),
  };
}

export function formatReach(gaps: ReachGap[], limit: number): string {
  if (gaps.length === 0) {
    return "Every statement, branch and function in the UI is rendered by some scenario.";
  }

  const lines = ["  statements not rendered   statements %   file"];

  for (const gap of gaps.slice(0, limit)) {
    lines.push(`${String(gap.uncoveredStatements).padStart(25)}${`${gap.statementsPct.toFixed(1)}%`.padStart(15)}   ${gap.file}`);

    if (gap.branchLines.length > 0) {
      lines.push(`      branches never taken at lines ${gap.branchLines.join(", ")}`);
    }

    if (gap.functions.length > 0) {
      lines.push(`      functions never called: ${gap.functions.join(", ")}`);
    }
  }

  if (gaps.length > limit) {
    lines.push(`  … ${gaps.length - limit} more (raise --limit)`);
  }

  lines.push("", `${gaps.length} UI file(s) with code no scenario renders. Those are states no scenario shows yet.`);

  return lines.join("\n");
}
