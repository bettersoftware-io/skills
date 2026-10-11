// Fixture factories shared by the architecture-docs tests.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const SCRIPTS = import.meta.dirname;

/** A fresh folder holding `files` (path → content). */
export function createFolder(files: Record<string, string> = {}): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "architecture-docs-")));

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), content);
  }

  return folder;
}

/** Makes `folder` a git repository, so that it is found as the repository root. */
export function initGit(folder: string): void {
  execFileSync("git", ["init", "--quiet"], { cwd: folder, stdio: "pipe" });
}

/** A ```mermaid block, as it is written in a document. */
export function mermaid(source: string): string {
  return ["```mermaid", source, "```"].join("\n");
}
