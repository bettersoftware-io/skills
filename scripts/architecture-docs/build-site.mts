#!/usr/bin/env node
// Builds a copy of a set of markdown documents that opens in a browser from
// disk: one page per document, a list of chapters beside it, every mermaid
// diagram drawn, nothing fetched when it is read.
//
//   node scripts/architecture-docs/build-site.mts docs/architecture
//   node scripts/architecture-docs/build-site.mts docs/architecture --index docs/architecture.md --out /tmp/site
//
// It exists because an editor's preview is where such a set is usually read,
// and a preview may not draw mermaid at all, or may stop after a few dozen
// diagrams. A browser draws them.
//
// The folder gives every `.md` file under it. Its `README.md` becomes
// `index.html`; `--index <file>` names another start page, which may sit
// outside the folder. Every other file in the folder (a picture) is copied
// beside the pages.
//
// `--out <dir>` is where the copy goes. Without it the copy goes to a cache
// folder outside the repository, and the path is printed: a repository that
// is not ours must not gain files from being read. `--title <text>` names the
// set; without it, the start page's first heading.
//
// A link to a file outside the set points at that file on disk. With
// `--repo-url <prefix>` it points at `<prefix>/<path from the repository
// root>` instead (`https://github.com/acme/app/blob/main`).
//
// It is a snapshot. When the documents change, build it again.
//
// The tools are fetched on first use (see lib/tools.mts).
//
// Exit 0: built. Exit 2: it could not run.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { isMainModule } from "../../kit/gates/lib/files.mts";
import { isLink, listMarkdown, notRead } from "./lib/blocks.mts";
import { CouldNotRun } from "./lib/outcome.mts";
import { countDiagrams, finishBody, pageHtml, pageName, safeHtml, titleOf, type NavEntry } from "./lib/page.mts";
import { SITE_CSS, SITE_SCRIPT } from "./lib/site-assets.mts";
import { cacheFolder, ensureToolset } from "./lib/tools.mts";

/**
 * Turns markdown into HTML. The real one is fetched; tests bring their own.
 *
 * It must hand HTML that the author wrote by hand through `safeHtml`, as
 * `createConverter` does: a document from someone else's repository is opened
 * in the reader's browser, and a script written in it would run there.
 */
export type ToHtml = (markdown: string) => string;

/** The part of the fetched converter that is used: a class that takes how to render, and parses. */
export type MarkedClass = new (options: { gfm: true; async: false; renderer: { html: (token: { text: string }) => string } }) => { parse: (markdown: string) => string };

/** The converter the copy is built with: markdown as GitHub reads it, and hand-written HTML made harmless. */
export function createConverter(Marked: MarkedClass): ToHtml {
  const converter = new Marked({ gfm: true, async: false, renderer: { html: (token) => safeHtml(token.text) } });

  return (markdown) => converter.parse(markdown);
}

/** Written into every copy. A folder that holds something and lacks it was not built here, and is never emptied. */
export const MARKER = ".architecture-docs-site";

export interface SiteOptions {
  /** The folder that holds the set. */
  folder: string;
  /** The start page, when it is not the folder's `README.md`. */
  index?: string;
  out: string;
  title?: string;
  /** Where a link to a file outside the set leads, when not to the file on disk. */
  repoUrl?: string;
  toHtml: ToHtml;
  /** Mermaid as one file, copied beside the pages. */
  mermaidBundle: string;
}

export interface Built {
  out: string;
  /** The page to open, as a path. */
  start: string;
  pages: number;
  diagrams: number;
  /** Files of the set that are not documents, copied as they are. */
  copied: number;
  /** Links that were not safe to follow (`javascript:` and the like). They lead nowhere in the copy. */
  refused: string[];
  /** Documents that are symbolic links. They were not read. */
  links: string[];
}

export function buildSite({ folder, index, out, title, repoUrl, toHtml, mermaidBundle }: SiteOptions): Built {
  const root = resolve(folder);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new CouldNotRun(`${folder} is not a folder`);
  }

  const start = index === undefined ? join(root, "README.md") : resolve(index);

  if (!existsSync(start)) {
    throw new CouldNotRun(index === undefined ? `${folder} has no README.md to start from. Name the start page with --index <file>.` : `${index} does not exist`);
  }

  if (isLink(start)) {
    throw new CouldNotRun(`${index ?? join(folder, "README.md")} is a symbolic link, and a link is never followed. Name the file it points at with --index.`);
  }

  const destination = resolve(out);

  if (destination === root || isUnder(root, destination)) {
    throw new CouldNotRun(`--out is ${out}, which is the documents' own folder or inside it. Name a folder outside it.`);
  }

  // The folder is emptied before it is written. So it must be new, empty, or a
  // copy this script built: a mistyped --out must not cost a person their files.
  if (isLink(destination)) {
    throw new CouldNotRun(`--out is ${out}, which is a symbolic link. Name a real folder.`);
  }

  if (existsSync(destination) && (!statSync(destination).isDirectory() || (readdirSync(destination).length > 0 && !existsSync(join(destination, MARKER))))) {
    throw new CouldNotRun(`--out is ${out}, which already holds something this script did not build. It empties the folder it writes to, so name a new or empty one.`);
  }

  // The start page first, then the rest in name order: that is the order of the chapter list.
  const links: string[] = [];
  const sources = [start, ...listMarkdown([root], links).filter((path) => path !== start)];
  const pages = new Map<string, string>();

  for (const source of sources) {
    const page = source === start ? "index.html" : pageName(relative(root, source));

    if ([...pages.values()].includes(page)) {
      throw new CouldNotRun(`two documents would both become ${page}: ${[...pages.entries()].find(([, name]) => name === page)?.[0]} and ${source}. Rename one, or name another start page with --index.`);
    }

    pages.set(source, page);
  }

  const repository = repositoryOf(root);
  const outside = (file: string, from: string): string =>
    repoUrl !== undefined && isUnder(repository, file)
      ? `${repoUrl.replace(/\/+$/, "")}/${relative(repository, file).split(sep).join("/")}`
      : relative(dirname(join(destination, from)), file).split(sep).join("/");

  const refused: string[] = [];
  const rendered = sources.map((source) => {
    const page = pages.get(source) as string;
    const body = finishBody(toHtml(readFileSync(source, "utf8")), { source, pages, root, outside: (file) => outside(file, page) }, (target) => refused.push(target));

    return { page, body, title: titleOf(body) ?? basename(source, ".md") };
  });

  const site = title ?? rendered[0]?.title ?? basename(root);
  const nav: NavEntry[] = rendered.map(({ page, title: pageTitle }) => ({ page, title: pageTitle }));

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, MARKER), "Built by scripts/architecture-docs/build-site.mts. The next build empties this folder.\n");

  for (const { page, body, title: pageTitle } of rendered) {
    mkdirSync(dirname(join(destination, page)), { recursive: true });
    writeFileSync(join(destination, page), pageHtml({ page, title: pageTitle, site, body, nav, css: SITE_CSS, script: SITE_SCRIPT }));
  }

  copyFileSync(mermaidBundle, join(destination, "mermaid.min.js"));

  const others = listOthers(root);

  for (const path of others) {
    mkdirSync(dirname(join(destination, path)), { recursive: true });
    copyFileSync(join(root, path), join(destination, path));
  }

  return {
    out: destination,
    start: join(destination, "index.html"),
    pages: rendered.length,
    diagrams: rendered.reduce((sum, { body }) => sum + countDiagrams(body), 0),
    copied: others.length,
    refused,
    links: links.map((link) => relative(root, link).split(sep).join("/")),
  };
}

function isUnder(folder: string, path: string): boolean {
  const inside = relative(folder, path);

  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
}

/** Every file under `root` that is not a markdown document, as paths from `root`. A symbolic link is not a file here, and is not copied. */
function listOthers(root: string): string[] {
  const found: string[] = [];

  function walk(inside: string): void {
    for (const entry of readdirSync(join(root, inside), { withFileTypes: true })) {
      const path = inside === "" ? entry.name : `${inside}/${entry.name}`;

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          walk(path);
        }
      } else if (entry.isFile() && !/\.md$/i.test(entry.name) && !entry.name.startsWith(".")) {
        found.push(path);
      }
    }
  }

  walk("");

  return found.sort();
}

/** The git checkout `folder` is in, or `folder` when it is in none. */
function repositoryOf(folder: string): string {
  const asked = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: folder, encoding: "utf8" });

  return asked.status === 0 && asked.stdout.trim() !== "" ? asked.stdout.trim() : folder;
}

/** Where a copy goes when nobody said: a cache folder named after the set, one per set. */
export function defaultOut(folder: string, cache: string = cacheFolder()): string {
  const root = resolve(folder);
  const name = `${basename(dirname(root))}-${basename(root)}`.replace(/[^A-Za-z0-9._-]/g, "-");

  return join(cache, "sites", `${name}-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`);
}

export function formatResult({ out, start, pages, diagrams, copied, refused, links }: Built): string {
  return [
    `Built ${pages} page(s) with ${diagrams} diagram(s)${copied === 0 ? "" : ` and ${copied} other file(s)`} in ${out}`,
    // Said, not passed over: the reader should know the copy differs from the documents here.
    ...(refused.length === 0 ? [] : [`  ${refused.length} link(s) are not safe to follow and lead nowhere in the copy: ${[...new Set(refused)].map((target) => JSON.stringify(target.slice(0, 60))).join(", ")}`]),
    ...(links.length === 0 ? [] : [notRead("", links).trimStart().replace(/^/, "  ")]),
    `Open ${start}`,
  ].join("\n");
}

export function parseArguments(argv: string[]): { folder: string; index?: string; out?: string; title?: string; repoUrl?: string } {
  const named: Record<string, string> = {};
  const folders: string[] = [];

  for (let position = 0; position < argv.length; position += 1) {
    const argument = argv[position] as string;

    if (["--index", "--out", "--title", "--repo-url"].includes(argument)) {
      const value = argv[position + 1];

      position += 1;

      if (value === undefined) {
        throw new CouldNotRun(`${argument} needs a value`);
      }

      named[argument] = value;
    } else if (argument.startsWith("--")) {
      throw new CouldNotRun(`unknown argument "${argument}" (use <folder> [--index <file>] [--out <dir>] [--title <text>] [--repo-url <prefix>])`);
    } else {
      folders.push(argument);
    }
  }

  if (folders.length !== 1) {
    throw new CouldNotRun("name one folder: the one that holds the documents");
  }

  return {
    folder: folders[0] as string,
    ...(named["--index"] === undefined ? {} : { index: named["--index"] }),
    ...(named["--out"] === undefined ? {} : { out: named["--out"] }),
    ...(named["--title"] === undefined ? {} : { title: named["--title"] }),
    ...(named["--repo-url"] === undefined ? {} : { repoUrl: named["--repo-url"] }),
  };
}

if (isMainModule(import.meta.url)) {
  try {
    const { folder, out, ...rest } = parseArguments(process.argv.slice(2));

    // Checked before anything is fetched: a mistyped folder should not cost a download.
    if (!existsSync(folder) || !statSync(folder).isDirectory()) {
      throw new CouldNotRun(`${folder} is not a folder`);
    }

    const toolset = ensureToolset();
    const { Marked } = (await import(pathToFileURL(toolset.marked).href)) as { Marked: MarkedClass };
    const built = buildSite({ folder, out: out ?? defaultOut(folder), ...rest, toHtml: createConverter(Marked), mermaidBundle: toolset.mermaidBundle });

    console.log(formatResult(built));
  } catch (error) {
    console.error(error instanceof CouldNotRun ? `build-site could not run: ${error.message}` : error);
    process.exit(2);
  }
}
