import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseLimit } from "../files/tools/visual/coverage.mts";
import { VITEST_PACKAGES } from "../files/tools/visual/lib/vitestVersions.mts";

// `pnpm visual:coverage` is a report: it ranks what no scenario renders, or
// exits 2 and says why there is no list. Each reason is held here, with a
// stand-in for Vitest so no browser starts.

const ADDON = join(import.meta.dirname, "..");
const CLIENT = "packages/client-react";

describe("parseLimit", () => {
  it("is thirty with no argument", () => {
    expect(parseLimit([])).toBe(30);
  });

  it("reads --limit N and --limit=N", () => {
    expect(parseLimit(["--limit", "10"])).toBe(10);
    expect(parseLimit(["--limit=10"])).toBe(10);
  });

  it.each([["--limit"], ["--limit", "0"], ["--limit", "1.5"], ["--limit", "ten"], ["--limit="], ["--limit=0"], ["--limit", "3", "4"], ["--limit=3", "4"], ["--other", "3"], ["10"]].map((argv) => [argv.join(" "), argv]))(
    "refuses %s, naming the usage",
    (_label, argv) => {
      expect(() => parseLimit(argv as string[])).toThrow('usage: node tools/visual/coverage.mts [--limit <a whole number above 0>], got "');
    },
  );
});

describe("the script", () => {
  it("exits 2 with the usage for an argument it cannot read", () => {
    const run = runIn(createProject({ versions: "same", vitest: "coverage" }), ["--limit", "0"]);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("usage: node tools/visual/coverage.mts");
  });

  it("exits 2 when Vitest's packages are not installed", () => {
    const run = runIn(createProject({ versions: "none", vitest: "none" }));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("visual:coverage: vitest, @vitest/browser-playwright, @vitest/coverage-v8 are not installed");
  });

  it("exits 2 when Vitest's packages are on different versions", () => {
    const run = runIn(createProject({ versions: "mixed", vitest: "coverage" }));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Vitest's packages are on different versions");
  });

  it("exits 2 when there is no vitest to run", () => {
    const run = runIn(createProject({ versions: "same", vitest: "none" }));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("there is no node_modules/.bin/vitest");
  });

  it("exits 2 when a scenario was not rendered, with the run's own output", () => {
    const run = runIn(createProject({ versions: "same", vitest: "fails" }));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("a scenario could not be rendered");
    expect(run.stderr).toContain("the run exited 1, so a scenario was not rendered");
  });

  it("exits 2 when the run passed and wrote no coverage", () => {
    const run = runIn(createProject({ versions: "same", vitest: "passes" }));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain(`wrote no ${CLIENT}/tests/visual/reports/coverage/coverage-final.json`);
  });

  it("ranks the coverage the run wrote, and exits 0", () => {
    const run = runIn(createProject({ versions: "same", vitest: "coverage" }), ["--limit=5"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Not rendered by any visual scenario");
  });
});

const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface Setup {
  /** The versions Vitest's three packages are installed at: none, one for all, or two. */
  versions: "none" | "same" | "mixed";
  /** The stand-in for Vitest: none, one that fails, one that passes and writes nothing, one that writes an empty coverage. */
  vitest: "none" | "fails" | "passes" | "coverage";
}

const STAND_INS: Record<Exclude<Setup["vitest"], "none">, string> = {
  // Its output goes to stdout, as Vitest's does: the script prints it on a failure.
  fails: "echo 'a scenario could not be rendered'\nexit 1\n",
  passes: "exit 0\n",
  coverage: "mkdir -p tests/visual/reports/coverage\necho '{}' > tests/visual/reports/coverage/coverage-final.json\n",
};

/** A project with the add-on's tools and a client package set up as asked. */
function createProject({ versions, vitest }: Setup): string {
  const root = mkdtempSync(join(tmpdir(), "visual-coverage-"));
  scratch.push(root);
  cpSync(join(ADDON, "files/tools"), join(root, "tools"), { recursive: true });

  VITEST_PACKAGES.forEach((name, index) => {
    if (versions !== "none") {
      write(root, `${CLIENT}/node_modules/${name}/package.json`, JSON.stringify({ name, version: versions === "mixed" && index > 0 ? "5.0.4" : "5.0.5" }));
    }
  });

  if (vitest !== "none") {
    const bin = join(root, CLIENT, "node_modules/.bin/vitest");

    write(root, `${CLIENT}/node_modules/.bin/vitest`, `#!/bin/sh\n${STAND_INS[vitest]}`);
    chmodSync(bin, 0o755);
  }

  return root;
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function runIn(root: string, argv: string[] = []): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, ["tools/visual/coverage.mts", ...argv], { cwd: root, encoding: "utf8" });
}
