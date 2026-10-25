import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BLACK, createPng, WHITE } from "./support/createPng.mts";
import { grepFor, parseArguments, UsageError } from "../files/tools/visual/lib/arguments.mts";

describe("the jitter command's arguments", () => {
  it("captures three times when given nothing", () => {
    expect(parseArguments([])).toEqual({ mode: "capture", runs: 3, scenarios: [] });
  });

  it("captures as many times as --runs says", () => {
    expect(parseArguments(["--runs", "5"])).toEqual({ mode: "capture", runs: 5, scenarios: [] });
  });

  it("refuses a single capture: one capture has nothing to differ from", () => {
    expect(() => parseArguments(["--runs", "1"])).toThrow(UsageError);
    expect(() => parseArguments(["--runs", "many"])).toThrow(UsageError);
  });

  it("compares the folders it is given, as absolute paths", () => {
    expect(parseArguments(["one", "/tmp/two"])).toEqual({ mode: "compare", directories: [resolve("one"), "/tmp/two"] });
  });

  it("refuses a single folder", () => {
    expect(() => parseArguments(["one"])).toThrow(/at least two/);
  });

  it("refuses --runs together with folders", () => {
    expect(() => parseArguments(["--runs", "3", "one", "two"])).toThrow(/not both/);
  });

  it("refuses an argument it does not know", () => {
    expect(() => parseArguments(["--threshold", "0"])).toThrow(/unknown argument "--threshold"/);
  });

  it("captures only the scenarios named, however many times --scenario is given", () => {
    expect(parseArguments(["--scenario", "a", "--scenario", "b"])).toEqual({ mode: "capture", runs: 3, scenarios: ["a", "b"] });
    expect(parseArguments(["--runs", "2", "--scenario", "a"])).toEqual({ mode: "capture", runs: 2, scenarios: ["a"] });
  });

  it("refuses --scenario with no name, and with folders to compare", () => {
    expect(() => parseArguments(["--scenario"])).toThrow(UsageError);
    expect(() => parseArguments(["--scenario", "--runs", "3"])).toThrow(UsageError);
    expect(() => parseArguments(["--scenario", "a", "one", "two"])).toThrow(/captured already/);
  });
});

describe("the --grep for chosen scenarios", () => {
  const matches = (scenarios: string[], title: string): boolean => new RegExp(grepFor(scenarios), "i").test(title);

  it("selects the scenario's own test and not one whose name only contains it", () => {
    expect(matches(["price-row-up"], "visual.pw.ts price-row-up")).toBe(true);
    expect(matches(["price-row-up"], "visual.pw.ts price-row-up-wide")).toBe(false);
    expect(matches(["price-row-up"], "visual.pw.ts wide-price-row-up")).toBe(false);
  });

  it("selects any of several", () => {
    expect(matches(["a", "b"], "chromium visual.pw.ts b")).toBe(true);
    expect(matches(["a", "b"], "chromium visual.pw.ts c")).toBe(false);
  });

  it("takes regex characters literally", () => {
    expect(matches(["a.b"], "visual.pw.ts axb")).toBe(false);
    expect(matches(["a.b"], "visual.pw.ts a.b")).toBe(true);
    expect(matches(["a+b"], "visual.pw.ts a+b")).toBe(true);
  });
});

describe("pnpm visual:jitter on folders already captured", () => {
  const scratch: string[] = [];

  afterEach(() => {
    for (const directory of scratch.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  /** Two captures of `name`, the second with `pixels` white pixels where the first is black. */
  function capture(name: string, pixels: number): string[] {
    const folders = [BLACK, WHITE].map((colour, index) => {
      const folder = mkdtempSync(join(tmpdir(), "visual-jitter-"));

      scratch.push(folder);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, `${name}.png`), createPng(20, 20, (x, y) => (index === 1 && y * 20 + x < pixels ? colour : BLACK)));

      return folder;
    });

    return folders;
  }

  function run(folders: string[]): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "../files/tools/visual/jitter.mts"), ...folders], { encoding: "utf8" });

    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it("judges an image no scenario owns by the global tolerance, and says so", () => {
    const within = run(capture("zz-orphan", 5));

    expect(within.status).toBe(0);
    expect(within.output).toContain("No scenario owns zz-orphan.png");

    const over = run(capture("zz-orphan", 30));

    expect(over.status).toBe(1);
    expect(over.output).toContain("FAIL: zz-orphan.png");
  });

  it("counts an image named after a property every object has as one no scenario owns", () => {
    const { status, output } = run(capture("toString", 5));

    expect(status).toBe(0);
    expect(output).toContain("No scenario owns toString.png");
  });

  it("refuses to capture a scenario named after a property every object has", () => {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "../files/tools/visual/jitter.mts"), "--scenario", "constructor"], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain('No measurement: no scenario named "constructor" in scenarios.ts.');
  });

  it("judges a scenario's image by the project's tolerance.ts", () => {
    expect(run(capture("price-row-up", 5)).status).toBe(0);
    expect(run(capture("price-row-up", 30)).status).toBe(1);
  });
});

describe("pnpm visual:jitter with a scenarios.ts Node cannot load", () => {
  const scratch: string[] = [];

  afterEach(() => {
    for (const directory of scratch.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  /** A copy of the add-on's files laid out as a project, with this `scenarios.ts`. Returns jitter's exit and output on two empty folders. */
  function runWith(scenarios: string): { status: number | null; output: string } {
    const project = mkdtempSync(join(tmpdir(), "visual-jitter-project-"));

    scratch.push(project);
    cpSync(resolve(import.meta.dirname, "../files"), project, { recursive: true, filter: (source) => !source.includes("goldens") });
    writeFileSync(join(project, "packages/client-react/tests/visual/scenarios.ts"), scenarios);

    const result = spawnSync(process.execPath, [join(project, "tools/visual/jitter.mts"), join(project, "a"), join(project, "b")], { encoding: "utf8" });

    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it("exits 2 and says what Node needs, for an import without its extension", () => {
    const { status, output } = runWith('import { prices } from "./prices";\n\nexport const scenarios = { a: { prices } };\n');

    expect(status).toBe(2);
    expect(output).toContain("No measurement: Node could not load the project's visual files");
    expect(output).toContain("imports must be type-only or Node-loadable, name their file with `.ts`, and use only erasable syntax");
  });

  it("exits 2 for syntax Node cannot erase", () => {
    const { status, output } = runWith("enum Side { Up }\n\nexport const scenarios = { a: { prices: [], side: Side.Up } };\n");

    expect(status).toBe(2);
    expect(output).toContain("No measurement: Node could not load the project's visual files");
  });
});

describe("pnpm visual:jitter with a scenario that contradicts itself", () => {
  const scratch: string[] = [];
  const SCENARIOS = "export const scenarios = { good: { prices: [] }, bad: { prices: [], maxDiffPixels: 2 } };\n";

  afterEach(() => {
    for (const directory of scratch.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  /** A copy of the add-on's files laid out as a project, with SCENARIOS and two identical captures of each image named. Returns jitter's exit and output. */
  function runWith(images: string[], argv: (project: string) => string[]): { status: number | null; output: string } {
    const project = mkdtempSync(join(tmpdir(), "visual-jitter-project-"));

    scratch.push(project);
    cpSync(resolve(import.meta.dirname, "../files"), project, { recursive: true, filter: (source) => !source.includes("goldens") });
    writeFileSync(join(project, "packages/client-react/tests/visual/scenarios.ts"), SCENARIOS);

    for (const folder of ["a", "b"]) {
      mkdirSync(join(project, folder), { recursive: true });

      for (const image of images) {
        writeFileSync(join(project, folder, image), createPng(4, 4, () => BLACK));
      }
    }

    const result = spawnSync(process.execPath, [join(project, "tools/visual/jitter.mts"), ...argv(project)], { encoding: "utf8" });

    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  const folders = (project: string): string[] => [join(project, "a"), join(project, "b")];

  it("exits 2 naming it, when its images are compared", () => {
    const { status, output } = runWith(["good.png", "bad.png"], folders);

    expect(status).toBe(2);
    expect(output).toContain('No measurement: Scenario "bad": `maxDiffPixels` is 2');
  });

  it("does not stop a comparison of the other scenarios' images", () => {
    const { status, output } = runWith(["good.png"], folders);

    expect(status).toBe(0);
    expect(output).not.toContain('Scenario "bad"');
  });

  it("exits 2 naming it, when it is chosen to capture, before any capture", () => {
    const { status, output } = runWith([], () => ["--scenario", "bad"]);

    expect(status).toBe(2);
    expect(output).toContain('No measurement: Scenario "bad"');
    expect(output).not.toContain("Run pnpm install first");
  });

  it("does not stop a capture of the other scenarios", () => {
    // The copy has no Playwright, so the capture stops there: past the scenarios.
    const { status, output } = runWith([], () => ["--scenario", "good"]);

    expect(status).toBe(2);
    expect(output).not.toContain('Scenario "bad"');
    expect(output).toContain("Run pnpm install first");
  });

  it("exits 2 naming it, when every scenario is to be captured", () => {
    const { status, output } = runWith([], () => []);

    expect(status).toBe(2);
    expect(output).toContain('No measurement: Scenario "bad"');
  });
});

describe("the stand-in for the app's types (tests/support/appTypes.d.ts)", () => {
  const STARTER = resolve(import.meta.dirname, "../../../starter/packages");

  /** The fields of `interface <name>` in a text, as "field: type", with `Movement` written out as the starter defines it. */
  function fieldsOf(text: string, name: string, movement: string): string[] {
    const body = new RegExp(`interface ${name}(?: extends \\w+)? \\{([^}]*)\\}`).exec(text)?.[1] ?? "";

    return [...body.matchAll(/^\s*(\w+\??): ([^;]+);$/gm)].map(([, field, type]) => `${field}: ${type === "Movement" ? movement : type}`);
  }

  it("declares Price and PriceRow with the starter's fields", () => {
    const stub = readFileSync(resolve(import.meta.dirname, "support/appTypes.d.ts"), "utf8");
    const price = readFileSync(join(STARTER, "domain/src/entities/price.ts"), "utf8");
    const presenter = readFileSync(join(STARTER, "client-core/src/presenters/pricesPresenter.ts"), "utf8");
    const movement = /export type Movement = ([^;]+);/.exec(price)?.[1] ?? "";

    expect(movement).not.toBe("");
    expect(fieldsOf(stub, "Price", movement)).toEqual(fieldsOf(price, "Price", movement));
    expect(fieldsOf(stub, "PriceRow", movement)).toEqual(fieldsOf(presenter, "PriceRow", movement));
    expect(fieldsOf(stub, "Price", movement)).toEqual(["symbol: string", "mid: number"]);
    expect(fieldsOf(stub, "PriceRow", movement)).toContain('movement: "up" | "down" | "flat"');
  });
});
