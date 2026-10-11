import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { listMarkdown, notRead, readDiagrams } from "./lib/blocks.mts";
import { CouldNotRun } from "./lib/outcome.mts";
import { createFolder, mermaid } from "./support.mts";

describe("the diagrams of a document", () => {
  it("are found with the line their fence opens on", () => {
    const text = ["# Title", "", mermaid("flowchart LR\n  a --> b"), "", "Text.", "", mermaid("sequenceDiagram\n  A->>B: hi")].join("\n");

    expect(readDiagrams(text)).toEqual([
      { line: 3, source: "flowchart LR\n  a --> b", closed: true },
      { line: 10, source: "sequenceDiagram\n  A->>B: hi", closed: true },
    ]);
  });

  it("do not include a block in another language", () => {
    expect(readDiagrams("```ts\nconst a = 1;\n```\n\n```\nflowchart LR\n```\n")).toEqual([]);
  });

  it("do not include a mermaid block that is shown inside a longer fence", () => {
    const text = ["````markdown", "```mermaid", "flowchart LR", "```", "````", "", mermaid("flowchart TD\n  x")].join("\n");

    expect(readDiagrams(text)).toEqual([{ line: 7, source: "flowchart TD\n  x", closed: true }]);
  });

  it("are found under a tilde fence and whatever the case of the word", () => {
    expect(readDiagrams("~~~Mermaid\nflowchart LR\n~~~\n")).toEqual([{ line: 1, source: "flowchart LR", closed: true }]);
  });

  it("say so when the file ends before the fence does", () => {
    expect(readDiagrams("Text\n\n```mermaid\nflowchart LR\n  a --> b\n")).toEqual([{ line: 3, source: "flowchart LR\n  a --> b\n", closed: false }]);
  });

  it("are not opened by backticks in the middle of a line", () => {
    expect(readDiagrams("Write ```mermaid to start one.\n")).toEqual([]);
  });
});

describe("the markdown files of a set", () => {
  const root = createFolder({
    "docs/b.md": "",
    "docs/a.md": "",
    "docs/deep/c.MD": "",
    "docs/picture.svg": "",
    "docs/node_modules/x/README.md": "",
    "other.md": "",
  });

  it("are every .md file under a folder, in a stable order, without installed packages", () => {
    expect(listMarkdown([join(root, "docs")])).toEqual([join(root, "docs/a.md"), join(root, "docs/b.md"), join(root, "docs/deep/c.MD")]);
  });

  it("are the file itself when a file is named, and each one once", () => {
    expect(listMarkdown([join(root, "other.md"), join(root, "docs"), join(root, "docs/a.md")])).toEqual([
      join(root, "docs/a.md"),
      join(root, "docs/b.md"),
      join(root, "docs/deep/c.MD"),
      join(root, "other.md"),
    ]);
  });

  it("refuse a path that is not there: a mistyped folder is not nothing to check", () => {
    expect(() => listMarkdown([join(root, "dcos")])).toThrow(CouldNotRun);
  });
});

describe("a symbolic link in a set", () => {
  const outside = createFolder({ "secret.md": "# Secret\n", "more/deep.md": "" });
  const root = createFolder({ "docs/a.md": "" });

  symlinkSync(join(outside, "secret.md"), join(root, "docs/linked.md"));
  symlinkSync(join(outside, "more"), join(root, "docs/linked-folder"));
  symlinkSync(join(outside, "gone.md"), join(root, "docs/dangling.md"));

  it("is never followed: a linked file is left out and named, and a linked folder is not entered", () => {
    const links: string[] = [];

    expect(listMarkdown([join(root, "docs")], links)).toEqual([join(root, "docs/a.md")]);
    expect(links.sort()).toEqual([join(root, "docs/dangling.md"), join(root, "docs/linked.md")]);
    expect(notRead(root, links.sort())).toBe("\n  not read, because a symbolic link is never followed: docs/dangling.md, docs/linked.md");
    expect(notRead(root, [])).toBe("");
  });

  it("is refused when it is named on the command line, as a file or as a folder", () => {
    expect(() => listMarkdown([join(root, "docs/linked.md")])).toThrow(/is a symbolic link, and a link is never followed/);
    expect(() => listMarkdown([join(root, "docs/linked-folder")])).toThrow(/is a symbolic link, and a link is never followed/);
    expect(() => listMarkdown([join(root, "docs/dangling.md")])).toThrow(/is a symbolic link/);
  });
});
