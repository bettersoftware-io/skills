#!/usr/bin/env node
// Checks that every mermaid diagram in a set of markdown files renders.
//
//   node scripts/architecture-docs/check-diagrams.mts docs/architecture
//   node scripts/architecture-docs/check-diagrams.mts docs/architecture --keep /tmp/diagrams
//
// A folder gives every `.md` file under it; a file gives itself. Each
// ```mermaid block is drawn by Mermaid's own bundle in a real browser, which
// is what a reader's page does. One browser is started for the whole run, with
// no window. A diagram that does not render is named by the file and the line
// its fence opens on.
//
// `--keep <dir>` leaves the drawn SVG files there, to look at. Rendering says
// a diagram parses. It does not say the diagram is legible, and it says
// nothing about whether what it draws is true.
//
// The tools are fetched on first use (see lib/tools.mts).
//
// Exit 0: every diagram renders, or there was none to render (SKIP).
// Exit 1: a diagram does not render. Exit 2: the check could not run.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { isMainModule } from "../../kit/gates/lib/files.mts";
import { listMarkdown, readDiagrams, shown } from "./lib/blocks.mts";
import { CouldNotRun } from "./lib/outcome.mts";
import { createRenderer, type Render } from "./lib/render.mts";

const GATE = "diagrams";

export interface BrokenDiagram {
  /** The markdown file, from the folder the check was run in. */
  file: string;
  /** The line the diagram's fence opens on. */
  line: number;
  message: string;
}

export interface DiagramCheck {
  gate: string;
  /** Why nothing was judged. A result with this set has not passed. */
  skipped?: string;
  findings: BrokenDiagram[];
  /** Markdown files read. */
  files: number;
  /** Diagrams rendered, or tried. */
  diagrams: number;
}

const UNCLOSED = "The fence that opens here is never closed, so the rest of the file is read as one diagram. Close it with a line of three backticks.";

/**
 * What the renderer said, with the line it names turned into a line of the
 * file. Mermaid counts from the first line of the diagram; a reader opens the
 * file.
 */
export function inFileTerms(answer: string, fenceLine: number): string {
  const named = /\bline (\d+)\b/.exec(answer);

  return named === null ? answer : `${answer} (line ${fenceLine + Number(named[1])} of the file)`;
}

/**
 * Renders every diagram in `paths` and reports the ones that fail.
 *
 * `renderer` is asked for only when there is a diagram to render, so that a
 * set with none costs no download and starts no browser.
 */
export async function checkDiagrams(paths: string[], renderer: () => Render | Promise<Render>, from: string = process.cwd()): Promise<DiagramCheck> {
  const files = listMarkdown(paths);
  const jobs: { file: string; line: number; source: string; name: string }[] = [];
  const findings: BrokenDiagram[] = [];

  for (const path of files) {
    readDiagrams(readFileSync(path, "utf8")).forEach((diagram, index) => {
      const file = shown(from, path);

      if (diagram.closed) {
        jobs.push({ file, line: diagram.line, source: diagram.source, name: `${String(jobs.length + 1).padStart(3, "0")}-${basename(path, ".md")}-${index + 1}` });
      } else {
        findings.push({ file, line: diagram.line, message: UNCLOSED });
      }
    });
  }

  const diagrams = jobs.length + findings.length;

  if (jobs.length > 0) {
    const render = await renderer();

    // One at a time: they share one page of one browser.
    for (const job of jobs) {
      const answer = await render(job.source, job.name);

      if (answer !== undefined) {
        findings.push({ file: job.file, line: job.line, message: `Mermaid does not render it: ${inFileTerms(answer, job.line)}` });
      }
    }
  }

  return {
    gate: GATE,
    ...(diagrams === 0 ? { skipped: files.length === 0 ? "no markdown file" : `no mermaid diagram in ${files.length} markdown file(s)` } : {}),
    findings: findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    files: files.length,
    diagrams,
  };
}

export function formatResult({ gate, skipped, findings, files, diagrams }: DiagramCheck): string {
  if (findings.length > 0) {
    return [
      `FAIL ${gate} (${findings.length})`,
      ...findings.flatMap(({ file, line, message }) => [`  ${file}:${line}`, `    ${message}`]),
      "",
      `${findings.length} of ${diagrams} diagram(s) in ${files} markdown file(s) do not render.`,
    ].join("\n");
  }

  // Nothing to judge is reported as such: it is not a pass.
  return skipped === undefined ? `PASS ${gate} — ${diagrams} diagram(s) in ${files} markdown file(s) render` : `SKIP ${gate} — ${skipped}`;
}

export function parseArguments(argv: string[]): { paths: string[]; keep?: string } {
  const paths: string[] = [];
  let keep: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;

    if (argument === "--keep") {
      keep = argv[index + 1];
      index += 1;

      if (keep === undefined) {
        throw new CouldNotRun("--keep needs a folder");
      }
    } else if (argument.startsWith("--")) {
      throw new CouldNotRun(`unknown argument "${argument}" (use <file or folder>… [--keep <dir>])`);
    } else {
      paths.push(argument);
    }
  }

  if (paths.length === 0) {
    throw new CouldNotRun("name the folder that holds the documents, or the files");
  }

  return { paths, ...(keep === undefined ? {} : { keep }) };
}

if (isMainModule(import.meta.url)) {
  let finish = async (): Promise<void> => {};
  let status = 2;

  try {
    const { paths, keep } = parseArguments(process.argv.slice(2));
    const result = await checkDiagrams(paths, async () => {
      const { render, done } = await createRenderer(keep);

      finish = done;

      return render;
    });

    console.log(formatResult(result));
    status = result.findings.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(error instanceof CouldNotRun ? `check-diagrams could not run: ${error.message}` : error);
  }

  // The browser is closed whatever happened: one left running is one the person has to find.
  await finish().catch(() => {});
  process.exit(status);
}
