import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cachedVitestCommands } from "../kit/gates/lib/package-scripts.mts";

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));

// vitest 5.0.4 and later share one module cache across the workspace and
// delete it whole when the lockfile changed; packages tested side by side then
// fail with ENOTEMPTY. Every run this plugin ships turns the cache off. The
// kit's package-scripts gate holds a project's scripts to it; this holds what
// the plugin itself ships.
describe("every vitest run the plugin ships", () => {
  it("in the starter's packages, turns the module cache off", () => {
    const manifests = listFiles("starter/packages/*/package.json");

    expect(manifests.length).toBeGreaterThan(5);

    for (const path of manifests) {
      const { scripts = {} } = JSON.parse(readFileSync(join(REPOSITORY, path), "utf8")) as { scripts?: Record<string, string> };

      expect(Object.values(scripts).flatMap(cachedVitestCommands), path).toEqual([]);
    }
  });

  it("from a tool of the kit or an add-on, turns the module cache off", () => {
    const starts = listFiles("kit/*.mts", "addons/*/files/tools/*.mts")
      .filter((path) => !path.endsWith(".test.mts"))
      .flatMap((path) =>
        readFileSync(join(REPOSITORY, path), "utf8")
          .split("\n")
          .filter((line) => line.includes("spawnSync(") && /\bvitest\b/.test(line))
          .map((line) => ({ path, line: line.trim() })),
      );

    expect(starts.map(({ path }) => path).sort()).toEqual(["addons/coverage/files/tools/coverage/lib/measure.mts", "addons/visual/files/tools/visual/coverage.mts"]);

    for (const { path, line } of starts) {
      expect(line, path).toContain('"--no-fsModuleCache"');
    }
  });
});

/** The files git knows of that match these pathspecs. */
function listFiles(...pathspecs: string[]): string[] {
  return spawnSync("git", ["ls-files", ...pathspecs], { cwd: REPOSITORY, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
}
