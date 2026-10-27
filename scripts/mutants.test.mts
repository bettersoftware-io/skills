import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Specs whose files are a created project's, not this repository's: they are run there, as their README says. A
 * project's application comes from the starter, so their find text is checked in `starter/`.
 */
const RUN_IN_A_PROJECT = ["addons/e2e/tests/app-mutants.json", "addons/e2e/tests/app-mutants-left-to-other-tests.json"];

interface Mutant {
  name: string;
  file: string;
  find: string;
}

// mutation-check.mts refuses a mutant whose `find` is not in its file exactly
// once, and runs the rest: a mutant that went stale when its code changed
// is skipped by every run after, and nothing else says so.
describe("every mutant in the repository", () => {
  const specs = listSpecs();

  it("is found: there are specs, and the ones run in a project are among them", () => {
    expect(specs.length).toBeGreaterThan(10);
    expect(RUN_IN_A_PROJECT.every((spec) => specs.includes(spec))).toBe(true);
  });

  for (const spec of specs) {
    const root = RUN_IN_A_PROJECT.includes(spec) ? join(REPOSITORY, "starter") : REPOSITORY;

    it(`still applies, in ${spec}: its find text is in its file exactly once`, () => {
      const stale = (JSON.parse(readFileSync(join(REPOSITORY, spec), "utf8")) as Mutant[]).flatMap(({ name, file, find }) => {
        const path = join(root, file);
        const count = existsSync(path) ? readFileSync(path, "utf8").split(find).length - 1 : -1;

        return count === 1 ? [] : [`${name}: ${count === -1 ? `${file} is not there` : `found ${count} times in ${file}`}`];
      });

      expect(stale).toEqual([]);
    });
  }
});

/** Every mutant spec git knows of. */
function listSpecs(): string[] {
  return spawnSync("git", ["ls-files", "*mutants*.json"], { cwd: REPOSITORY, encoding: "utf8" })
    .stdout.split("\n")
    .filter((path) => path.endsWith(".json"));
}
