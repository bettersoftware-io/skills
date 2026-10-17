import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// What the add-on promises about who owns what. The host is the add-on's and
// an update replaces it; how a scenario's data becomes app state is the
// project's. A feature once had to edit the host, and every update after
// that was refused.

const ADDON = dirname(dirname(fileURLToPath(import.meta.url)));
const VISUAL = "packages/client-react/tests/visual";
const MANIFEST = JSON.parse(readFileSync(join(ADDON, "addon.json"), "utf8")) as {
  startingFiles: string[];
  movedToProject: Record<string, { to: string; note: string }>;
};

function readShipped(path: string): string {
  return readFileSync(join(ADDON, "files", VISUAL, path), "utf8");
}

/** The fields a scenario may hold, read from the shipped `Scenario`. */
function scenarioFields(): string[] {
  const body = /export interface Scenario(?: extends \w+)? \{([\s\S]*?)\n\}/.exec(readShipped("scenarios.ts"))?.[1] ?? "";

  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1] as string);
}

describe("who owns what in the visual tier", () => {
  it("gives the project the scenarios and the seeding, and keeps the host", () => {
    expect(MANIFEST.startingFiles).toContain(`${VISUAL}/scenarios.ts`);
    expect(MANIFEST.startingFiles).toContain(`${VISUAL}/seeding.ts`);
    expect(MANIFEST.startingFiles.filter((path) => path.includes("/host/"))).toEqual([]);
  });

  it("sends a project that edited the host to the seeding", () => {
    expect(Object.keys(MANIFEST.movedToProject)).toEqual([`${VISUAL}/host/main.tsx`]);
    expect(MANIFEST.movedToProject[`${VISUAL}/host/main.tsx`]?.to).toBe(`${VISUAL}/seeding.ts`);
  });

  it("reads the fields of a scenario from the shipped file", () => {
    expect(scenarioFields()).toEqual(["stalePrices", "prices", "selected"]);
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

  it("has the seeding export what the host imports, with the host's types", () => {
    const seeding = readShipped("seeding.ts");

    expect(seeding).toMatch(/export function seedScenario\(scenario: Scenario, clock: HostClock\): Seeded \{/);
    expect(seeding).toContain('import type { HostClock, Seeded } from "./host/seeded.ts";');
  });
});
