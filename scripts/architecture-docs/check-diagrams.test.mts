import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkDiagrams, formatResult, inFileTerms, parseArguments } from "./check-diagrams.mts";
import { CouldNotRun } from "./lib/outcome.mts";
import { drawScript, MERMAID_SETUP, shortError, type Render } from "./lib/render.mts";
import { SITE_SCRIPT } from "./lib/site-assets.mts";
import { createFolder, mermaid, SCRIPTS } from "./support.mts";

const script = join(SCRIPTS, "check-diagrams.mts");

/** Renders everything, except a diagram whose source holds the word `broken`. */
const fake: Render = async (source) => (source.includes("broken") ? "Parse error on line 2" : undefined);

describe("a set whose diagrams all render", () => {
  const root = createFolder({
    "docs/01.md": `# One\n\n${mermaid("flowchart LR\n  a --> b")}\n`,
    "docs/02.md": `# Two\n\n${mermaid("flowchart TD\n  x")}\n\n${mermaid("sequenceDiagram\n  A->>B: hi")}\n`,
  });

  it("passes, and says how much it rendered", async () => {
    const result = await checkDiagrams([join(root, "docs")], () => fake, root);

    expect(result.findings).toEqual([]);
    expect(formatResult(result)).toBe("PASS diagrams — 3 diagram(s) in 2 markdown file(s) render");
  });

  it("gives each diagram a name of its own, safe in a file name", async () => {
    const names: string[] = [];

    await checkDiagrams([join(root, "docs")], () => async (_, name) => void names.push(name), root);

    expect(names).toEqual(["001-01-1", "002-02-1", "003-02-2"]);
  });
});

describe("a diagram that does not render", () => {
  const root = createFolder({
    "docs/01.md": `# One\n\n${mermaid("flowchart LR\n  a --> b")}\n\nText.\n\n${mermaid("flowchart LR\n  broken")}\n`,
  });

  it("is named by its file and the line its fence opens on, with what the renderer said", async () => {
    const result = await checkDiagrams([join(root, "docs")], () => fake, root);

    expect(result.findings).toEqual([{ file: "docs/01.md", line: 10, message: "Mermaid does not render it: Parse error on line 2 (line 12 of the file)" }]);
    expect(formatResult(result)).toBe(
      ["FAIL diagrams (1)", "  docs/01.md:10", "    Mermaid does not render it: Parse error on line 2 (line 12 of the file)", "", "1 of 2 diagram(s) in 1 markdown file(s) do not render."].join("\n"),
    );
  });
});

describe("what the renderer said", () => {
  it("names the line of the file, not the line of the diagram", async () => {
    const root = createFolder({ "a.md": `# A\n\nText.\n\n${mermaid("flowchart LR\n  a --> b\n  broken")}\n` });
    const result = await checkDiagrams([root], () => async () => "Parse error on line 3. Expecting 'SQE'", root);

    // The fence opens on line 5, so the diagram's third line is line 8.
    expect(result.findings).toEqual([{ file: "a.md", line: 5, message: "Mermaid does not render it: Parse error on line 3. Expecting 'SQE' (line 8 of the file)" }]);
  });

  it("is left as it is when it names no line", () => {
    expect(inFileTerms("No diagram type detected", 5)).toBe("No diagram type detected");
  });

  it("is cut to the verdict and what was expected", () => {
    const whole = ["Parse error on line 2:", "flowchart LR  a[unclosed", "---------------------^", "Expecting 'SQE', 'PE', got 'EOF'"].join("\n");

    expect(shortError(whole)).toBe("Parse error on line 2. Expecting 'SQE', 'PE', got 'EOF'");
    expect(shortError("No diagram type detected matching given configuration for text: x")).toBe("No diagram type detected matching given configuration for text: x");
    expect(shortError("")).toBe("it gave no reason");
  });

  it("is asked for in a way that makes a diagram Mermaid cannot read an error, with the source passed as data", () => {
    const script = drawScript('flowchart LR\n  a["`quoted`"] --> b', "diagram-1");

    expect(script).toContain('mermaid.render("diagram-1", "flowchart LR\\n  a[\\"`quoted`\\"] --> b")');
    expect(script).toContain("return { error:");
  });
});

describe("a diagram that is someone else's", () => {
  it("is drawn with Mermaid in strict mode, in the check and in the reading copy: a label is text, and a click runs nothing", () => {
    expect(MERMAID_SETUP).toContain('securityLevel: "strict"');
    expect(SITE_SCRIPT).toContain("securityLevel: 'strict'");
    expect(`${MERMAID_SETUP}${SITE_SCRIPT}`).not.toMatch(/securityLevel: ["'](?:loose|antiscript|sandbox)/);
  });
});

describe("a fence that is never closed", () => {
  it("is a finding, and is not handed to the renderer", async () => {
    const root = createFolder({ "a.md": "# A\n\n```mermaid\nflowchart LR\n" });
    let asked = 0;
    const result = await checkDiagrams([root], () => async () => void (asked += 1), root);

    expect(asked).toBe(0);
    expect(result.findings).toMatchObject([{ file: "a.md", line: 3 }]);
    expect(result.findings[0]?.message).toContain("never closed");
  });
});

describe("nothing to render", () => {
  it("is a skip, not a pass, and never asks for the renderer", async () => {
    const root = createFolder({ "a.md": "# A\n\nNo diagram.\n" });
    const result = await checkDiagrams([root], () => {
      throw new Error("the renderer was asked for");
    });

    expect(result.findings).toEqual([]);
    expect(formatResult(result)).toBe("SKIP diagrams — no mermaid diagram in 1 markdown file(s)");
  });

  it("says when there was no markdown file at all", async () => {
    expect(formatResult(await checkDiagrams([createFolder({ "a.txt": "" })], () => fake))).toBe("SKIP diagrams — no markdown file");
  });
});

describe("a document that is a symbolic link", () => {
  it("is not read, so what it points at is never rendered or quoted, and the result says so", async () => {
    const outside = createFolder({ "private.md": mermaid("flowchart LR\n  broken secret") });
    const root = createFolder({ "docs/a.md": mermaid("flowchart LR\n  a --> b") });

    symlinkSync(join(outside, "private.md"), join(root, "docs/linked.md"));

    const sources: string[] = [];
    const result = await checkDiagrams([join(root, "docs")], () => async (source) => void sources.push(source), root);

    expect(sources).toEqual(["flowchart LR\n  a --> b"]);
    expect(formatResult(result)).toBe("PASS diagrams — 1 diagram(s) in 1 markdown file(s) render\n  not read, because a symbolic link is never followed: docs/linked.md");
  });
});

describe("the command line", () => {
  it("takes folders and files, and a place to keep what it rendered", () => {
    expect(parseArguments(["docs/architecture", "README.md", "--keep", "/tmp/x"])).toEqual({ paths: ["docs/architecture", "README.md"], keep: "/tmp/x" });
    expect(parseArguments(["docs"])).toEqual({ paths: ["docs"] });
  });

  it("refuses to run with nothing named, with a flag it does not know, or with --keep and no folder", () => {
    expect(() => parseArguments([])).toThrow(CouldNotRun);
    expect(() => parseArguments(["docs", "--fast"])).toThrow(CouldNotRun);
    expect(() => parseArguments(["docs", "--keep"])).toThrow(CouldNotRun);
  });

  it("exits 2, fetching nothing, when the folder is not there", () => {
    const ran = spawnSync(process.execPath, [script, "no-such-folder"], { encoding: "utf8", cwd: createFolder(), env: { ...process.env, XDG_CACHE_HOME: createFolder() } });

    expect(ran.status).toBe(2);
    expect(ran.stderr).toBe("check-diagrams could not run: no-such-folder does not exist\n");
  });

  it("exits 0 with a SKIP, fetching nothing, when there is no diagram", () => {
    const cache = createFolder();
    const ran = spawnSync(process.execPath, [script, createFolder({ "a.md": "# A\n" })], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: cache } });

    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe("SKIP diagrams — no mermaid diagram in 1 markdown file(s)\n");
    expect(ran.stderr).toBe("");
  });
});
