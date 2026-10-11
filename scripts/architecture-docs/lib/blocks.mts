// The mermaid diagrams written in a markdown file, each with the line it
// starts on, and the markdown files of a document set. Node built-ins only.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { CouldNotRun } from "./outcome.mts";

export interface Diagram {
  /** The line of the opening fence, 1-based: where a reader goes to fix it. */
  line: number;
  /** What is between the fences. */
  source: string;
  /** False when the file ends before the fence does. */
  closed: boolean;
}

/**
 * Every ```mermaid block of the text, in order. A block shown inside another
 * fenced block (a document that explains the syntax) is an example, not a
 * diagram, and is left out.
 */
export function readDiagrams(text: string): Diagram[] {
  const diagrams: Diagram[] = [];
  const lines = text.split(/\r?\n/);
  let fence: { mark: string; length: number; diagram?: { line: number; from: number } } | undefined;

  lines.forEach((line, index) => {
    if (fence === undefined) {
      // Backticks later on the line make it a code span, not a fence.
      const opening = /^ {0,3}(?:(`{3,})([^`]*)$|(~{3,})(.*)$)/.exec(line);

      if (opening !== null) {
        const marks = (opening[1] ?? opening[3]) as string;
        const language = (opening[2] ?? opening[4] ?? "").trim().split(/\s+/)[0] ?? "";

        fence = {
          mark: marks[0] as string,
          length: marks.length,
          ...(language.toLowerCase() === "mermaid" ? { diagram: { line: index + 1, from: index + 1 } } : {}),
        };
      }

      return;
    }

    const closing = line.trim();

    if (closing.length >= fence.length && closing === fence.mark.repeat(closing.length)) {
      if (fence.diagram !== undefined) {
        diagrams.push({ line: fence.diagram.line, source: lines.slice(fence.diagram.from, index).join("\n"), closed: true });
      }

      fence = undefined;
    }
  });

  if (fence?.diagram !== undefined) {
    diagrams.push({ line: fence.diagram.line, source: lines.slice(fence.diagram.from).join("\n"), closed: false });
  }

  return diagrams;
}

// Never part of a document set. A closed list on purpose: skipping more would
// let a chapter go unchecked without a word.
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);

/**
 * The markdown files named by `paths`, as absolute paths in a stable order. A
 * folder gives every `.md` file under it; a file gives itself. Throws on a
 * path that is not there, so that a mistyped folder is never "nothing to check".
 */
export function listMarkdown(paths: string[]): string[] {
  const found = new Set<string>();

  function walk(folder: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(join(folder, entry.name));
        }
      } else if (/\.md$/i.test(entry.name)) {
        found.add(join(folder, entry.name));
      }
    }
  }

  for (const path of paths) {
    const absolute = resolve(path);

    if (!existsSync(absolute)) {
      throw new CouldNotRun(`${path} does not exist`);
    }

    if (statSync(absolute).isDirectory()) {
      walk(absolute);
    } else {
      found.add(absolute);
    }
  }

  return [...found].sort();
}

/** `path` as written from `root`, with forward slashes: how a finding names a file. */
export function shown(root: string, path: string): string {
  const inside = relative(root, path);

  return (inside === "" || inside.startsWith("..") ? path : inside).split(sep).join("/");
}
