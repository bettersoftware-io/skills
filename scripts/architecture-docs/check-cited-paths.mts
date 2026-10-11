#!/usr/bin/env node
// Checks that every repository path a document cites in backticks is there.
//
//   node scripts/architecture-docs/check-cited-paths.mts docs/architecture
//   node scripts/architecture-docs/check-cited-paths.mts docs/architecture --root . --except docs/old-plan.md
//
// A document about a codebase names files: `server/web.ts`,
// `client/features/chat/`. A name that was typed from memory, or that a
// refactor has since moved, sends the reader nowhere, and no link checker
// sees it because it is not a link.
//
// What counts as a cited path: a code span with no space in it, that holds a
// `/`, and whose first part is a file or folder at the top of the repository.
// So `server/web.ts` is checked in a repository that has `server/`, and
// `GET /api/users`, `.env`, `a/b` and `packages/<name>/src` are not. A
// trailing `:12` or `:12-40` (a line citation) is ignored.
//
// `--root <dir>` is the repository; without it, the git checkout the first
// document is in. `--except <path>` names a path the documents cite on
// purpose although it is missing ("the comment points to docs/x.md, which
// does not exist"). It may be given more than once.
//
// Exit 0: every cited path exists, or none was cited (SKIP).
// Exit 1: a cited path is missing. Exit 2: the check could not run.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { proseLines } from "../../addons/repo-hygiene/files/tools/repo-hygiene/lib/markdown.mts";
import { isMainModule } from "../../kit/gates/lib/files.mts";
import { listMarkdown, notRead, shown } from "./lib/blocks.mts";
import { CouldNotRun } from "./lib/outcome.mts";

const GATE = "cited-paths";

export interface MissingPath {
  /** The markdown file the path is cited in, from the repository root. */
  file: string;
  line: number;
  message: string;
}

export interface CitedPathCheck {
  gate: string;
  /** Why nothing was judged. A result with this set has not passed. */
  skipped?: string;
  findings: MissingPath[];
  /** Markdown files read. */
  files: number;
  /** Cited paths checked. One path cited twice counts twice. */
  cited: number;
  /** The `--except` paths that were cited: missing, and said to be. */
  excepted: string[];
  /** Markdown files that are symbolic links, from the repository root. They were not read. */
  links: string[];
}

/** A code span: opened by N backticks, closed by the next run of exactly N. */
const CODE_SPAN = /(?<!`)(`+)(?!`)(.*?)(?<!`)\1(?!`)/g;

/** A placeholder, a glob, a command or prose: not one path. */
const NOT_A_PATH = /[\s*<>{}|$=,;"'…]|\.\.\./;

/**
 * The repository paths cited on one line of prose. `topLevel` is the names at
 * the top of the repository: a span is a path only when it starts with one.
 */
export function citedPaths(line: string, topLevel: Set<string>): string[] {
  const paths: string[] = [];

  for (const match of line.matchAll(CODE_SPAN)) {
    const span = (match[2] as string).trim();

    if (span === "" || NOT_A_PATH.test(span)) {
      continue;
    }

    // `server/web.ts:108` and `server/web.ts:108-120` cite a line; `server/web.ts.` ends a sentence.
    const path = span
      .replace(/:\d+(?:-\d+)?$/, "")
      .replace(/[.:]+$/, "")
      .replace(/^\.\//, "");
    const first = path.split("/")[0] as string;

    if (path.includes("/") && topLevel.has(first)) {
      paths.push(path);
    }
  }

  return paths;
}

export function checkCitedPaths(paths: string[], { root, except = [] }: { root?: string; except?: string[] } = {}): CitedPathCheck {
  const links: string[] = [];
  const files = listMarkdown(paths, links);
  const repository = resolve(root ?? repositoryOf(files[0] ?? resolve(paths[0] ?? ".")));

  if (!existsSync(repository) || !statSync(repository).isDirectory()) {
    throw new CouldNotRun(`${repository} is not a folder`);
  }

  const topLevel = new Set(readdirSync(repository));
  const allowed = new Set(except.map((path) => path.replace(/\/+$/, "")));
  const findings: MissingPath[] = [];
  const excepted = new Set<string>();
  let cited = 0;

  for (const file of files) {
    proseLines(readFileSync(file, "utf8")).forEach((line, index) => {
      for (const path of citedPaths(line, topLevel)) {
        cited += 1;

        if (existsSync(join(repository, path))) {
          continue;
        }

        if (allowed.has(path.replace(/\/+$/, ""))) {
          excepted.add(path);
        } else {
          findings.push({
            file: shown(repository, file),
            line: index + 1,
            message: `\`${path}\` is cited, and the repository has no such file or folder. Correct the path. If the document is saying that it is missing, run again with \`--except ${path}\`.`,
          });
        }
      }
    });
  }

  return {
    gate: GATE,
    ...(cited === 0 ? { skipped: files.length === 0 ? "no markdown file" : `no repository path is cited in ${files.length} markdown file(s)` } : {}),
    findings,
    files: files.length,
    cited,
    excepted: [...excepted].sort(),
    links: links.map((link) => shown(repository, link)),
  };
}

/** The git checkout `path` is in, or the folder it is in when it is in none. */
function repositoryOf(path: string): string {
  const folder = existsSync(path) && statSync(path).isDirectory() ? path : dirname(path);
  const asked = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: folder, encoding: "utf8" });

  return asked.status === 0 && asked.stdout.trim() !== "" ? asked.stdout.trim() : folder;
}

export function formatResult({ gate, skipped, findings, files, cited, excepted, links }: CitedPathCheck): string {
  const said = `${excepted.length === 0 ? "" : `\n  missing, and said to be: ${excepted.join(", ")}`}${notRead("", links)}`;

  if (findings.length > 0) {
    return [
      `FAIL ${gate} (${findings.length})`,
      ...findings.flatMap(({ file, line, message }) => [`  ${file}:${line}`, `    ${message}`]),
      "",
      `${findings.length} of ${cited} cited path(s) in ${files} markdown file(s) are not in the repository.${said}`,
    ].join("\n");
  }

  // Nothing to judge is reported as such: it is not a pass.
  return skipped === undefined ? `PASS ${gate} — ${cited} cited path(s) in ${files} markdown file(s) are in the repository${said}` : `SKIP ${gate} — ${skipped}${notRead("", links)}`;
}

export function parseArguments(argv: string[]): { paths: string[]; root?: string; except: string[] } {
  const paths: string[] = [];
  const except: string[] = [];
  let root: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;

    if (argument === "--root" || argument === "--except") {
      const value = argv[index + 1];

      index += 1;

      if (value === undefined) {
        throw new CouldNotRun(`${argument} needs a path`);
      }

      if (argument === "--root") {
        root = value;
      } else {
        except.push(value);
      }
    } else if (argument.startsWith("--")) {
      throw new CouldNotRun(`unknown argument "${argument}" (use <file or folder>… [--root <dir>] [--except <path>]…)`);
    } else {
      paths.push(argument);
    }
  }

  if (paths.length === 0) {
    throw new CouldNotRun("name the folder that holds the documents, or the files");
  }

  return { paths, except, ...(root === undefined ? {} : { root }) };
}

if (isMainModule(import.meta.url)) {
  try {
    const { paths, root, except } = parseArguments(process.argv.slice(2));
    const result = checkCitedPaths(paths, { except, ...(root === undefined ? {} : { root }) });

    console.log(formatResult(result));
    process.exit(result.findings.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(error instanceof CouldNotRun ? `check-cited-paths could not run: ${error.message}` : error);
    process.exit(2);
  }
}
