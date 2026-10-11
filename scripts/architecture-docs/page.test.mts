import { describe, expect, it } from "vitest";

import { countDiagrams, finishBody, isSafeTarget, onlyKnownTags, pageHtml, pageName, plain, rewriteTarget, safeHtml, titleOf, urlPath, withAnchors, withDiagrams, withLinks, withTables, type PageContext } from "./lib/page.mts";

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

    expect(rewriteTarget("two%20words.md", spaced)).toBe("two%20words.html");
  });

  it("to a file whose name reads like a scheme is still a link to a file", () => {
    // Read with %3A turned into ":" to find the file. Written out like that, a browser would run it.
    expect(rewriteTarget("javascript%3Aalert(1)", context)).toBe("javascript%3Aalert(1)");
    expect(rewriteTarget("data%3Atext/html,x.svg", context)).toBe("data%3Atext/html%2Cx.svg");
    expect(urlPath("a b/c:d/../é.md")).toBe("a%20b/c%3Ad/../%C3%A9.md");
  });

  it("is rewritten in the page, and one that leaves the copy opens in a new tab", () => {
    const html = '<p><a href="README.md#a">in</a> <a href="https://example.test/?a=1&amp;b=2">out</a> <img src="flow.svg" alt="x"></p>';

    expect(withLinks(html, context)).toBe('<p><a href="index.html#a">in</a> <a target="_blank" rel="noopener noreferrer" href="https://example.test/?a=1&amp;b=2">out</a> <img src="flow.svg" alt="x"></p>');
  });
});

describe("a link that is not safe to follow", () => {
  it("is one whose scheme is not the web's or a mailbox's, however it is spelled", () => {
    for (const target of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", " javascript:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "file:///etc/passwd"]) {
      expect(isSafeTarget(target), target).toBe(false);
    }
  });

  it("is not a link inside the copy, to the web, or to a mailbox", () => {
    for (const target of ["02-c4.md#a", "../x/y.md", "#top", "https://example.test", "HTTP://example.test", "mailto:a@example.test", "deep/a:b.md", ""]) {
      expect(isSafeTarget(target), target).toBe(true);
    }
  });

  it("leads nowhere in the page, for a link and for a picture, and is handed to the caller", () => {
    const refused: string[] = [];
    const html = '<p><a href="javascript:alert(1)">x</a> <img src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;" alt="y"> <a href="README.md">ok</a></p>';

    expect(withLinks(html, context, (target) => refused.push(target))).toBe('<p><a href="#">x</a> <img src="#" alt="y"> <a href="index.html">ok</a></p>');
    expect(refused).toEqual(["javascript:alert(1)", "data:image/svg+xml,<svg onload=alert(1)>"]);
  });

  it("is judged as it will stand in the page, not only as it was written", () => {
    const refused: string[] = [];
    // Safe as written: a path to a file outside the set. What it is pointed at is not.
    const pointed = { ...context, outside: () => "javascript:alert(1)" };

    expect(withLinks('<p><a href="../../server/web.ts">x</a> <img src="../../logo.png" alt="y"></p>', pointed, (target) => refused.push(target))).toBe('<p><a href="#">x</a> <img src="#" alt="y"></p>');
    expect(refused).toEqual(["../../server/web.ts", "../../logo.png"]);
  });

  it("is not made by decoding one that was safe", () => {
    const refused: string[] = [];

    expect(withLinks('<p><a href="javascript%3Aalert(1)">x</a> <img src="data%3Atext/html,x" alt="y"></p>', context, (target) => refused.push(target))).toBe('<p><a href="javascript%3Aalert(1)">x</a> <img src="data%3Atext/html%2Cx" alt="y"></p>');
    expect(refused).toEqual([]);
  });
});

describe("HTML an author wrote by hand", () => {
  it("is shown as text when it could run something", () => {
    expect(safeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(safeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror="alert(1)"&gt;');
    expect(safeHtml('<iframe src="https://example.test"></iframe>')).toBe('&lt;iframe src="https://example.test"&gt;&lt;/iframe&gt;');
    expect(safeHtml("<svg><a xlink:href='javascript:1'>x</a></svg>")).toBe("&lt;svg&gt;&lt;a xlink:href='javascript:1'&gt;x&lt;/a&gt;&lt;/svg&gt;");
  });

  it("keeps a tag that only shapes text, when it is bare", () => {
    expect(safeHtml("<details>\n<summary>More</summary>\n\nText<br/>and <kbd>Esc</kbd>\n</details>")).toBe("<details>\n<summary>More</summary>\n\nText<br/>and <kbd>Esc</kbd>\n</details>");
    expect(safeHtml("<B>loud</B> <br >")).toBe("<B>loud</B> <br >");
  });

  it("does not keep such a tag once it carries an attribute: an attribute can run something", () => {
    expect(safeHtml('<b onmouseover="alert(1)">x</b>')).toBe('&lt;b onmouseover="alert(1)"&gt;x</b>');
    expect(safeHtml('<div style="position:fixed">x</div>')).toBe('&lt;div style="position:fixed"&gt;x</div>');
    expect(safeHtml("<p/onclick=alert(1)>")).toBe("&lt;p/onclick=alert(1)&gt;");
  });

  it("drops a comment, closed or not, and leaves no bare angle bracket behind", () => {
    expect(safeHtml("a<!-- <script>x</script> -->b")).toBe("ab");
    expect(safeHtml("a<!-- never closed <script>x")).toBe("a");
    expect(safeHtml("1 < 2 and <script")).toBe("1 &lt; 2 and &lt;script");
    expect(safeHtml("<scr<b>ipt>")).toBe("&lt;scr<b>ipt&gt;");
  });
});

describe("what a converter hands over", () => {
  it("keeps every tag the converter writes", () => {
    // Written by the real converter (marked 15.0.12) for a task list, a numbered list, a table, a code block, and a line of text.
    const written = [
      "<h2>Head</h2>",
      '<ul>\n<li><input checked="" disabled="" type="checkbox"> done</li>\n<li><input disabled="" type="checkbox"> todo</li>\n</ul>',
      '<ol start="3">\n<li>three</li>\n</ol>',
      '<table>\n<thead>\n<tr>\n<th align="left">l</th>\n<th align="center">c</th>\n</tr>\n</thead>\n<tbody><tr>\n<td align="left">1</td>\n<td>2</td>\n</tr>\n</tbody></table>',
      '<pre><code class="language-ts">const a = 1 &lt; 2\n</code></pre>',
      '<blockquote>\n<p><del>gone</del> <strong>b</strong> <em>i</em> <code>c</code><br>break</p>\n</blockquote>\n<hr>',
      '<p><a href="a.md" title="t &quot;q&quot;">a</a> <img src="x.png" alt="x"> <img src="x.png" alt="x" title="t"></p>',
    ].join("\n");

    expect(onlyKnownTags(written)).toBe(written);
  });

  it("shows as text a tag the converter let through after <kbd>, <code> or <pre>", () => {
    // What marked 15.0.12 writes for `<kbd><img/src="x"/onerror=alert(1)></kbd>`: it stops escaping text there.
    expect(onlyKnownTags('<p>Press <kbd><img/src="x"/onerror=alert(1)></kbd> now</p>')).toBe('<p>Press <kbd>&lt;img/src="x"/onerror=alert(1)&gt;</kbd> now</p>');
    expect(onlyKnownTags("<p>A <code><svg/onload=alert(1)></code> b</p>")).toBe("<p>A <code>&lt;svg/onload=alert(1)&gt;</code> b</p>");
  });

  it("shows as text a tag that is the converter's with something added", () => {
    // What marked 15.0.12 writes for `![" onerror="alert(1)](x.png)` when left to write the picture itself.
    expect(onlyKnownTags('<img src="x.png" alt="" onerror="alert(1)">')).toBe('&lt;img src="x.png" alt="" onerror="alert(1)"&gt;');
    expect(onlyKnownTags('<a href="a.md" onclick="alert(1)">')).toBe('&lt;a href="a.md" onclick="alert(1)"&gt;');
    expect(onlyKnownTags('<code class="x" id="y">')).toBe('&lt;code class="x" id="y"&gt;');
    expect(onlyKnownTags('<td align="left" style="x">')).toBe('&lt;td align="left" style="x"&gt;');
  });

  it("shows as text a tag spelled another way than the converter spells it", () => {
    // `withLinks` reads a link the way the converter writes it. A link written any other way would pass it unread.
    expect(onlyKnownTags('<A HREF="javascript:alert(1)">')).toBe('&lt;A HREF="javascript:alert(1)"&gt;');
    expect(onlyKnownTags("<a href='javascript:alert(1)'>")).toBe("&lt;a href='javascript:alert(1)'&gt;");
    expect(onlyKnownTags('<a  href="javascript:alert(1)">')).toBe('&lt;a  href="javascript:alert(1)"&gt;');
    expect(onlyKnownTags('<img alt="x" src="javascript:alert(1)">')).toBe('&lt;img alt="x" src="javascript:alert(1)"&gt;');
  });

  it("shows as text what was never a tag, and loses nothing after it", () => {
    expect(onlyKnownTags("<script>alert(1)</script> <!-- <b>kept</b> rest")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &lt;!-- <b>kept</b> rest");
  });
});

describe("the body of a page", () => {
  it("keeps only the tags it knows, whatever converter made it", () => {
    const refused: string[] = [];
    const body = finishBody('<p><script>alert(1)</script><img src="x.png" alt="" onerror="alert(1)"><A HREF="javascript:alert(1)">x</A></p>', context, (target) => refused.push(target));

    expect(body).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src="x.png" alt="" onerror="alert(1)"&gt;&lt;A HREF="javascript:alert(1)"&gt;x&lt;/A&gt;</p>');
    expect(refused).toEqual([]);
  });

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
