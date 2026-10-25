import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkStyles } from "../files/tools/visual/check-styles.mts";

const ADDON = join(import.meta.dirname, "..");
const REPO = join(ADDON, "..", "..");
const MAIN = "packages/client-react/src/main.tsx";

function verdictOf(main: string): { exitCode: number; text: string } {
  const { exitCode, lines } = checkStyles(createProject({ [MAIN]: main }));

  return { exitCode, text: lines.join("\n") };
}

describe("the entry the starter ships", () => {
  it("imports only index.css and passes", () => {
    const main = readFileSync(join(REPO, "starter", MAIN), "utf8");

    expect(verdictOf(main)).toEqual({ exitCode: 0, text: "PASS visual-styles: main.tsx loads no stylesheet or font besides index.css." });
  });
});

describe("a stylesheet or font imported by the entry", () => {
  it("fails a stylesheet, naming the file and line, and says to move it into index.css", () => {
    const { exitCode, text } = verdictOf('import { startApp } from "./app/startApp.tsx";\n\nimport "./fonts.css";\nimport "./index.css";\n');

    expect(exitCode).toBe(1);
    expect(text).toContain("FAIL visual-styles");
    expect(text).toContain(`${MAIN}:3: imports "./fonts.css"`);
    expect(text).toContain("index.css");
    expect(text).toContain("Move it into index.css");
  });

  it.each([
    'import "@fontsource/inter/400.css";',
    'import "@fontsource-variable/inter";',
    'import "./theme.scss";',
    'import "./a.woff";',
    'import "./a.woff2";',
    'import "./fonts.css?inline";',
    'import fonts from "./fonts.css?url";',
    'const fonts = import("./fonts.css");',
    "import './single.css';",
    'export * from "./fonts.css";',
    'export { default as fonts } from "./fonts.css?url";',
    'import.meta.glob("./styles/*.css", { eager: true });',
    'import.meta.glob(["./a.ts", "./styles/*.css"], { eager: true });',
    'const home = "https://example.com"; import "./fonts.css";',
  ])("fails: %s", (line) => {
    expect(verdictOf(`${line}\n`).exitCode).toBe(1);
  });

  it("judges every import, and counts lines from 1", () => {
    const { text } = verdictOf('import "./a.css";\nimport "./index.css";\nimport "./b.css";\n');

    expect(text).toContain(`${MAIN}:1:`);
    expect(text).toContain(`${MAIN}:3:`);
    expect(text).not.toContain(`${MAIN}:2:`);
  });
});

describe("imports that are fine", () => {
  it.each([
    'import "./index.css";',
    'import "#/index.css";',
    'import x from "./logo.svg";',
    'import { a } from "./css-utils.ts";',
    'import "./index.css?inline";',
    'export { startApp } from "./app/startApp.tsx";',
    'import.meta.glob("./pages/*.tsx");',
    'import.meta.glob(["./pages/*.tsx", "!./pages/*.css"]);',
  ])("passes: %s", (line) => {
    expect(verdictOf(`${line}\n`).exitCode).toBe(0);
  });

  it("does not read a comment as an import", () => {
    expect(verdictOf('// import "./fonts.css";\n').exitCode).toBe(0);
    expect(verdictOf('/* import "./fonts.css"; */\n').exitCode).toBe(0);
    expect(verdictOf('const home = "https://example.com"; // import "./fonts.css";\n').exitCode).toBe(0);
  });
});

describe("nothing to judge", () => {
  it("says SKIP when the project has no entry", () => {
    expect(checkStyles(createProject({ "package.json": "{}" }))).toEqual({
      exitCode: 0,
      lines: [`SKIP visual-styles: ${MAIN} does not exist, so there was nothing to check.`],
    });
  });

  it("could not run when the entry cannot be read", () => {
    const verdict = checkStyles(createProject({ [`${MAIN}/inner.txt`]: "" }));

    expect(verdict.exitCode).toBe(2);
    expect(verdict.lines[0]).toBe("visual-styles could not run:");
  });
});

describe("the script", () => {
  it("judges the project it is installed in, and exits with the verdict", () => {
    const bad = createProject({ [MAIN]: 'import "./fonts.css";\n' });
    const good = createProject({ [MAIN]: 'import "./index.css";\n' });

    for (const root of [bad, good]) {
      cpSync(join(ADDON, "files/tools"), join(root, "tools"), { recursive: true });
    }

    const run = (root: string) => spawnSync(process.execPath, ["tools/visual/check-styles.mts"], { cwd: root, encoding: "utf8" });

    expect(run(bad).status).toBe(1);
    expect(run(bad).stdout).toContain("FAIL visual-styles");
    expect(run(good).status).toBe(0);
  });
});

describe("the add-on's manifest", () => {
  const manifest = JSON.parse(readFileSync(join(ADDON, "addon.json"), "utf8")) as {
    packageJson: Record<string, { scripts?: Record<string, string> }>;
    gates: { fast: string[] };
  };

  it("runs the check in gate:fast, as a script of its own", () => {
    expect(manifest.packageJson["."]?.scripts?.["visual:check:styles"]).toBe("node tools/visual/check-styles.mts");
    expect(manifest.gates.fast).toContain("pnpm visual:check:styles");
  });
});

const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "visual-styles-"));

  scratch.push(root);

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  return root;
}
