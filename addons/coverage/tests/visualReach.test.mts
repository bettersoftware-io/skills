import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { formatGaps } from "../files/tools/coverage/gaps.mts";
import { readVisualReach, VISUAL_SUMMARY } from "../files/tools/coverage/lib/visualReach.mts";
import { createFileCoverage, createFolder, createResult } from "./support.mts";

function entry(covered: number, total: number) {
  return { total, covered, skipped: 0, pct: total === 0 ? 100 : (covered / total) * 100 };
}

function summaryEntry(lines: [number, number], branches: [number, number] = [0, 0]) {
  return { lines: entry(...lines), statements: entry(...lines), functions: entry(...lines), branches: entry(...branches) };
}

/** A project holding a visual summary for two files, written at `writtenAt`. */
function createVisualProject(writtenAt: Date): string {
  const root = createFolder();
  const path = join(root, VISUAL_SUMMARY);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      total: summaryEntry([5, 20]),
      [join(root, "packages/client-react/src/Seen.tsx")]: summaryEntry([10, 10], [1, 2]),
      [join(root, "packages/client-react/src/Unseen.tsx")]: summaryEntry([5, 10]),
    }),
  );
  utimesSync(path, writtenAt, writtenAt);

  return root;
}

describe("reading what the visual scenarios render", () => {
  it("is undefined when no summary was written", () => {
    expect(readVisualReach(createFolder())).toBeUndefined();
  });

  it("gives files from the project root, without the total, and the date the summary was written", () => {
    const writtenAt = new Date("2026-10-17T09:30:00Z");
    const read = readVisualReach(createVisualProject(writtenAt));
    const reach = read !== undefined && "files" in read ? read : undefined;

    expect(reach?.files.map(({ file }) => file)).toEqual(["packages/client-react/src/Seen.tsx", "packages/client-react/src/Unseen.tsx"]);
    expect(reach?.files[1]?.lines).toEqual({ total: 10, covered: 5, pct: 50 });
    expect(reach?.writtenAt.toISOString()).toBe(writtenAt.toISOString());
  });
});

describe("a visual summary that cannot be read", () => {
  /** A project whose visual summary holds `text`. */
  function createProjectWithSummary(text: string): string {
    const root = createFolder();
    const path = join(root, VISUAL_SUMMARY);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);

    return root;
  }

  it.each([
    ["cut short", '{"total": {'],
    ["not an object", "null"],
  ])("is left out with a note naming the file, when it is %s", (_case, text) => {
    expect(readVisualReach(createProjectWithSummary(text))).toEqual({
      unreadable: `${VISUAL_SUMMARY} could not be read, so what the visual scenarios render is left out. Run pnpm visual:coverage again to write it.`,
    });
  });

  it("keeps the units' report, and puts the note where the section would be", () => {
    const results = [createResult({ measured: [createFileCoverage("packages/a/src/weak.ts", { lines: [1, 10] })] })];
    const text = formatGaps(results, 30, readVisualReach(createProjectWithSummary("{")));

    expect(text).toContain("packages/a/src/weak.ts");
    expect(text).toContain(`${VISUAL_SUMMARY} could not be read`);
    expect(text.indexOf("could not be read")).toBeGreaterThan(text.indexOf("measured."));
  });
});

describe("the gap list with visual reach", () => {
  const results = [createResult({ measured: [createFileCoverage("packages/a/src/weak.ts", { lines: [1, 10] })] })];

  it("prints no section when there is no summary", () => {
    expect(formatGaps(results, 30, undefined)).not.toContain("visual scenario");
  });

  it("lists only the files with lines no scenario renders, with the date, after the table", () => {
    const text = formatGaps(results, 30, readVisualReach(createVisualProject(new Date("2026-10-17T09:30:00Z"))));

    expect(text).toContain("Not rendered by any visual scenario (pnpm visual:coverage, written 2026-10-17 09:30 UTC):");
    expect(text).toContain("packages/client-react/src/Unseen.tsx");
    expect(text).not.toContain("packages/client-react/src/Seen.tsx");
    expect(text.indexOf("Not rendered")).toBeGreaterThan(text.indexOf("measured."));
  });
});
