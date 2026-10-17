import { describe, expect, it } from "vitest";

import { type Report, summarise } from "../files/tools/visual/summary.mts";

describe("summarise", () => {
  it("says passed, with the count, when every check is ok", () => {
    const summary = summarise(createReport([{ title: "empty" }, { title: "row-stale" }]));

    expect(summary.exitCode).toBe(0);
    expect(summary.markdown).toContain("Visual goldens: passed");
    expect(summary.markdown).toContain("2 of 2 checks");
  });

  it("names each failed scenario with the first line of its error, colour codes removed", () => {
    const summary = summarise(
      createReport([
        { title: "empty" },
        { title: "row-stale", error: "\u001b[31mError: 120 pixels (ratio 0.01 of all image pixels) are different.\u001b[39m\n\n  Expected: a.png" },
      ]),
    );

    expect(summary.exitCode).toBe(1);
    expect(summary.markdown).toContain("1 of 2 checks failed.");
    expect(summary.markdown).toContain("| `row-stale` | Error: 120 pixels (ratio 0.01 of all image pixels) are different. |");
    expect(summary.markdown).not.toContain("| `empty` |");
    expect(summary.markdown).toContain("Do not regenerate to make a failure go away");
  });

  it("prefers the line that says how many pixels differ over the line that names the assertion", () => {
    const summary = summarise(
      createReport([
        {
          title: "row-stale",
          error: "Error: expect(locator).toHaveScreenshot(expected) failed\n\nLocator: getByTestId('scenario-root')\n  83 pixels (ratio 0.01 of all image pixels) are different.\n\n  Snapshot: row-stale.png",
        },
      ]),
    );

    expect(summary.markdown).toContain("| `row-stale` | 83 pixels (ratio 0.01 of all image pixels) are different. |");
  });

  it("keeps a pipe in an error from breaking the table", () => {
    const summary = summarise(createReport([{ title: "empty", error: "Error: a | b" }]));

    expect(summary.markdown).toContain("| `empty` | Error: a \\| b |");
  });

  it("finds specs in nested suites", () => {
    const report: Report = { suites: [{ suites: [{ specs: [{ title: "deep", ok: false }] }] }] };

    expect(summarise(report).markdown).toContain("| `deep` | no error message |");
  });

  it("counts the pictures of each level from the level annotation of each test", () => {
    const summary = summarise(
      createReport([
        { title: "button", level: "component" },
        { title: "chip", level: "component" },
        { title: "price-list", level: "section" },
        { title: "empty", level: "page" },
      ]),
    );

    expect(summary.levels).toEqual({ component: 2, section: 1, page: 1 });
    expect(summary.markdown).toContain("Pictures: 2 components, 1 sections, 1 pages");
  });

  it("counts a scenario with no annotation as a page", () => {
    const summary = summarise(createReport([{ title: "empty" }, { title: "row-stale" }]));

    expect(summary.levels).toEqual({ component: 0, section: 0, page: 2 });
    expect(summary.markdown).toContain("Pictures: 0 components, 0 sections, 2 pages");
  });

  it("prints the level line for a failed run too, and ignores other annotations", () => {
    const summary = summarise(createReport([{ title: "button", level: "component", error: "Error: x" }, { title: "empty", other: true }]));

    expect(summary.exitCode).toBe(1);
    expect(summary.levels).toEqual({ component: 1, section: 0, page: 1 });
    expect(summary.markdown).toContain("Pictures: 1 components, 0 sections, 1 pages");
  });

  it("does not count the orphan check as a picture", () => {
    const summary = summarise(createReport([{ title: "button", level: "component" }, { title: "empty", level: "page" }, { title: "every golden belongs to a scenario" }]));

    expect(summary.levels).toEqual({ component: 1, section: 0, page: 1 });
    expect(summary.markdown).toContain("Pictures: 1 components, 0 sections, 1 pages");
  });

  it("gives no verdict when there is no results file", () => {
    const summary = summarise(undefined);

    expect(summary.exitCode).toBe(2);
    expect(summary.levels).toEqual({ component: 0, section: 0, page: 0 });
    expect(summary.markdown).toContain("This is not a pass.");
  });

  it("gives no verdict when the run compared nothing, and shows why", () => {
    const summary = summarise({ suites: [], errors: [{ message: "Error: http://127.0.0.1:4319 is already used" }] });

    expect(summary.exitCode).toBe(2);
    expect(summary.markdown).toContain("- Error: http://127.0.0.1:4319 is already used");
  });
});

interface SpecShape {
  title: string;
  /** The error message of a failed spec. Left out: the spec passed. */
  error?: string;
  /** The level annotation of the test. Left out: no annotation. */
  level?: string;
  /** An annotation of another type, which must not be read as a level. */
  other?: boolean;
}

/** The part of Playwright's JSON report the summary reads. */
function createReport(specs: SpecShape[]): Report {
  return {
    suites: [
      {
        specs: specs.map(({ title, error, level, other }) => ({
          title,
          ok: error === undefined,
          tests: [
            {
              annotations: [...(other === true ? [{ type: "slow", description: "component" }] : []), ...(level === undefined ? [] : [{ type: "level", description: level }])],
              results: [error === undefined ? {} : { error: { message: error } }],
            },
          ],
        })),
      },
    ],
  };
}
