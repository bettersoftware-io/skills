import { describe, expect, it } from "vitest";

import { countDiagrams, finishBody, pageHtml, pageName, plain, rewriteTarget, titleOf, withAnchors, withDiagrams, withLinks, withTables, type PageContext } from "./lib/page.mts";

const context: PageContext = {
  source: "/repo/docs/architecture/02-c4.md",
  root: "/repo/docs/architecture",
  pages: new Map([
    ["/repo/docs/architecture/README.md", "index.html"],
    ["/repo/docs/architecture/02-c4.md", "02-c4.html"],
    ["/repo/docs/architecture/deep/notes.md", "deep/notes.html"],
  ]),
  outside: (file) => `OUTSIDE:${file}`,
};

describe("the page a document becomes", () => {
  it("has the document's name, and a README is what its folder opens on", () => {
    expect(pageName("02-c4.md")).toBe("02-c4.html");
    expect(pageName("README.md")).toBe("index.html");
    expect(pageName("deep/readme.MD")).toBe("deep/index.html");
    expect(pageName("deep/notes.md")).toBe("deep/notes.html");
  });

  it("is titled by its first heading, read as a reader sees it", () => {
    expect(titleOf('<p>x</p>\n<h2 id="a"><a class="anchor" href="#a">2. <code>C4</code> &amp; more</a></h2>')).toBe("2. C4 & more");
    expect(titleOf("<p>no heading</p>")).toBeUndefined();
  });
});

describe("a mermaid block", () => {
  it("becomes a figure the page draws, with its source still escaped", () => {
    const html = '<p>x</p>\n<pre><code class="language-mermaid">flowchart LR\n  a[&quot;&lt;b&gt;A&lt;/b&gt;&quot;] --&gt; b\n</code></pre>\n';

    expect(withDiagrams(html)).toBe('<p>x</p>\n<figure class="diagram"><pre class="mermaid">flowchart LR\n  a[&quot;&lt;b&gt;A&lt;/b&gt;&quot;] --&gt; b</pre></figure>\n');
    expect(countDiagrams(withDiagrams(html))).toBe(1);
  });

  it("is the only kind of block that does", () => {
    const html = '<pre><code class="language-ts">const a = 1;\n</code></pre>';

    expect(withDiagrams(html)).toBe(html);
    expect(countDiagrams(html)).toBe(0);
  });
});

describe("a heading", () => {
  it("gets the anchor GitHub gives it, so a link written for GitHub lands", () => {
    expect(withAnchors("<h3>2.1 Level 1 — system context</h3>")).toBe('<h3 id="21-level-1--system-context"><a class="anchor" href="#21-level-1--system-context">2.1 Level 1 — system context</a></h3>');
    expect(withAnchors("<h2>6.2 <code>lib/</code> is the contract</h2>")).toContain('id="62-lib-is-the-contract"');
    expect(withAnchors("<h2>Q &amp; A</h2>")).toContain('id="q--a"');
  });

  it("that repeats gets -1, then -2, in the order of the page", () => {
    expect([...withAnchors("<h2>Notes</h2><h3>Notes</h3><h2>Notes</h2>").matchAll(/id="([^"]+)"/g)].map((match) => match[1])).toEqual(["notes", "notes-1", "notes-2"]);
  });
});

describe("a link", () => {
  it("to another document of the set leads to its page, and keeps its anchor", () => {
    expect(rewriteTarget("README.md", context)).toBe("index.html");
    expect(rewriteTarget("./README.md#contents", context)).toBe("index.html#contents");
    expect(rewriteTarget("deep/notes.md#a", context)).toBe("deep/notes.html#a");
  });

  it("is written from where the page is, not from the top", () => {
    const deep = { ...context, source: "/repo/docs/architecture/deep/notes.md" };

    expect(rewriteTarget("../02-c4.md#x", deep)).toBe("../02-c4.html#x");
    expect(rewriteTarget("../README.md", deep)).toBe("../index.html");
  });

  it("to a picture of the set leads to its copy beside the pages", () => {
    expect(rewriteTarget("flow.svg", context)).toBe("flow.svg");
    expect(rewriteTarget("../flow.svg", { ...context, source: "/repo/docs/architecture/deep/notes.md" })).toBe("../flow.svg");
  });

  it("to a file outside the set is handed to the caller, with its anchor kept", () => {
    expect(rewriteTarget("../../server/web.ts", context)).toBe("OUTSIDE:/repo/server/web.ts");
    expect(rewriteTarget("../navigation.md#links", context)).toBe("OUTSIDE:/repo/docs/navigation.md#links");
  });

  it("with a scheme, or to an anchor of the same page, is left as written", () => {
    expect(rewriteTarget("https://example.test/a.md", context)).toBe("https://example.test/a.md");
    expect(rewriteTarget("mailto:a@example.test", context)).toBe("mailto:a@example.test");
    expect(rewriteTarget("#top", context)).toBe("#top");
  });

  it("with an encoded name finds the file by its real name", () => {
    const spaced = { ...context, pages: new Map([...context.pages, ["/repo/docs/architecture/two words.md", "two words.html"]]) };

    expect(rewriteTarget("two%20words.md", spaced)).toBe("two words.html");
  });

  it("is rewritten in the page, and one that leaves the copy opens in a new tab", () => {
    const html = '<p><a href="README.md#a">in</a> <a href="https://example.test/?a=1&amp;b=2">out</a> <img src="flow.svg" alt="x"></p>';

    expect(withLinks(html, context)).toBe('<p><a href="index.html#a">in</a> <a target="_blank" rel="noopener" href="https://example.test/?a=1&amp;b=2">out</a> <img src="flow.svg" alt="x"></p>');
  });
});

describe("the body of a page", () => {
  it("has every step applied, and a wide table scrolls in a box of its own", () => {
    const body = finishBody('<h1>Title</h1>\n<table><tr><td><a href="deep/notes.md">n</a></td></tr></table>\n<pre><code class="language-mermaid">flowchart LR\n</code></pre>', context);

    expect(body).toContain('<h1 id="title">');
    expect(body).toContain('<div class="table-wrap"><table>');
    expect(body).toContain("</table></div>");
    expect(body).toContain('href="deep/notes.html"');
    expect(body).toContain('<pre class="mermaid">flowchart LR</pre>');
    expect(withTables("<p>none</p>")).toBe("<p>none</p>");
  });
});

describe("a whole page", () => {
  const nav = [
    { page: "index.html", title: "Start <here>" },
    { page: "02-c4.html", title: "C4" },
    { page: "deep/notes.html", title: "Notes" },
  ];
  const page = (name: string, title: string): string => pageHtml({ page: name, title, site: "The set", body: "<p>body</p>", nav, css: "CSS", script: "SCRIPT" });

  it("lists every chapter, escaped, and offers the one before and the one after", () => {
    const html = page("02-c4.html", "C4");

    expect(html).toContain("<title>C4 · The set</title>");
    expect(html).toContain('<a href="index.html" data-page="index.html">Start &lt;here&gt;</a>');
    expect(html).toContain('<nav class="pager"><a href="index.html">← Start &lt;here&gt;</a><a href="deep/notes.html">Notes →</a></nav>');
    expect(html).toContain('<script src="mermaid.min.js"></script>');
  });

  it("reaches the top of the copy from a page in a folder", () => {
    const html = page("deep/notes.html", "Notes");

    expect(html).toContain('<a href="../02-c4.html" data-page="02-c4.html">C4</a>');
    expect(html).toContain('<script src="../mermaid.min.js"></script>');
    expect(html).toContain('<nav class="pager"><a href="../02-c4.html">← C4</a><span></span></nav>');
  });

  it("does not say the set's name twice on the start page", () => {
    expect(pageHtml({ page: "index.html", title: "The set", site: "The set", body: "", nav, css: "", script: "" })).toContain("<title>The set</title>");
  });
});

describe("reading HTML as text", () => {
  it("drops the tags and reads the entities, the ampersand last", () => {
    expect(plain("<code>a &lt; b</code> &amp;lt; &quot;c&quot; &#39;d&#39;")).toBe("a < b &lt; \"c\" 'd'");
  });
});
