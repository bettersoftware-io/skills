// Draws mermaid diagrams the way a reader's page does: Mermaid's own bundle,
// in a real browser.
//
// One browser is started for a whole run, and every diagram is drawn in one
// page of it. Mermaid's command line starts a browser per diagram instead: a
// set of ninety diagrams was ninety browsers, four at a time, on the machine
// of the person waiting. That is why it is not used.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CouldNotRun } from "./outcome.mts";
import { NO_BROWSER, browserArguments, ensureToolset, findBrowser, isHeadlessShell, type Toolset } from "./tools.mts";

/**
 * Renders one diagram. Resolves to undefined when it rendered, and to what the
 * renderer said when it did not. `name` is unique in a run and safe in a file
 * name. Replaced by a fake in tests.
 */
export type Render = (source: string, name: string) => Promise<string | undefined>;

// The few things used of the browser library. It is fetched, not installed
// here, so its own types are not there to import.
interface BrowserPage {
  setContent(html: string): Promise<void>;
  addScriptTag(options: { path: string }): Promise<unknown>;
  evaluate(script: string): Promise<unknown>;
}

interface Browser {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface BrowserLibrary {
  launch(options: { executablePath: string; headless: boolean | "shell"; args: string[] }): Promise<Browser>;
}

/**
 * How Mermaid is set up in the page. `strict`: a label is text, and a diagram
 * cannot bind a click to a script. It is Mermaid's default; it is written out
 * so that it stays, because the diagrams drawn here may be someone else's.
 * `suppressErrorRendering`: a diagram it cannot read throws.
 */
export const MERMAID_SETUP = 'mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true, securityLevel: "strict" })';

/** What the page answers for one diagram. */
interface Drawn {
  svg?: string;
  error?: string;
}

/**
 * The script the page runs for one diagram. With `suppressErrorRendering` a
 * diagram Mermaid cannot read throws, where it would otherwise draw a picture
 * of a bomb and report success.
 */
export function drawScript(source: string, id: string): string {
  return `(async () => {
  try {
    const { svg } = await mermaid.render(${JSON.stringify(id)}, ${JSON.stringify(source)});
    return { svg };
  } catch (error) {
    for (const leftover of document.querySelectorAll("#" + ${JSON.stringify(id)} + ", #d" + ${JSON.stringify(id)})) leftover.remove();
    return { error: String((error && error.message) || error) };
  }
})()`;
}

/** Mermaid's error is several lines: the verdict, the text, a pointer, what it expected. The first and the last say it. */
export function shortError(error: string): string {
  const lines = error
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^-*\^$/.test(line));
  const first = lines[0] ?? "it gave no reason";
  const expected = lines.find((line) => /^Expecting /.test(line));

  return expected === undefined ? first : `${first.replace(/:$/, "")}. ${expected.length > 160 ? `${expected.slice(0, 160)}…` : expected}`;
}

/**
 * Starts the browser and loads Mermaid into a page. `keep` is a folder the
 * drawn SVG files are written to; without it they are thrown away. `done`
 * closes the browser and must be called.
 */
export async function createRenderer(keep?: string, toolset: Toolset = ensureToolset()): Promise<{ render: Render; done: () => Promise<void> }> {
  const executablePath = findBrowser();

  if (executablePath === undefined) {
    throw new CouldNotRun(NO_BROWSER);
  }

  const { launch } = (await import(pathToFileURL(toolset.puppeteer).href)) as BrowserLibrary;
  let browser: Browser;

  try {
    browser = await launch({ executablePath, headless: isHeadlessShell(executablePath) ? "shell" : true, args: browserArguments() });
  } catch (error) {
    throw new CouldNotRun(`the browser at ${executablePath} did not start: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}`);
  }

  const page = await browser.newPage();

  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: toolset.mermaidBundle });
  await page.evaluate(MERMAID_SETUP);

  const out = keep === undefined ? undefined : resolve(keep);

  if (out !== undefined) {
    mkdirSync(out, { recursive: true });
  }

  let drawn = 0;

  const render: Render = async (source, name) => {
    drawn += 1;

    const answer = (await page.evaluate(drawScript(source, `diagram-${drawn}`))) as Drawn;

    if (answer.error !== undefined || answer.svg === undefined) {
      return shortError(answer.error ?? "");
    }

    if (out !== undefined) {
      writeFileSync(join(out, `${name}.svg`), answer.svg);
    }

    return undefined;
  };

  return { render, done: () => browser.close() };
}
