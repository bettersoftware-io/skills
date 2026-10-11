import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CouldNotRun } from "./lib/outcome.mts";
import { browserArguments, cacheFolder, ensureToolset, findBrowser, isHeadlessShell, toolsetKey, type RunCommand } from "./lib/tools.mts";
import { createFolder, SCRIPTS } from "./support.mts";

const LOCK = readFileSync(join(SCRIPTS, "toolset", "toolset.lock.json"), "utf8");

/** An `npm ci` that writes the three files the scripts look for, and remembers how it was asked. */
function fakeNpm(calls: { command: string; args: string[]; cwd: string }[] = []): RunCommand {
  return (command, args, { cwd }) => {
    calls.push({ command, args, cwd });

    for (const path of ["mermaid/dist/mermaid.min.js", "puppeteer-core/lib/puppeteer/puppeteer-core.js", "marked/lib/marked.esm.js"]) {
      mkdirSync(join(cwd, "node_modules", path, ".."), { recursive: true });
      writeFileSync(join(cwd, "node_modules", path), "");
    }

    return { status: 0, stdout: "", stderr: "" };
  };
}

describe("where fetched tools are kept", () => {
  it("is the cache folder the system names, and ~/.cache when it names none", () => {
    expect(cacheFolder({ XDG_CACHE_HOME: "/x/cache" }, "/home/a", "linux")).toBe("/x/cache/bettersoftware-skills/architecture-docs");
    expect(cacheFolder({}, "/home/a", "linux")).toBe("/home/a/.cache/bettersoftware-skills/architecture-docs");
    expect(cacheFolder({ LOCALAPPDATA: "/local" }, "/home/a", "win32")).toBe(join("/local", "bettersoftware-skills", "architecture-docs"));
  });

  it("has one folder for each set of pinned versions", () => {
    expect(toolsetKey(LOCK)).toMatch(/^[0-9a-f]{16}$/);
    expect(toolsetKey(`${LOCK} `)).not.toBe(toolsetKey(LOCK));
  });
});

describe("the pinned versions", () => {
  const manifest = JSON.parse(readFileSync(join(SCRIPTS, "toolset", "toolset.json"), "utf8")) as { dependencies: Record<string, string> };
  const lock = JSON.parse(LOCK) as { packages: Record<string, { version?: string; integrity?: string }> };

  it("are exact, never a range", () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual(["marked", "mermaid", "puppeteer-core"]);

    for (const version of Object.values(manifest.dependencies)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("are the versions the lockfile holds, each with the hash it is checked against", () => {
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      expect(lock.packages[`node_modules/${name}`]?.version).toBe(version);
    }

    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path !== "") {
        expect(entry.integrity, path).toMatch(/^sha512-/);
      }
    }
  });
});

describe("fetching the tools", () => {
  it("installs from the lockfile, runs no package's script, and says once that it is fetching", () => {
    const cache = createFolder();
    const calls: { command: string; args: string[]; cwd: string }[] = [];
    const said: string[] = [];
    const toolset = ensureToolset({ env: {}, cache, run: fakeNpm(calls), announce: (message) => said.push(message) });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: "npm", args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"] });
    expect(toolset.folder).toBe(join(cache, "tools", toolsetKey(LOCK)));
    expect(readFileSync(join(toolset.folder, "package-lock.json"), "utf8")).toBe(LOCK);
    expect(existsSync(toolset.mermaidBundle) && existsSync(toolset.puppeteer) && existsSync(toolset.marked)).toBe(true);
    expect(said).toEqual([`Fetching the tools into ${toolset.folder} (once per machine; needs the network) …`]);
  });

  it("fetches nothing the second time", () => {
    const cache = createFolder();
    const calls: { command: string; args: string[]; cwd: string }[] = [];

    ensureToolset({ env: {}, cache, run: fakeNpm(calls), announce: () => {} });
    ensureToolset({
      env: {},
      cache,
      run: () => {
        throw new Error("npm was run again");
      },
      announce: () => {
        throw new Error("a fetch was announced again");
      },
    });

    expect(calls).toHaveLength(1);
  });

  it("leaves no folder that looks finished when the fetch fails, and says why", () => {
    const cache = createFolder();
    const failing: RunCommand = () => ({ status: 1, stdout: "", stderr: "\nnpm error code ENOTFOUND\nnpm error network\n" });

    expect(() => ensureToolset({ env: {}, cache, run: failing, announce: () => {} })).toThrow(new CouldNotRun("the tools could not be fetched: npm error code ENOTFOUND They are fetched once, from the npm registry."));
    expect(existsSync(join(cache, "tools")) ? readdirSync(join(cache, "tools")) : []).toEqual([]);
  });

  it("says so when npm itself is not there", () => {
    const missing: RunCommand = () => ({ status: null, stdout: "", stderr: "", error: new Error("spawnSync npm ENOENT") });

    expect(() => ensureToolset({ env: {}, cache: createFolder(), run: missing, announce: () => {} })).toThrow(/npm did not start \(spawnSync npm ENOENT\)/);
  });

  it("uses a folder a person names, and refuses one that does not hold the tools", () => {
    const given = createFolder();

    fakeNpm()("npm", [], { cwd: given, env: {} });

    expect(ensureToolset({ env: { ARCHITECTURE_DOCS_TOOLSET: given }, cache: createFolder(), run: () => { throw new Error("npm was run"); } }).folder).toBe(given);
    expect(() => ensureToolset({ env: { ARCHITECTURE_DOCS_TOOLSET: createFolder() }, cache: createFolder() })).toThrow(CouldNotRun);
  });
});

describe("the browser diagrams are drawn in", () => {
  const shell = "/home/a/.cache/puppeteer/chrome-headless-shell/linux-150.0/chrome-headless-shell-linux64/chrome-headless-shell";
  const older = "/home/a/.cache/puppeteer/chrome-headless-shell/linux-149.0/chrome-headless-shell-linux64/chrome-headless-shell";
  const downloadedChrome = "/home/a/.cache/puppeteer/chrome/linux-150.0/chrome-linux64/chrome";
  const installed = "/usr/bin/chromium";

  /** A machine that has exactly `paths`. */
  function machine(...paths: string[]): [(path: string) => boolean, (folder: string) => string[]] {
    return [
      (path) => paths.includes(path),
      (folder) => [...new Set(paths.filter((path) => path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1).split("/")[0] as string))],
    ];
  }

  it("is the one a person named, and nothing else when that one is not there", () => {
    expect(findBrowser({ ARCHITECTURE_DOCS_BROWSER: installed }, "linux", "/home/a", ...machine(installed, shell))).toBe(installed);
    expect(findBrowser({ CHROME_PATH: "/nowhere" }, "linux", "/home/a", ...machine(installed, shell))).toBeUndefined();
  });

  it("is the headless-only build before the whole browser: it has no window and no icon", () => {
    expect(findBrowser({}, "linux", "/home/a", ...machine(installed, older, shell, downloadedChrome))).toBe(shell);
    expect(isHeadlessShell(shell)).toBe(true);
    expect(isHeadlessShell(installed)).toBe(false);
  });

  it("is the installed browser when there is no headless-only build, and a downloaded one last", () => {
    expect(findBrowser({}, "linux", "/home/a", ...machine(installed, downloadedChrome))).toBe(installed);
    expect(findBrowser({}, "linux", "/home/a", ...machine(downloadedChrome))).toBe(downloadedChrome);
  });

  it("is undefined on a machine with none", () => {
    expect(findBrowser({}, "linux", "/home/a", ...machine())).toBeUndefined();
  });

  it("keeps its sandbox, except as root and in CI, where it cannot start with one", () => {
    expect(browserArguments({}, false)).toEqual([]);
    expect(browserArguments({ CI: "true" }, false)).toEqual(["--no-sandbox"]);
    expect(browserArguments({}, true)).toEqual(["--no-sandbox"]);
  });
});
