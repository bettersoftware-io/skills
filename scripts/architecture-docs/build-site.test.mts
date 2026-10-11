import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSite, defaultOut, formatResult, parseArguments, type ToHtml } from "./build-site.mts";
import { CouldNotRun } from "./lib/outcome.mts";
import { createFolder, initGit, mermaid, SCRIPTS } from "./support.mts";

const script = join(SCRIPTS, "build-site.mts");

/** Enough of a markdown converter for these tests: headings, links, pictures, mermaid blocks, paragraphs. */
const toHtml: ToHtml = (markdown) =>
  markdown
    .replace(/```mermaid\n([\s\S]*?)\n```/g, (_, source: string) => `<pre><code class="language-mermaid">${source}\n</code></pre>`)
    .replace(/^(#{1,6}) (.*)$/gm, (_, marks: string, text: string) => `<h${marks.length}>${text}</h${marks.length}>`)
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>');

/** A repository with a set of three documents, a picture, and a file outside the set. */
function createSet(): { root: string; bundle: string } {
  const root = createFolder({
    "server/web.ts": "",
    "docs/architecture/README.md": "# The set\n\n[C4](02-c4.md#context) and [notes](deep/notes.md).\n",
    "docs/architecture/02-c4.md": `# C4\n\n## Context\n\n${mermaid("flowchart LR\n  a --> b")}\n\n![flow](flow.svg) [code](../../server/web.ts) [home](README.md)\n`,
    "docs/architecture/deep/notes.md": `# Notes\n\n${mermaid("flowchart TD\n  x")}\n\n${mermaid("flowchart TD\n  y")}\n\n[up](../02-c4.md)\n`,
    "docs/architecture/flow.svg": "<svg/>",
    "bundle/mermaid.min.js": "MERMAID",
  });

  initGit(root);

  return { root, bundle: join(root, "bundle/mermaid.min.js") };
}

describe("a built copy", () => {
  const { root, bundle } = createSet();
  const out = join(createFolder(), "site");
  const built = buildSite({ folder: join(root, "docs/architecture"), out, toHtml, mermaidBundle: bundle });
  const read = (page: string): string => readFileSync(join(out, page), "utf8");

  it("has a page for each document, the README as the page it opens on, and says what it built", () => {
    expect(readdirSync(out).sort()).toEqual(["02-c4.html", "deep", "flow.svg", "index.html", "mermaid.min.js"]);
    expect(readdirSync(join(out, "deep"))).toEqual(["notes.html"]);
    expect(built).toEqual({ out, start: join(out, "index.html"), pages: 3, diagrams: 3, copied: 1 });
    expect(formatResult(built)).toBe(`Built 3 page(s) with 3 diagram(s) and 1 other file(s) in ${out}\nOpen ${join(out, "index.html")}`);
  });

  it("carries Mermaid and the set's pictures, so it reads with nothing fetched", () => {
    expect(read("mermaid.min.js")).toBe("MERMAID");
    expect(read("flow.svg")).toBe("<svg/>");
  });

  it("lists the chapters from the start page on, each by its first heading, under the set's name", () => {
    expect([...read("index.html").matchAll(/<a href="[^"]*" data-page="([^"]+)">([^<]+)</g)].map((match) => `${match[1]}=${match[2]}`)).toEqual(["index.html=The set", "02-c4.html=C4", "deep/notes.html=Notes"]);
    expect(read("02-c4.html")).toContain("<title>C4 · The set</title>");
  });

  it("links documents to each other's pages, with anchors that match the headings", () => {
    expect(read("index.html")).toContain('<a href="02-c4.html#context">C4</a>');
    expect(read("02-c4.html")).toContain('<h2 id="context">');
    expect(read("deep/notes.html")).toContain('<a href="../02-c4.html">up</a>');
    expect(read("02-c4.html")).toContain('<a href="index.html">home</a>');
  });

  it("points a link that leaves the set at the file itself, from where the page is", () => {
    const href = /<a href="([^"]+)">code<\/a>/.exec(read("02-c4.html"))?.[1] as string;

    expect(href.endsWith("server/web.ts")).toBe(true);
    expect(existsSync(join(out, href))).toBe(true);
  });

  it("replaces what was there: a page of a document that is gone does not stay", () => {
    writeFileSync(join(out, "old.html"), "");
    buildSite({ folder: join(root, "docs/architecture"), out, toHtml, mermaidBundle: bundle });

    expect(existsSync(join(out, "old.html"))).toBe(false);
  });
});

describe("the options of a build", () => {
  it("point a link that leaves the set at a web address when one is given", () => {
    const { root, bundle } = createSet();
    const out = join(createFolder(), "site");

    buildSite({ folder: join(root, "docs/architecture"), out, toHtml, mermaidBundle: bundle, repoUrl: "https://example.test/acme/app/blob/main/" });

    expect(readFileSync(join(out, "02-c4.html"), "utf8")).toContain('<a target="_blank" rel="noopener" href="https://example.test/acme/app/blob/main/server/web.ts">code</a>');
  });

  it("take a start page from outside the folder, and the documents link back to it", () => {
    const root = createFolder({
      "docs/architecture.md": "# Index\n\n[one](architecture/01.md)\n",
      "docs/architecture/01.md": "# One\n\n[back](../architecture.md)\n",
      "m.js": "",
    });
    const out = join(createFolder(), "site");
    const built = buildSite({ folder: join(root, "docs/architecture"), index: join(root, "docs/architecture.md"), out, toHtml, mermaidBundle: join(root, "m.js"), title: "Named" });

    expect(built.pages).toBe(2);
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain('<a href="01.html">one</a>');
    expect(readFileSync(join(out, "01.html"), "utf8")).toContain('<a href="index.html">back</a>');
    expect(readFileSync(join(out, "01.html"), "utf8")).toContain("<title>One · Named</title>");
  });
});

describe("a build that cannot run", () => {
  const { root, bundle } = createSet();
  const folder = join(root, "docs/architecture");
  const build = (options: Partial<Parameters<typeof buildSite>[0]>): unknown => buildSite({ folder, out: join(createFolder(), "site"), toHtml, mermaidBundle: bundle, ...options });

  it("says so for a folder that is not there, and for one with no page to start from", () => {
    expect(() => build({ folder: join(root, "dcos") })).toThrow(CouldNotRun);
    expect(() => build({ folder: join(root, "server") })).toThrow(/has no README\.md to start from\. Name the start page with --index <file>\./);
    expect(() => build({ index: join(root, "nope.md") })).toThrow(/does not exist/);
  });

  it("refuses to write into the documents' own folder: it empties the folder it writes to", () => {
    expect(() => build({ out: folder })).toThrow(/Name a folder outside it/);
    expect(() => build({ out: join(folder, "site") })).toThrow(/Name a folder outside it/);
    expect(existsSync(join(folder, "README.md"))).toBe(true);
  });

  it("refuses two documents that would become one page", () => {
    expect(() => build({ index: join(folder, "02-c4.md") })).toThrow(/two documents would both become index\.html/);
  });
});

describe("where a copy goes when nobody said", () => {
  it("is the cache, never the repository, with one folder for each set", () => {
    expect(defaultOut("/repo/a/docs/architecture", "/cache")).toMatch(/^\/cache\/sites\/docs-architecture-[0-9a-f]{8}$/);
    expect(defaultOut("/repo/a/docs/architecture", "/cache")).not.toBe(defaultOut("/repo/b/docs/architecture", "/cache"));
  });
});

describe("the command line", () => {
  it("takes one folder and its options", () => {
    expect(parseArguments(["docs/architecture", "--index", "docs/a.md", "--out", "/tmp/s", "--title", "T", "--repo-url", "https://x.test"])).toEqual({
      folder: "docs/architecture",
      index: "docs/a.md",
      out: "/tmp/s",
      title: "T",
      repoUrl: "https://x.test",
    });
    expect(parseArguments(["docs"])).toEqual({ folder: "docs" });
  });

  it("refuses no folder, two folders, a flag it does not know, and a flag with no value", () => {
    expect(() => parseArguments([])).toThrow(CouldNotRun);
    expect(() => parseArguments(["a", "b"])).toThrow(CouldNotRun);
    expect(() => parseArguments(["a", "--fast"])).toThrow(CouldNotRun);
    expect(() => parseArguments(["a", "--out"])).toThrow(CouldNotRun);
  });

  it("exits 2, fetching nothing, when the folder is not there", () => {
    const cache = createFolder();
    const ran = spawnSync(process.execPath, [script, "no-such-folder"], { encoding: "utf8", cwd: createFolder(), env: { ...process.env, XDG_CACHE_HOME: cache } });

    expect(ran.status).toBe(2);
    expect(ran.stderr).toBe("build-site could not run: no-such-folder is not a folder\n");
    expect(readdirSync(cache)).toEqual([]);
  });
});
