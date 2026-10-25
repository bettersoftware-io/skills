import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { findIgnored } from "./git-ignored.mts";

describe("the files of a project that git ignores", () => {
  it("are named with the rule that matches them, a rule once for all its files, in the order the rules are met", () => {
    const project = createRepository();
    write(project, ".gitignore", "# local\n*.log\n.claude/\n");

    const ignored = findIgnored(project, [".claude/commands/b.md", "debug.log", "src/kept.ts", ".claude/commands/a.md"]);

    expect(ignored).toEqual([
      { source: ".gitignore", line: 3, pattern: ".claude/", paths: [".claude/commands/a.md", ".claude/commands/b.md"] },
      { source: ".gitignore", line: 2, pattern: "*.log", paths: ["debug.log"] },
    ]);
  });

  it("leave out a file git tracks: no ignore rule applies to it", () => {
    const project = createRepository();
    write(project, "tools/kept.mts", "// committed before the rule\n");
    git(project, "add", "tools/kept.mts");
    write(project, ".gitignore", "tools/\n");

    expect(findIgnored(project, ["tools/kept.mts", "tools/new.mts"])).toEqual([{ source: ".gitignore", line: 1, pattern: "tools/", paths: ["tools/new.mts"] }]);
  });

  it("name each rule's file from the project's folder, when the project is a folder of a repository", () => {
    const repository = createRepository();
    const project = join(repository, "apps/web");
    write(repository, ".gitignore", ".claude/\n");
    write(project, ".gitignore", "reports/\n");

    expect(findIgnored(project, [".claude/settings.json", "tests/reports/a.json"])).toEqual([
      { source: "../../.gitignore", line: 1, pattern: ".claude/", paths: [".claude/settings.json"] },
      { source: ".gitignore", line: 1, pattern: "reports/", paths: ["tests/reports/a.json"] },
    ]);
  });

  it("name a rule of the person's own ignore file by its full path", () => {
    const repository = createRepository();
    const project = join(repository, "apps/web");
    const own = join(createFolder(), "ignore");
    write(dirname(own), "ignore", "*.md\n");
    git(repository, "config", "core.excludesFile", own);
    mkdirSync(project, { recursive: true });

    expect(findIgnored(project, ["notes.md"])).toEqual([{ source: own, line: 1, pattern: "*.md", paths: ["notes.md"] }]);
  });

  it("are none in a folder that is no repository", () => {
    const folder = createFolder();

    expect(git(folder, "rev-parse").status).not.toBe(0);
    expect(findIgnored(folder, [".claude/settings.json"])).toEqual([]);
  });

  it("are none when git cannot be run", () => {
    const project = createRepository();
    write(project, ".gitignore", ".claude/\n");

    expect(findIgnored(project, [".claude/settings.json"], "no-such-git-here")).toEqual([]);
    expect(findIgnored(project, [".claude/settings.json"])).toHaveLength(1);
  });
});

function createFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "git-ignored-"));

  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  return folder;
}

function createRepository(): string {
  const folder = createFolder();

  git(folder, "init", "--quiet");
  // The person's own ignore file is not this test's: it would add rules of its own.
  git(folder, "config", "core.excludesFile", "/dev/null");

  return folder;
}

function git(folder: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("git", ["-C", folder, ...args], { encoding: "utf8" });
}

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
