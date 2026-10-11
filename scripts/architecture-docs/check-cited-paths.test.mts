import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkCitedPaths, citedPaths, formatResult, parseArguments } from "./check-cited-paths.mts";
import { CouldNotRun } from "./lib/outcome.mts";
import { createFolder, initGit, SCRIPTS } from "./support.mts";

const script = join(SCRIPTS, "check-cited-paths.mts");
const top = new Set(["server", "client", "docs", "README.md"]);

describe("what counts as a cited path", () => {
  it("is a code span that starts with a name at the top of the repository and holds a slash", () => {
    expect(citedPaths("See `server/web.ts` and `client/features/chat/`.", top)).toEqual(["server/web.ts", "client/features/chat/"]);
  });

  it("is read without a line citation, a closing full stop or a leading ./", () => {
    expect(citedPaths("`server/web.ts:108`, `server/api.ts:12-40`, `./docs/a.md` and `server/x.ts.`", top)).toEqual(["server/web.ts", "server/api.ts", "docs/a.md", "server/x.ts"]);
  });

  it("is not a route, a dot-file, a placeholder, a glob, a command or a name with no slash", () => {
    expect(citedPaths("`GET /api/users` `/api/users` `.moi/widgets/a.tsx` `server/<name>/a.ts` `server/*.ts` `cd server/x` `README.md` `lib/x.ts`", top)).toEqual([]);
  });

  it("is not text outside a code span", () => {
    expect(citedPaths("The file server/web.ts is not in backticks.", top)).toEqual([]);
  });
});

describe("a set that cites only what is there", () => {
  const root = createFolder({
    "server/web.ts": "",
    "client/app/Router.tsx": "",
    "docs/architecture/01.md": "# One\n\n`server/web.ts` serves; `client/app/` routes; `server/web.ts:12` again.\n\n```ts\n// `server/gone.ts` in a code block is an example\n```\n",
  });

  initGit(root);

  it("passes, counts every citation, and finds the repository from the document", () => {
    const result = checkCitedPaths([join(root, "docs/architecture")]);

    expect(result.findings).toEqual([]);
    expect(formatResult(result)).toBe("PASS cited-paths — 3 cited path(s) in 1 markdown file(s) are in the repository");
  });
});

describe("a cited path that is not there", () => {
  const root = createFolder({
    "server/web.ts": "",
    "docs/a.md": "# A\n\nThe route table is in `server/routes.ts`.\n\nA comment points to `docs/old-plan.md`.\n",
  });

  it("is named with the file and line it is cited on, and what to do", () => {
    const result = checkCitedPaths([join(root, "docs")], { root });

    expect(result.findings).toEqual([
      {
        file: "docs/a.md",
        line: 3,
        message: "`server/routes.ts` is cited, and the repository has no such file or folder. Correct the path. If the document is saying that it is missing, run again with `--except server/routes.ts`.",
      },
      {
        file: "docs/a.md",
        line: 5,
        message: "`docs/old-plan.md` is cited, and the repository has no such file or folder. Correct the path. If the document is saying that it is missing, run again with `--except docs/old-plan.md`.",
      },
    ]);
    expect(formatResult(result).split("\n").at(-1)).toBe("2 of 2 cited path(s) in 1 markdown file(s) are not in the repository.");
  });

  it("passes when it is named as missing on purpose, and says which paths those were", () => {
    const result = checkCitedPaths([join(root, "docs")], { root, except: ["server/routes.ts", "docs/old-plan.md", "docs/never-cited.md"] });

    expect(result.findings).toEqual([]);
    expect(formatResult(result)).toBe("PASS cited-paths — 2 cited path(s) in 1 markdown file(s) are in the repository\n  missing, and said to be: docs/old-plan.md, server/routes.ts");
  });

  it("is still a finding when only another path is excepted", () => {
    expect(checkCitedPaths([join(root, "docs")], { root, except: ["docs/old-plan.md"] }).findings).toMatchObject([{ line: 3 }]);
  });
});

describe("nothing cited", () => {
  it("is a skip, not a pass", () => {
    const root = createFolder({ "server/a.ts": "", "docs/a.md": "# A\n\nNo path here.\n" });

    expect(formatResult(checkCitedPaths([join(root, "docs")], { root }))).toBe("SKIP cited-paths — no repository path is cited in 1 markdown file(s)");
  });
});

describe("a document that is a symbolic link", () => {
  it("is not read, and the result says so", () => {
    const outside = createFolder({ "private.md": "`server/gone.ts`\n" });
    const root = createFolder({ "server/web.ts": "", "docs/a.md": "`server/web.ts`\n" });

    symlinkSync(join(outside, "private.md"), join(root, "docs/linked.md"));

    const result = checkCitedPaths([join(root, "docs")], { root });

    expect(result.findings).toEqual([]);
    expect(formatResult(result)).toBe("PASS cited-paths — 1 cited path(s) in 1 markdown file(s) are in the repository\n  not read, because a symbolic link is never followed: docs/linked.md");
  });
});

describe("the command line", () => {
  it("takes documents, a root and any number of exceptions", () => {
    expect(parseArguments(["docs", "--root", ".", "--except", "a/b", "--except", "c/d"])).toEqual({ paths: ["docs"], root: ".", except: ["a/b", "c/d"] });
  });

  it("refuses to run with nothing named, with a flag it does not know, or with a flag and no value", () => {
    expect(() => parseArguments([])).toThrow(CouldNotRun);
    expect(() => parseArguments(["docs", "--strict"])).toThrow(CouldNotRun);
    expect(() => parseArguments(["docs", "--except"])).toThrow(CouldNotRun);
  });

  it("exits 1 on a missing path, 0 when it is excepted, and 2 when the folder is not there", () => {
    const root = createFolder({ "server/web.ts": "", "docs/a.md": "`server/gone.ts`\n" });
    const run = (...args: string[]): number | null => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd: root }).status;

    expect(run("docs", "--root", ".")).toBe(1);
    expect(run("docs", "--root", ".", "--except", "server/gone.ts")).toBe(0);
    expect(run("dcos", "--root", ".")).toBe(2);
  });
});
