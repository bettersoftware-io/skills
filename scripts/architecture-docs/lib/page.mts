// Turns the HTML a markdown converter gives into a page of the reading copy:
// diagrams become figures the browser draws, headings get the anchors GitHub
// would give them, and links are pointed at where things are in the copy.
//
// Everything here works on text. The converter is not imported: a caller hands
// in what it produced, so this file needs nothing installed and its tests run
// anywhere.

import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { createSlugger } from "../../../addons/repo-hygiene/files/tools/repo-hygiene/lib/slug.mts";

/**
 * The page a document becomes, as a path from the copy's top. `README.md` is
 * what a folder opens on, so it becomes that folder's `index.html`.
 */
export function pageName(source: string): string {
  const posix = source.split(sep).join("/");
  const folder = posix.includes("/") ? `${posix.slice(0, posix.lastIndexOf("/"))}/` : "";
  const name = posix.slice(folder.length).replace(/\.md$/i, "");

  return `${folder}${/^readme$/i.test(name) ? "index" : name}.html`;
}

/** The text of the document's first heading, as a reader sees it, or undefined. */
export function titleOf(html: string): string | undefined {
  const heading = /<h[1-6](?:\s[^>]*)?>([\s\S]*?)<\/h[1-6]>/.exec(html);

  return heading === null ? undefined : plain(heading[1] as string).trim();
}

/** What is left of a piece of HTML when the tags go and the entities are read. */
export function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface PageContext {
  /** The markdown file this page is made from. Absolute. */
  source: string;
  /** Every document of the set: absolute path → page, from the copy's top. */
  pages: Map<string, string>;
  /** The folder that holds the set. A file under it that is not a document is copied beside the pages. */
  root: string;
  /** What a link to a file outside the set becomes. Given the file's absolute path. */
  outside: (path: string) => string;
}

/**
 * A ```mermaid block as the converter leaves it (`<pre><code
 * class="language-mermaid">`) becomes a figure the page's script draws. The
 * source stays escaped: the script reads it as text.
 */
export function withDiagrams(html: string): string {
  return html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_, source: string) => `<figure class="diagram"><pre class="mermaid">${source.replace(/\n$/, "")}</pre></figure>`);
}

/** How many diagrams a finished page holds. */
export function countDiagrams(html: string): number {
  return html.split('<pre class="mermaid">').length - 1;
}

/**
 * Every heading gets the anchor GitHub gives it, so a link written for GitHub
 * (`chapter.md#21-level-1--context`) lands in the copy too. Headings must be
 * read in order: a repeated one gets `-1`, `-2`.
 */
export function withAnchors(html: string): string {
  const nextAnchor = createSlugger();

  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, level: string, inner: string) => {
    const anchor = nextAnchor(plain(inner));

    return `<h${level} id="${escapeHtml(anchor)}"><a class="anchor" href="#${escapeHtml(anchor)}">${inner}</a></h${level}>`;
  });
}

/** `https:`, `mailto:`, `//host`: somewhere else. */
function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function posix(path: string): string {
  return path.split(sep).join("/");
}

/** Where `target`, written in `source`, leads in the copy. */
export function rewriteTarget(target: string, { source, pages, root, outside }: PageContext): string {
  if (target === "" || target.startsWith("#") || isExternal(target)) {
    return target;
  }

  const at = target.indexOf("#");
  const path = at === -1 ? target : target.slice(0, at);
  const anchor = at === -1 ? "" : target.slice(at);
  const file = resolve(dirname(source), decode(path.replace(/\?.*$/, "")));
  const here = dirname(pages.get(source) ?? "index.html");
  const page = pages.get(file);

  if (page !== undefined) {
    return `${posix(relative(here, page))}${anchor}`;
  }

  const inSet = relative(root, file);

  // A picture or a data file of the set: copied to the same place under the copy's top.
  if (inSet !== "" && !inSet.startsWith("..") && !isAbsolute(inSet)) {
    return `${posix(relative(here, inSet))}${anchor}`;
  }

  return `${outside(file)}${anchor}`;
}

/** Points every link and picture of the page at its place in the copy. A link that leaves the copy opens in a new tab. */
export function withLinks(html: string, context: PageContext): string {
  return html
    .replace(/<a href="([^"]*)"/g, (_, href: string) => {
      const target = rewriteTarget(plain(href), context);

      return `<a ${isExternal(target) ? 'target="_blank" rel="noopener" ' : ""}href="${escapeHtml(target)}"`;
    })
    .replace(/<img src="([^"]*)"/g, (_, src: string) => `<img src="${escapeHtml(rewriteTarget(plain(src), context))}"`);
}

/** A wide table scrolls in its own box, not the page. */
export function withTables(html: string): string {
  return html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
}

/** The body of a page, from what the converter produced. */
export function finishBody(html: string, context: PageContext): string {
  return withTables(withLinks(withAnchors(withDiagrams(html)), context));
}

export interface NavEntry {
  /** From the copy's top. */
  page: string;
  title: string;
}

export interface Page {
  /** From the copy's top. */
  page: string;
  title: string;
  /** The name of the whole set, shown at the top of the list of chapters. */
  site: string;
  body: string;
  nav: NavEntry[];
  css: string;
  script: string;
}

/** `../` once for every folder between the page and the copy's top. */
function toTop(page: string): string {
  return "../".repeat(page.split("/").length - 1);
}

/** One whole page: the list of chapters, the body, and a way to the next and the previous. */
export function pageHtml({ page, title, site, body, nav, css, script }: Page): string {
  const top = toTop(page);
  const index = nav.findIndex((entry) => entry.page === page);
  const previous = index > 0 ? nav[index - 1] : undefined;
  const next = index === -1 ? undefined : nav[index + 1];
  const link = (entry: NavEntry, text: string): string => `<a href="${escapeHtml(top + entry.page)}">${text}</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title === site ? site : `${title} · ${site}`)}</title>
<style>${css}</style>
</head>
<body data-page="${escapeHtml(page)}">
  <button class="menu" aria-label="Show chapters">☰ Chapters</button>
  <aside class="sidebar">
    <a class="brand" href="${escapeHtml(top + (nav[0]?.page ?? "index.html"))}">${escapeHtml(site)}</a>
    <nav class="chapters">
${nav.map((entry) => `      <a href="${escapeHtml(top + entry.page)}" data-page="${escapeHtml(entry.page)}">${escapeHtml(entry.title)}</a>`).join("\n")}
    </nav>
    <p class="hint">Click any diagram to enlarge it. Press Esc to close.</p>
  </aside>
  <main>
    <article>
${body}
    </article>
    <nav class="pager">${previous === undefined ? "<span></span>" : link(previous, `← ${escapeHtml(previous.title)}`)}${next === undefined ? "<span></span>" : link(next, `${escapeHtml(next.title)} →`)}</nav>
  </main>
  <div class="lightbox" hidden><div class="lightbox-inner"></div></div>
  <script src="${escapeHtml(top)}mermaid.min.js"></script>
  <script>${script}</script>
</body>
</html>
`;
}
