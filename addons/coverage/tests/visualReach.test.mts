import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { formatGaps, formatGapsJson } from "../files/tools/coverage/gaps.mts";
import { readVisualReach, VISUAL_SUMMARY, type VisualReach } from "../files/tools/coverage/lib/visualReach.mts";
import { createFileCoverage, createFolder, createResult } from "./support.mts";

function entry(covered: number, total: number) {
  return { total, covered, skipped: 0, pct: total === 0 ? 100 : (covered / total) * 100 };
}

function summaryEntry(lines: [number, number], branches: [number, number] = [0, 0]) {
  return { lines: entry(...lines), statements: entry(...lines), functions: entry(...lines), branches: entry(...branches) };
}

/** A project holding a visual summary for two files, written at `writtenAt`, and any more files given by their path from the root. */
function createVisualProject(writtenAt: Date, more: Record<string, ReturnType<typeof summaryEntry>> = {}): string {
  const root = createFolder();

  writeSummary(root, {
    total: summaryEntry([5, 20]),
    [join(root, "packages/client-react/src/Seen.tsx")]: summaryEntry([10, 10], [1, 2]),
    [join(root, "packages/client-react/src/Unseen.tsx")]: summaryEntry([5, 10]),
    ...Object.fromEntries(Object.entries(more).map(([path, value]) => [join(root, path), value])),
  });
  utimesSync(join(root, VISUAL_SUMMARY), writtenAt, writtenAt);

  return root;
}

function writeSummary(root: string, summary: Record<string, unknown>): void {
  const path = join(root, VISUAL_SUMMARY);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(summary));
}

/** What `readVisualReach` read, when it could. */
function readable(root: string): VisualReach {
  const read = readVisualReach(root);

  if (read === undefined || "unreadable" in read) {
    throw new Error("expected a readable visual summary");
  }

  return read;
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

  it("reads a folder whose name starts with two dots as inside the project, and keeps a path outside it as written", () => {
    const root = createFolder();
    const outside = join(dirname(root), "elsewhere/src/Other.tsx");

    writeSummary(root, { [join(root, "..cache/src/Kept.tsx")]: summaryEntry([1, 1]), [outside]: summaryEntry([1, 1]) });

    expect(readable(root).files.map(({ file }) => file)).toEqual([outside, "..cache/src/Kept.tsx"].sort((a, b) => a.localeCompare(b)));
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

  it("stops the visual list at the limit and says how many more there are", () => {
    const root = createVisualProject(new Date("2026-10-17T09:30:00Z"), { "packages/client-react/src/Hidden.tsx": summaryEntry([0, 10]) });
    const visual = formatGaps(results, 1, readVisualReach(root)).split("Not rendered by any visual scenario")[1] ?? "";

    expect(visual).toContain("packages/client-react/src/Hidden.tsx");
    expect(visual).not.toContain("packages/client-react/src/Unseen.tsx");
    expect(visual).toContain("… 1 more (raise --limit)");
  });

  it.each([
    ["only the total", { total: summaryEntry([0, 0]) }],
    ["no entry at all", {}],
  ])("says nothing was measured when the summary holds %s, not that every file is rendered", (_case, summary) => {
    const root = createFolder();

    writeSummary(root, summary);
    const text = formatGaps(results, 30, readVisualReach(root));

    expect(text).toContain("  nothing was measured: the summary names no file. That is not a clean result.");
    expect(text).not.toContain("every file has its lines rendered");
  });

  it("says every file has its lines rendered when the summary names files and none lacks a line", () => {
    const root = createFolder();

    writeSummary(root, { [join(root, "packages/client-react/src/Seen.tsx")]: summaryEntry([10, 10]) });

    expect(formatGaps(results, 30, readVisualReach(root))).toContain("  every file has its lines rendered.");
  });
});

describe("the gap list as JSON", () => {
  const results = [createResult({ measured: [createFileCoverage("packages/a/src/weak.ts", { lines: [1, 10] })] })];

  it("has no visualReach when there is no summary", () => {
    expect(JSON.parse(formatGapsJson(results, 30, undefined))).not.toHaveProperty("visualReach");
  });

  it("gives the visual gaps up to the limit, with the date the summary was written", () => {
    const root = createVisualProject(new Date("2026-10-17T09:30:00Z"), { "packages/client-react/src/Hidden.tsx": summaryEntry([0, 10]) });
    const json = JSON.parse(formatGapsJson(results, 1, readVisualReach(root))) as { gaps: { file: string }[]; visualReach: { writtenAt: string; gaps: { file: string }[] } };

    expect(json.gaps.map(({ file }) => file)).toEqual(["packages/a/src/weak.ts"]);
    expect(json.visualReach.writtenAt).toBe("2026-10-17T09:30:00.000Z");
    expect(json.visualReach.gaps.map(({ file }) => file)).toEqual(["packages/client-react/src/Hidden.tsx"]);
  });

  it("passes on the note of a summary that could not be read", () => {
    const root = createFolder();

    writeSummary(root, {});
    writeFileSync(join(root, VISUAL_SUMMARY), "{");

    expect(JSON.parse(formatGapsJson(results, 30, readVisualReach(root))).visualReach).toEqual({ unreadable: expect.stringContaining("could not be read") });
  });
});
