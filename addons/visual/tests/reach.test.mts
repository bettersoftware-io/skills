import { describe, expect, it } from "vitest";

import { formatReach, type IstanbulFile, rankReach } from "../files/tools/visual/lib/reach.mts";

const ROOT = "/project";

/** A row: four statements, two rendered; a branch whose second arm is never taken; one function never called. */
const ROW: IstanbulFile = {
  path: `${ROOT}/packages/client-react/src/ui/PriceRow.tsx`,
  statementMap: {
    "0": at(3),
    "1": at(5),
    "2": at(12),
    "3": at(40),
  },
  s: { "0": 1, "1": 2, "2": 0, "3": 0 },
  fnMap: {
    "0": { name: "PriceRow", loc: at(3) },
    "1": { name: "onSelect", loc: at(40) },
  },
  f: { "0": 1, "1": 0 },
  branchMap: {
    // Listed out of order and twice at line 40, so the lines must come out sorted and once each.
    "0": { loc: at(40), locations: [at(40), at(41)] },
    "1": { loc: at(12), locations: [at(12), at(12)] },
    "2": { loc: at(40), locations: [at(40), at(42)] },
    "3": { loc: at(5), locations: [at(5), at(6)] },
  },
  b: { "0": [0, 1], "1": [0, 0], "2": [1, 0], "3": [3, 1] },
};

/** A list: four statements, one rendered. Fewer statements left out than the row, so it ranks second. */
const LIST: IstanbulFile = {
  path: `${ROOT}/packages/client-react/src/ui/PriceList.tsx`,
  statementMap: { "0": at(1), "1": at(2), "2": at(3), "3": at(4) },
  s: { "0": 1, "1": 0, "2": 0, "3": 0 },
  fnMap: {},
  f: {},
  branchMap: {},
  b: {},
};

/** Every statement, branch and function reached. */
const APP: IstanbulFile = {
  path: `${ROOT}/packages/client-react/src/ui/App.tsx`,
  statementMap: { "0": at(1), "1": at(2) },
  s: { "0": 1, "1": 4 },
  fnMap: { "0": { name: "App", loc: at(1) } },
  f: { "0": 1 },
  branchMap: { "0": { loc: at(2), locations: [at(2), at(3)] } },
  b: { "0": [1, 2] },
};

function coverageOf(...files: IstanbulFile[]): Record<string, IstanbulFile> {
  return Object.fromEntries(files.map((file) => [file.path, file]));
}

function at(line: number): { start: { line: number; column: number }; end: { line: number; column: number } } {
  return { start: { line, column: 0 }, end: { line, column: 10 } };
}

describe("rankReach", () => {
  it("puts the file with the most statements no scenario renders first", () => {
    const gaps = rankReach(coverageOf(ROW, LIST), ROOT);

    expect(gaps.map(({ file }) => file)).toEqual(["packages/client-react/src/ui/PriceList.tsx", "packages/client-react/src/ui/PriceRow.tsx"]);
    expect(gaps[0]).toMatchObject({ uncoveredStatements: 3, statementsPct: 25 });
    expect(gaps[1]).toMatchObject({ uncoveredStatements: 2, statementsPct: 50 });
  });

  it("breaks a tie on statements by the lower percentage, then by path", () => {
    const smaller: IstanbulFile = { ...LIST, path: `${ROOT}/packages/client-react/src/ui/Small.tsx`, statementMap: { "0": at(1), "1": at(2), "2": at(3) }, s: { "0": 0, "1": 0, "2": 0 } };
    const twin: IstanbulFile = { ...smaller, path: `${ROOT}/packages/client-react/src/ui/Alpha.tsx` };

    const gaps = rankReach(coverageOf(LIST, smaller, twin), ROOT);

    expect(gaps.map(({ file }) => file)).toEqual([
      "packages/client-react/src/ui/Alpha.tsx",
      "packages/client-react/src/ui/Small.tsx",
      "packages/client-react/src/ui/PriceList.tsx",
    ]);
  });

  it("names each line with a branch never taken once, in order", () => {
    const [row] = rankReach(coverageOf(ROW), ROOT);

    expect(row?.branchLines).toEqual([12, 40, 42]);
  });

  it("names the functions never called", () => {
    const [row] = rankReach(coverageOf(ROW), ROOT);

    expect(row?.functions).toEqual(["onSelect"]);
  });

  it("leaves out a file whose every statement, branch and function is reached", () => {
    const gaps = rankReach(coverageOf(APP, LIST), ROOT);

    expect(gaps.map(({ file }) => file)).toEqual(["packages/client-react/src/ui/PriceList.tsx"]);
  });

  it("keeps a file whose statements all run but has a branch never taken", () => {
    const branchy: IstanbulFile = { ...APP, b: { "0": [1, 0] } };

    const gaps = rankReach(coverageOf(branchy), ROOT);

    expect(gaps).toEqual([{ file: "packages/client-react/src/ui/App.tsx", uncoveredStatements: 0, statementsPct: 100, branchLines: [3], functions: [] }]);
  });
});

describe("formatReach", () => {
  it("gives one line per file, and under it the branches and functions never reached", () => {
    const text = formatReach(rankReach(coverageOf(ROW, LIST, APP), ROOT), 30);

    expect(text).toMatch(/^ +3 +25\.0% +packages\/client-react\/src\/ui\/PriceList\.tsx$/m);
    expect(text).toMatch(/^ +2 +50\.0% +packages\/client-react\/src\/ui\/PriceRow\.tsx\n +branches never taken at lines 12, 40, 42\n +functions never called: onSelect$/m);
    expect(text).not.toContain("App.tsx");
    expect(text.indexOf("PriceList.tsx")).toBeLessThan(text.indexOf("PriceRow.tsx"));
  });

  it("stops at the limit and says how many more there are", () => {
    const text = formatReach(rankReach(coverageOf(ROW, LIST), ROOT), 1);

    expect(text).toContain("PriceList.tsx");
    expect(text).not.toContain("PriceRow.tsx");
    expect(text).toContain("1 more (raise --limit)");
  });

  it("says when every file is rendered in full", () => {
    expect(formatReach(rankReach(coverageOf(APP), ROOT), 30)).toContain("Every statement, branch and function in the UI is rendered by some scenario.");
  });
});
