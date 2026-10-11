// The stylesheet and the browser script of the reading copy, as text.
//
// They are written into every page, so a page is one file that opens from disk
// with nothing to fetch. They are kept here as strings, not as `.css` and
// `.js` files: this repository holds TypeScript only.
//
// `String.raw` keeps a backslash as written (the script has a regular
// expression in it). Neither text may hold a backtick or `${`.

/** Light and dark follow the reader's system. The diagrams bring their own colours. */
export const SITE_CSS = String.raw`
:root {
  --bg: #ffffff;
  --panel: #f6f8fa;
  --text: #1f2328;
  --muted: #59636e;
  --border: #d1d9e0;
  --link: #0969da;
  --accent: #238636;
  --code-bg: #f6f8fa;
  --row: #f6f8fa;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --panel: #151b23;
    --text: #e6edf3;
    --muted: #9198a1;
    --border: #3d444d;
    --link: #4493f8;
    --accent: #3fb950;
    --code-bg: #151b23;
    --row: #151b23;
  }
}
* {
  box-sizing: border-box;
}
html {
  scroll-padding-top: 16px;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font:
    16px/1.6 -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Helvetica,
    Arial,
    sans-serif;
}
a {
  color: var(--link);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}

.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 290px;
  overflow-y: auto;
  padding: 20px 14px 32px;
  background: var(--panel);
  border-right: 1px solid var(--border);
}
.brand {
  display: block;
  padding: 0 10px 14px;
  font-weight: 700;
  font-size: 20px;
  color: var(--text);
}
.chapters a {
  display: block;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.35;
}
.chapters a:hover {
  background: var(--bg);
  text-decoration: none;
}
.chapters a.current {
  background: var(--bg);
  box-shadow: inset 3px 0 0 var(--accent);
  font-weight: 600;
}
.hint {
  margin: 18px 10px 0;
  font-size: 12px;
  color: var(--muted);
}

main {
  margin-left: 290px;
  padding: 28px 40px 80px;
}
article,
.pager {
  max-width: 980px;
  margin: 0 auto;
}
article > p:first-child {
  font-size: 13px;
  color: var(--muted);
}
h1,
h2,
h3,
h4 {
  line-height: 1.25;
  margin: 1.8em 0 0.6em;
}
h1 {
  font-size: 2em;
  margin-top: 0.2em;
}
h2 {
  font-size: 1.6em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}
h3 {
  font-size: 1.25em;
}
h4 {
  font-size: 1.05em;
}
.anchor {
  color: inherit;
}
.anchor:hover {
  text-decoration: none;
}
.anchor:hover::after {
  content: ' #';
  color: var(--muted);
  font-weight: 400;
}
code {
  font:
    0.875em ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0.1em 0.35em;
}
pre.code {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
  line-height: 1.45;
}
pre.code code {
  background: none;
  border: 0;
  padding: 0;
}
blockquote {
  margin: 1em 0;
  padding: 0.2em 1em;
  border-left: 4px solid var(--border);
  color: var(--muted);
}
img {
  max-width: 100%;
  border-radius: 10px;
}

.table-wrap {
  overflow-x: auto;
  margin: 1em 0;
}
table {
  border-collapse: collapse;
  font-size: 14.5px;
  min-width: 100%;
}
th,
td {
  border: 1px solid var(--border);
  padding: 7px 11px;
  text-align: left;
  vertical-align: top;
}
th {
  background: var(--panel);
  font-weight: 600;
}
tbody tr:nth-child(even) {
  background: var(--row);
}

.diagram {
  margin: 1.4em 0;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow-x: auto;
  text-align: center;
  cursor: zoom-in;
  min-height: 60px;
}
.diagram pre.mermaid {
  margin: 0;
  background: none;
}
.diagram pre.mermaid:not([data-processed]) {
  color: var(--muted);
  font-size: 12px;
  text-align: left;
  white-space: pre;
  max-height: 120px;
  overflow: hidden;
}
.diagram svg {
  max-width: 100%;
  height: auto;
}

.pager {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 56px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  font-size: 14px;
}

.lightbox {
  position: fixed;
  inset: 0;
  background: var(--bg);
  overflow: auto;
  padding: 24px;
  cursor: zoom-out;
}
.lightbox[hidden] {
  display: none;
}
.lightbox-inner {
  min-width: min-content;
  text-align: center;
}
.lightbox-inner svg {
  max-width: none !important;
}

.menu {
  display: none;
}
@media (max-width: 900px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.15s;
    box-shadow: 0 0 24px rgb(0 0 0 / 0.25);
  }
  body.nav-open .sidebar {
    transform: none;
  }
  main {
    margin-left: 0;
    padding: 56px 16px 64px;
  }
  .menu {
    display: block;
    position: fixed;
    top: 10px;
    left: 10px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    color: var(--text);
    font: inherit;
    font-size: 14px;
  }
}
@media print {
  .sidebar,
  .menu,
  .pager {
    display: none;
  }
  main {
    margin: 0;
    padding: 0;
  }
}
`;

/**
 * Marks the current chapter, draws the diagrams one at a time (so a chapter
 * with many never blocks the page), scrolls back to the anchor once they are
 * drawn (drawing changes heights), and shows a clicked diagram at full size.
 */
export const SITE_SCRIPT = String.raw`
;(function () {
  var page = document.body.dataset.page
  document.querySelectorAll('.chapters a').forEach(function (a) {
    if (a.dataset.page === page) a.classList.add('current')
  })

  var menu = document.querySelector('.menu')
  menu.addEventListener('click', function () {
    document.body.classList.toggle('nav-open')
  })
  document.querySelector('main').addEventListener('click', function () {
    document.body.classList.remove('nav-open')
  })

  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' })

  // Draw the diagrams one at a time, top to bottom, yielding between them so
  // the page stays responsive. Drawing changes heights, so a link that landed
  // on an anchor is scrolled back to its target once everything is drawn.
  var queue = Promise.resolve()
  document.querySelectorAll('pre.mermaid').forEach(function (el) {
    queue = queue
      .then(function () {
        return mermaid.run({ nodes: [el] })
      })
      .catch(function (err) {
        el.textContent = 'Could not draw this diagram: ' + (err && err.message ? err.message : err)
        el.setAttribute('data-processed', 'error')
      })
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(resolve, 0)
        })
      })
  })
  queue.then(function () {
    document.body.setAttribute('data-diagrams', 'done')
    if (!location.hash) return
    var target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
    if (target) target.scrollIntoView()
  })

  // Click a diagram to see it at full size.
  var box = document.querySelector('.lightbox')
  var inner = box.querySelector('.lightbox-inner')
  document.addEventListener('click', function (event) {
    var fig = event.target.closest && event.target.closest('.diagram')
    if (!fig) return
    var svg = fig.querySelector('svg')
    if (!svg) return
    var copy = svg.cloneNode(true)
    copy.removeAttribute('style')
    var vb = (svg.getAttribute('viewBox') || '').split(/\s+/)
    if (vb.length === 4) {
      var scale = Math.max(1, Math.min(2, (window.innerWidth - 48) / Number(vb[2])))
      copy.setAttribute('width', Math.round(Number(vb[2]) * scale))
      copy.setAttribute('height', Math.round(Number(vb[3]) * scale))
    }
    inner.replaceChildren(copy)
    box.hidden = false
  })
  box.addEventListener('click', function () {
    box.hidden = true
  })
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') box.hidden = true
  })
})()
`;
