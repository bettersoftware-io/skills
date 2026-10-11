// The mermaid diagrams written in a markdown file, each with the line it
// starts on, and the markdown files of a document set. Node built-ins only.

import { existsSync, lstatSync, readdirSync } from "node:fs";
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
 *
 * A symbolic link is never followed. These scripts read repositories that are
 * not the reader's own, and what they read is printed, rendered or copied
 * into a site: a link named `notes.md` that points at a private file would
 * carry it there. A link found under a folder is left out and added to
 * `links`, so the caller can say it was not read. A link named on the command
 * line is refused: the person asked for it, and should be told why not.
 */
export function listMarkdown(paths: string[], links: string[] = []): string[] {
  const found = new Set<string>();

  function walk(folder: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);

      if (entry.isSymbolicLink()) {
        if (/\.md$/i.test(entry.name)) {
          links.push(path);
        }
      } else if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path);
        }
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        found.add(path);
      }
    }
  }

  for (const path of paths) {
    const absolute = resolve(path);

    if (!existsSync(absolute) && !isLink(absolute)) {
      throw new CouldNotRun(`${path} does not exist`);
    }

    if (isLink(absolute)) {
      throw new CouldNotRun(`${path} is a symbolic link, and a link is never followed. Name the file or folder it points at.`);
    }

    if (lstatSync(absolute).isDirectory()) {
      walk(absolute);
    } else {
      found.add(absolute);
    }
  }

  return [...found].sort();
}

/** True when the path itself is a symbolic link, whether or not it leads anywhere. */
export function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** One line that says which links were left unread, or nothing when there were none. */
export function notRead(root: string, links: string[]): string {
  return links.length === 0 ? "" : `\n  not read, because a symbolic link is never followed: ${links.map((link) => shown(root, link)).join(", ")}`;
}

/** `path` as written from `root`, with forward slashes: how a finding names a file. */
export function shown(root: string, path: string): string {
  const inside = relative(root, path);

  return (inside === "" || inside.startsWith("..") ? path : inside).split(sep).join("/");
}
