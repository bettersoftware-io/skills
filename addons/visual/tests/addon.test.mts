import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ALIGN_COMMAND } from "../files/tools/visual/lib/vitestVersions.mts";

// What the add-on promises about who owns what. The host is the add-on's and
// an update replaces it; how a scenario's data becomes app state is the
// project's. A feature once had to edit the host, and every update after
// that was refused.

const ADDON = dirname(dirname(fileURLToPath(import.meta.url)));
const VISUAL = "packages/client-react/tests/visual";
const MANIFEST = JSON.parse(readFileSync(join(ADDON, "addon.json"), "utf8")) as {
  startingFiles: string[];
  examples: string[];
  movedToProject: Record<string, { to: string; note: string }>;
  firstRun?: string;
};

function readShipped(path: string): string {
  return readFileSync(join(ADDON, "files", VISUAL, path), "utf8");
}

/** The fields a scenario may hold, read from the shipped `Scenario`. */
function scenarioFields(): string[] {
  const body = /export interface Scenario(?: extends \w+)? \{([\s\S]*?)\n\}/.exec(readShipped("scenarios.ts"))?.[1] ?? "";

  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1] as string);
}

/** Each shipped scenario's name, level and mount, read from the text of `scenarios.ts`. A scenario with no `level` is a page. */
function shippedScenarios(): { name: string; level: string; mount: string | undefined }[] {
  const body = /export const scenarios: Record<string, Scenario> = \{([\s\S]*?)\n\};/.exec(readShipped("scenarios.ts"))?.[1] ?? "";

  return [...body.matchAll(/^ {2}"?([\w-]+)"?: \{\n([\s\S]*?)^ {2}\},?$/gm)].map((match) => {
    const fields = match[2] as string;

    return {
      name: match[1] as string,
      level: /^ {4}level: "(\w+)",$/m.exec(fields)?.[1] ?? "page",
      mount: /^ {4}mount: "([\w-]+)",$/m.exec(fields)?.[1],
    };
  });
}

/** The keys of the shipped registry, read from the text of `registry.tsx`. */
function registryKeys(): string[] {
  const body = /^const registry\b[^\n]*= \{([\s\S]*?)\n\};/m.exec(readShipped("registry.tsx"))?.[1] ?? "";

  return [...body.matchAll(/^ {2}"([\w-]+)":/gm)].map((match) => match[1] as string);
}

describe("the shipped examples", () => {
  it("cover all three levels, with components the most numerous and at most two pages", () => {
    const count = (level: string): number => shippedScenarios().filter((scenario) => scenario.level === level).length;

    expect(new Set(shippedScenarios().map((scenario) => scenario.level))).toEqual(new Set(["component", "section", "page"]));
    expect(count("component")).toBeGreaterThan(count("section"));
    expect(count("component")).toBeGreaterThan(count("page"));
    expect(count("page")).toBeLessThanOrEqual(2);
  });

  it("mount only what the registry has", () => {
    const mounts = shippedScenarios().flatMap((scenario) => (scenario.mount === undefined ? [] : [scenario.mount]));

    expect(mounts.length).toBeGreaterThan(0);
    expect(registryKeys().length).toBeGreaterThan(0);
    expect(mounts.filter((mount) => !registryKeys().includes(mount))).toEqual([]);
  });
});

describe("who owns what in the visual tier", () => {
  it("gives the project the scenarios and the seeding, and keeps the host", () => {
    expect(MANIFEST.startingFiles).toContain(`${VISUAL}/scenarios.ts`);
    expect(MANIFEST.startingFiles).toContain(`${VISUAL}/seeding.ts`);
    expect(MANIFEST.startingFiles.filter((path) => path.includes("/host/"))).toEqual([]);
  });

  it("sends a project that edited the host to the seeding", () => {
    expect(MANIFEST.movedToProject[`${VISUAL}/host/main.tsx`]?.to).toBe(`${VISUAL}/seeding.ts`);
  });

  it("sends a project that edited the spec to the scenarios, with the note about width and height", () => {
    const handover = MANIFEST.movedToProject[`${VISUAL}/visual.pw.ts`];

    expect(handover?.to).toBe(`${VISUAL}/scenarios.ts`);
    expect(handover?.note).toBe("A width or height a scenario needs now goes on the scenario: `width` and `height` set the viewport of a page.");
  });

  it("launches Chromium without partial raster, and runs one worker in CI", () => {
    const config = readShipped("playwright.config.ts");

    expect(config).toContain('launchOptions: { args: ["--disable-partial-raster"] }');
    expect(config).toContain("workers: process.env.CI === undefined ? undefined : 1,");
    expect(config).toContain("viewport: FRAMING.viewport,");
    expect(config).toContain("...TOLERANCE,");
  });

  it("sets the viewport before it opens the page, annotates the level, and captures as the scenario resolved", () => {
    const spec = readShipped("visual.pw.ts");

    expect(spec).toContain("await page.setViewportSize(picture.viewport);");
    expect(spec.indexOf("setViewportSize(")).toBeLessThan(spec.indexOf("page.goto("));
    expect(spec).toContain('testInfo.annotations.push({ type: "level", description: picture.level });');
    expect(spec).toContain('picture.capture === "root"');
    expect(spec.match(/screenshotTolerance\(picture\.tolerance\)/g)).toHaveLength(2);
    expect(spec).not.toContain("...picture.tolerance");
    expect(spec).toMatch(/threshold: tolerance\.threshold,\s+maxDiffPixels: tolerance\.maxDiffPixels,\s+maxDiffPixelRatio: tolerance\.maxDiffPixelRatio,/);
    expect(spec).toContain("fullPage: false,");
    expect(spec).not.toContain("fullPage: true");
  });

  it("resolves a scenario inside its own test, so a bad one fails only that test", () => {
    const spec = readShipped("visual.pw.ts");

    expect(spec.indexOf("resolvePicture(")).toBeGreaterThan(spec.indexOf("test(name,"));
    expect(spec.indexOf('type: "level"')).toBeGreaterThan(spec.indexOf("resolvePicture("));
    expect(spec.indexOf('type: "level"')).toBeLessThan(spec.indexOf("page.goto("));
  });

  it("reads the fields of a scenario from the shipped file", () => {
    expect(scenarioFields()).toEqual(["stalePrices", "prices", "selected", "row"]);
    expect(readShipped("scenarios.ts")).toMatch(/export interface Scenario extends Picture \{/);
  });

  it.each(["host/main.tsx", "host/render.tsx", "host/ScenarioFrame.tsx", "host/seeded.ts"])("%s names no field of a scenario and builds no harness", (file) => {
    const source = readShipped(file);

    for (const field of scenarioFields()) {
      expect(source, `${file} reads "${field}": that belongs in seeding.ts`).not.toMatch(new RegExp(`\\b${field}\\b`));
    }

    expect(source).not.toContain("appHarness");
    expect(source).not.toContain("/presenters/");
  });

  it("has the host take the application and the deliveries from the seeding, after its clock is installed", () => {
    const render = readShipped("host/render.tsx");

    expect(render).toContain('import { seedScenario } from "../seeding.ts";');
    expect(render.indexOf("FakeTimers.install(")).toBeGreaterThan(-1);
    expect(render.indexOf("seedScenario(")).toBeGreaterThan(render.indexOf("FakeTimers.install("));
    expect(render).toContain("createViewModel(seeded.app)");
    expect(render).toContain("<ScenarioFrame");
    expect(render).toContain("seed={seeded.deliver}");
  });

  it("loads every font face before the first render, and the app's stylesheet in this one place", () => {
    const render = readShipped("host/render.tsx");

    expect(render).toContain('import "#/index.css";');
    expect(render).toContain("await loadEveryFace(document.fonts);");
    expect(render.indexOf("await loadEveryFace(")).toBeLessThan(render.indexOf(".render("));
    expect(readShipped("host/main.tsx")).not.toContain("index.css");
  });

  it("fails a scenario with a mount when the seeding returns no render, before it renders", () => {
    const render = readShipped("host/render.tsx");

    expect(render).toContain("describeMissingRender(");
    expect(render).toMatch(/picture\.mount !== undefined && seeded\.render === undefined/);
    expect(render.indexOf("describeMissingRender(")).toBeLessThan(render.indexOf(".render("));
  });

  it("fails a root capture whose content is wider than the root, after the frame is ready and before it says so", () => {
    const render = readShipped("host/render.tsx");

    expect(render).toContain("describeClippedRoot(");
    expect(render).toMatch(/describeClippedRoot\(\s*name,\s*\{\s*scrollWidth: element\.scrollWidth,\s*clientWidth: element\.clientWidth,?\s*\},\s*picture\.root,?\s*\)/);
    expect(render).toMatch(/if \(clipped !== undefined\) \{\s*throw new PictureError\(clipped\);/);
    expect(render.indexOf("describeClippedRoot(")).toBeGreaterThan(render.indexOf("onReady={resolve}"));
    expect(render).toMatch(/const ready = framed\.then\(\(\) => \{/);
    expect(render).toMatch(/return \{\s*ready,/);
  });

  it("renders what the seeding returns, or App, in the root or bare", () => {
    const render = readShipped("host/render.tsx");
    const frame = readShipped("host/ScenarioFrame.tsx");

    expect(render).toContain("seeded.render?.() ?? <App />");
    expect(frame).toContain("data-testid={ROOT_TESTID}");
    expect(frame).toContain('boxSizing: "content-box"');
  });

  it("surfaces a failed scenario as an uncaught error, and says ready only after it succeeded", () => {
    const main = readShipped("host/main.tsx");

    expect(main).toContain("await showScenario(");
    expect(main).not.toMatch(/catch\s*[({]/);
    expect(main.indexOf("await shown.ready")).toBeGreaterThan(main.indexOf("await showScenario("));
    expect(main.lastIndexOf("READY_ATTRIBUTE")).toBeGreaterThan(main.indexOf("await shown.ready"));
  });

  it("says ready from a second effect, after the seeded state has rendered", () => {
    const frame = readShipped("host/ScenarioFrame.tsx");
    const start = frame.indexOf("seed();");

    expect(frame.slice(start, start + 40)).toContain("setSeeded(true);");
    expect(frame.slice(start, start + 40)).not.toContain("onReady()");
    expect(frame).toMatch(/useEffect\(\(\) => \{\s*if \(seeded\) \{\s*onReady\(\);\s*\}\s*\}, \[seeded, onReady\]\);/);
    expect(frame.match(/onReady\(\)/g)).toHaveLength(1);
  });

  it("names the scenarios when the address has none", () => {
    expect(readShipped("host/main.tsx")).toContain('showScenario(name ?? "", container)');
  });

  it("ships no host stylesheet: a body margin of 0 made pages differ from the app", () => {
    expect(existsSync(join(ADDON, "files", VISUAL, "host", "host.css"))).toBe(false);
    expect(readShipped("host/main.tsx")).not.toContain("host.css");
  });

  it("asks once after installing for the command that puts Vitest's packages on one version", () => {
    // A new project's lockfile holds the starter's vitest; the two packages
    // the add-on brings resolve to a later one, and visual:coverage exits 2.
    expect(MANIFEST.firstRun).toBe(ALIGN_COMMAND);
  });

  it("gives the registry and the goldens as examples, written at first install only", () => {
    expect(MANIFEST.startingFiles).toContain(`${VISUAL}/registry.tsx`);
    expect(MANIFEST.examples).toEqual([`${VISUAL}/goldens/`, `${VISUAL}/registry.tsx`]);
  });

  it("has the seeding render a scenario's mount through the registry, and nothing for a page", () => {
    const seeding = readShipped("seeding.ts");

    expect(seeding).toContain('import { Mount } from "./registry.tsx";');
    expect(seeding).toMatch(/render:\s+scenario\.mount === undefined\s+\? undefined\s+: \(\) => \{\s+return createElement\(Mount, \{ scenario \}\);/);
  });

  it("has the seeding export what the host imports, with the host's types", () => {
    const seeding = readShipped("seeding.ts");

    expect(seeding).toMatch(/export function seedScenario\(scenario: Scenario, clock: HostClock\): Seeded \{/);
    expect(seeding).toContain('import type { HostClock, Seeded } from "./host/seeded.ts";');
  });
});
