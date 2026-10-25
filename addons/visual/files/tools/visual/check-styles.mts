#!/usr/bin/env node
// Checks that the client's entry loads no stylesheet or font except index.css.
//
//   node tools/visual/check-styles.mts
//
// The visual host loads the app's `index.css` and nothing else the entry
// (`main.tsx`) imports. A font imported in `main.tsx` is in the app and
// missing from every picture: they are drawn in the fallback face, and
// nothing fails. In one project that was 1,046 goldens in the wrong font.
//
// Move such an import into `index.css` (`@import` or `@font-face`), the one
// file both the app and the host load.
//
// Exit 0: the entry imports no other stylesheet or font (or SKIP: there is
// no entry). 1: it imports one. 2: the entry could not be read.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GATE = "visual-styles";
const ENTRY = "packages/client-react/src/main.tsx";

/** The only stylesheet the host loads. */
const ALLOWED = new Set(["./index.css", "#/index.css"]);

/** `import "x"`, `import y from "x"`, `import { y } from "x"`, `import("x")`, and `export * from "x"` or `export { y } from "x"`. */
const IMPORT = /\b(?:import|export)\s*(?:[^'"();]*?\bfrom\s*)?\(?\s*(["'`])([^"'`\n]*)\1/g;

/** `import.meta.glob("x")` and `import.meta.glob(["x", "y"])`: Vite's imports by pattern. */
const GLOB = /\bimport\.meta\.glob\s*(?:<[^>]*>)?\(\s*(\[[^\]]*\]|(["'`])[^"'`\n]*\2)/g;

/** A quoted string, in a glob's argument. */
const STRING = /(["'`])([^"'`\n]*)\1/g;

/** A stylesheet or a font: by extension (after any `?inline` or `?url`), or from `@fontsource`. */
const STYLE_OR_FONT = /\.(css|scss|woff2?)$|@fontsource/;

export interface StylesVerdict {
  exitCode: 0 | 1 | 2;
  lines: string[];
}

export function checkStyles(root: string): StylesVerdict {
  const path = join(root, ENTRY);

  if (!existsSync(path)) {
    return { exitCode: 0, lines: [`SKIP ${GATE}: ${ENTRY} does not exist, so there was nothing to check.`] };
  }

  let text: string;

  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { exitCode: 2, lines: [`${GATE} could not run:`, `  ${ENTRY}: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const findings: string[] = [];
  const code = withoutComments(text);
  const imports = [
    ...[...code.matchAll(IMPORT)].map((match) => ({ specifier: match[2] ?? "", index: match.index })),
    // A pattern that starts with `!` leaves files out, so it loads nothing.
    ...[...code.matchAll(GLOB)].flatMap((match) =>
      [...(match[1] ?? "").matchAll(STRING)].map((string) => ({ specifier: string[2] ?? "", index: match.index })).filter(({ specifier }) => !specifier.startsWith("!")),
    ),
  ].sort((a, b) => a.index - b.index);

  for (const { specifier, index } of imports) {
    const target = specifier.split("?")[0] ?? specifier;

    if (ALLOWED.has(target) || !STYLE_OR_FONT.test(target)) {
      continue;
    }

    const line = text.slice(0, index).split("\n").length;

    findings.push(
      `${ENTRY}:${line}: imports "${specifier}". The visual host loads index.css and nothing else the entry imports, so every picture would be drawn without it (a font falls back to another face). Move it into index.css, which the app and the host both load.`,
    );
  }

  if (findings.length > 0) {
    return { exitCode: 1, lines: [`FAIL ${GATE}`, ...findings.map((finding) => `  ${finding}`)] };
  }

  return { exitCode: 0, lines: [`PASS ${GATE}: main.tsx loads no stylesheet or font besides index.css.`] };
}

/** The text with `//` and block comments blanked, so lines still count the same. A string is kept whole, so a `//` in a URL is not a comment. */
function withoutComments(text: string): string {
  return text.replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (found, string?: string) =>
    string === undefined ? found.replace(/[^\n]/g, " ") : found,
  );
}

/** True when Node was asked to run this file. Real paths, so a symlinked copy still runs. */
function isMainModule(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  const verdict = checkStyles(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

  console.log(verdict.lines.join("\n"));
  process.exit(verdict.exitCode);
}
