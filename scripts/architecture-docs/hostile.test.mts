// A document written to attack whoever reads it, built with the converter the
// copy is really built with, and opened in a real browser.
//
// The other tests hand the builder a stand-in converter. A stand-in behaves
// the way its author thinks the real one does, and three faults got past them
// that way: the real one writes a picture's alt text as it stands, stops
// escaping text after `<kbd>`, and a link checked before `%3A` was decoded
// became `javascript:` after. So this test takes nobody's word. Each attack
// below tries to set `window.pwned`; the browser is asked whether one did, and
// what it makes of every link.
//
// It needs the fetched tools and a browser. Where either is missing it is
// skipped, and says so: it never fetches, and a skip is not a pass. Run
// `check-diagrams.mts` once on a machine to have the tools.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildSite, createConverter, type Built, type MarkedClass } from "./build-site.mts";
import { closeBrowser, type Closable } from "./lib/close-browser.mts";
import { browserArguments, findBrowser, installedToolset, isHeadlessShell } from "./lib/tools.mts";
import { createFolder, mermaid } from "./support.mts";

/**
 * One line per attack. The name each would leave in `window.pwned` says which
 * got through. A name is one word: a space ends a link's address in markdown,
 * and would cut the attack short, so that it proved nothing.
 */
const HOSTILE = [
  "# Hostile",
  "",
  "<script>window.pwned = 'a-script-tag'</script>",
  "",
  "<img src=\"x\" onerror=\"window.pwned = 'a-picture-that-fails-to-load'\">",
  "",
  "<iframe srcdoc=\"<script>parent.pwned = 'a-frame'</script>\"></iframe>",
  "",
  "<base href=\"https://evil.test/\">",
  "",
  "<a href=\"javascript:window.pwned='a-hand-written-link'\">hand-written link</a>",
  "",
  "<A HREF=\"javascript:window.pwned='a-link-in-upper-case'\">upper case link</A>",
  "",
  "<form action=\"javascript:window.pwned='a-form'\"><button>go</button></form>",
  "",
  "<svg><script>window.pwned = 'a-script-in-a-drawing'</script></svg>",
  "",
  "Inline <b onmouseover=\"window.pwned = 'an-attribute'\">bold</b>, and <kbd>Esc</kbd> and <br/> which are fine.",
  "",
  "After kbd: <kbd><img/src=\"x\"/onerror=\"window.pwned='text-after-kbd'\"></kbd>",
  "",
  "After code: <code><svg/onload=\"window.pwned='text-after-code'\"></code>",
  "",
  "[a link](javascript:window.pwned='a-link')",
  "[spelled oddly](JaVaScRiPt:window.pwned='a-link-spelled-oddly')",
  "[encoded](javascript%3Awindow.pwned='an-encoded-link')",
  "[as an entity](javascript&colon;window.pwned='a-link-with-an-entity')",
  "<javascript:window.pwned='an-autolink'>",
  "[fine](https://example.test)",
  "",
  "![a picture](data:image/svg+xml,<svg/onload=window.pwned='a-picture-made-of-data'>)",
  "![encoded](data%3Aimage/svg+xml,<svg/onload=window.pwned='an-encoded-picture'>)",
  "![\" onerror=\"window.pwned='alt-text'](missing.png)",
  "![x](missing.png \"t\\\" onerror=\\\"window.pwned='a-title'\")",
  "![The \"quoted\" picture](flow.svg)",
  "",
  "## <img src=x onerror=\"window.pwned='a-heading'\"> Heading",
  "",
  "| cell |",
  "|---|",
  "| <b onclick=\"window.pwned='a-cell'\">x</b> |",
  "",
  "<details>",
  "<summary>More</summary>",
  "",
  "Hidden text.",
  "",
  "</details>",
  "",
  mermaid(["flowchart LR", "  a[\"<img src=x onerror=window.pwned='a-diagram-label'>\"] --> b", "  click a \"javascript:window.pwned='a-click-on-a-diagram'\""].join("\n")),
  "",
].join("\n");

/** What the page is asked, after everything in it has been hovered over and clicked. */
const ASK = `(() => {
  const article = document.querySelector("article");
  const everything = [...document.querySelectorAll("*")];

  for (const element of everything) {
    for (const event of ["mouseover", "mouseenter", "focus"]) {
      element.dispatchEvent(new MouseEvent(event, { bubbles: true }));
    }
  }

  // A link that leads nowhere, and a node of a diagram: clicking either must do nothing.
  for (const element of article.querySelectorAll('a[href="#"], figure svg g.node')) {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  return {
    pwned: window.pwned ?? null,
    // Counted in the whole page, less the two the page is built with.
    scripts: document.querySelectorAll("script").length - 2,
    forbidden: [...article.querySelectorAll("script, iframe, object, embed, form, base, meta, link")].map((element) => element.tagName),
    base: document.baseURI.startsWith("file:"),
    handlers: everything.filter((element) => [...element.attributes].some((attribute) => attribute.name.startsWith("on"))).map((element) => element.outerHTML.slice(0, 80)),
    // The scheme of every link and picture, as the browser reads it. Not as this code reads it.
    schemes: [...new Set([...article.querySelectorAll("a[href]"), ...article.querySelectorAll("img[src]")].map((element) => new URL(element.href ?? element.src, document.baseURI).protocol))].sort(),
    details: article.querySelectorAll("details").length,
    drawn: article.querySelectorAll("figure svg").length,
    quoted: article.querySelector("img[alt='The \\"quoted\\" picture']") !== null,
  };
})()`;

interface Answer {
  pwned: string | null;
  scripts: number;
  forbidden: string[];
  base: boolean;
  handlers: string[];
  schemes: string[];
  details: number;
  drawn: number;
  quoted: boolean;
}

// The few things used of the browser library. It is fetched, so its own types are not there to import.
interface Browser extends Closable {
  newPage(): Promise<{ goto(url: string): Promise<unknown>; waitForSelector(selector: string, options: { timeout: number }): Promise<unknown>; evaluate(script: string): Promise<unknown> }>;
}

const toolset = installedToolset();
const executablePath = findBrowser();
const missing = toolset === undefined ? "the tools have not been fetched on this machine" : executablePath === undefined ? "no browser was found" : undefined;

describe.skipIf(missing !== undefined)(`a document written to attack its reader${missing === undefined ? "" : ` (skipped: ${missing})`}`, () => {
  let built: Built;
  let page: string;
  let answer: Answer;
  let browser: Browser | undefined;

  beforeAll(async () => {
    const root = createFolder({ "docs/README.md": HOSTILE, "docs/flow.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
    const { Marked } = (await import(pathToFileURL((toolset as NonNullable<typeof toolset>).marked).href)) as { Marked: MarkedClass };

    built = buildSite({ folder: join(root, "docs"), out: join(createFolder(), "site"), toHtml: createConverter(Marked), mermaidBundle: (toolset as NonNullable<typeof toolset>).mermaidBundle });
    page = readFileSync(built.start, "utf8");

    // One browser, with no window, closed when the test is over.
    const { launch } = (await import(pathToFileURL((toolset as NonNullable<typeof toolset>).puppeteer).href)) as { launch(options: { executablePath: string; headless: boolean | "shell"; args: string[] }): Promise<Browser> };

    browser = await launch({ executablePath: executablePath as string, headless: isHeadlessShell(executablePath as string) ? "shell" : true, args: browserArguments() });

    const opened = await browser.newPage();

    await opened.goto(pathToFileURL(built.start).href);
    await opened.waitForSelector('body[data-diagrams="done"]', { timeout: 30_000 });

    answer = (await opened.evaluate(ASK)) as Answer;
  }, 60_000);

  // Not `browser.close()` alone: with the whole suite running it sometimes did not answer for ten seconds.
  afterAll(async () => {
    if (browser !== undefined) {
      await closeBrowser(browser);
    }
  });

  it("runs nothing the document wrote, when everything in the page is hovered over and clicked", () => {
    expect(answer.pwned).toBeNull();
  });

  it("holds no script, frame, form or handler that the document wrote", () => {
    expect(answer.scripts).toBe(0);
    expect(answer.forbidden).toEqual([]);
    expect(answer.handlers).toEqual([]);
    expect(answer.base).toBe(true);
  });

  it("has no link or picture that the browser reads as anything but a file of the copy or a web address", () => {
    expect(answer.schemes).toEqual(["file:", "https:"]);
  });

  it("names every link it would not follow", () => {
    expect(built.refused).toEqual([
      "javascript:window.pwned='a-link'",
      "JaVaScRiPt:window.pwned='a-link-spelled-oddly'",
      "javascript:window.pwned='an-autolink'",
      "data:image/svg+xml,<svg/onload=window.pwned='a-picture-made-of-data'>",
    ]);
  });

  it("still shows what a harmless document uses: a folded section, a picture with quotes in its alt text, a drawn diagram", () => {
    expect(answer.details).toBe(1);
    expect(answer.quoted).toBe(true);
    expect(answer.drawn).toBe(1);
    expect(page).toContain("<kbd>Esc</kbd>");
  });
});
