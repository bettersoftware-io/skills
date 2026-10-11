// The tools the architecture-docs scripts need and this plugin does not carry:
// Mermaid as a browser bundle (to draw a diagram), a library that drives a
// browser (to draw it without a window), and a markdown converter (to build
// the reading copy).
//
// The plugin's other scripts run on Node alone, with nothing installed, and an
// installed plugin has no node_modules. So these are fetched the first time
// one is needed, into a cache folder outside the plugin and outside any
// project, at the versions `toolset/toolset.lock.json` pins. A later run finds
// them there and fetches nothing.
//
// Rendering needs a browser. None is downloaded: the one on the machine is
// used, and a machine without one is told so.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform as currentPlatform } from "node:os";
import { join } from "node:path";

import { CouldNotRun, firstLine } from "./outcome.mts";

const TOOLSET = join(import.meta.dirname, "..", "toolset");

export interface Toolset {
  /** The cache folder that holds this version of the tools. */
  folder: string;
  /** Mermaid as one file a page can load. */
  mermaidBundle: string;
  /** The library that starts a browser and drives it, as a module to import. */
  puppeteer: string;
  /** The markdown converter, as a module to import. */
  marked: string;
}

export interface CommandRun {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** Runs a command and waits. Replaced by a fake in tests. */
export type RunCommand = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => CommandRun;

const runForReal: RunCommand = (command, args, options) => {
  const ran = spawnSync(command, args, { ...options, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  return { status: ran.status, stdout: ran.stdout ?? "", stderr: ran.stderr ?? "", ...(ran.error === undefined ? {} : { error: ran.error }) };
};

/**
 * Where fetched tools and built sites are kept: `XDG_CACHE_HOME`, or
 * `LOCALAPPDATA` on Windows, or `~/.cache`. Never inside a project: a project
 * that is not ours must not gain a file from being read.
 */
export function cacheFolder(env: NodeJS.ProcessEnv = process.env, home: string = homedir(), platform: string = currentPlatform()): string {
  const base = env.XDG_CACHE_HOME || (platform === "win32" ? env.LOCALAPPDATA : undefined) || join(home, ".cache");

  return join(base, "bettersoftware-skills", "architecture-docs");
}

/** Names one set of pinned versions. A changed lockfile is another folder, so two versions never mix. */
export function toolsetKey(lock: string): string {
  return createHash("sha256").update(lock).digest("hex").slice(0, 16);
}

function toolsetIn(folder: string): Toolset {
  return {
    folder,
    mermaidBundle: join(folder, "node_modules", "mermaid", "dist", "mermaid.min.js"),
    puppeteer: join(folder, "node_modules", "puppeteer-core", "lib", "puppeteer", "puppeteer-core.js"),
    marked: join(folder, "node_modules", "marked", "lib", "marked.esm.js"),
  };
}

function isWhole(toolset: Toolset): boolean {
  return existsSync(toolset.mermaidBundle) && existsSync(toolset.puppeteer) && existsSync(toolset.marked);
}

/**
 * The pinned tools if this machine already has them, and undefined if not.
 * Nothing is fetched: for a check that should run where the tools are and be
 * skipped, out loud, where they are not.
 */
export function installedToolset(env: NodeJS.ProcessEnv = process.env, cache: string = cacheFolder(env)): Toolset | undefined {
  const toolset = toolsetIn(env.ARCHITECTURE_DOCS_TOOLSET || join(cache, "tools", toolsetKey(readFileSync(join(TOOLSET, "toolset.lock.json"), "utf8"))));

  return isWhole(toolset) ? toolset : undefined;
}

export interface EnsureOptions {
  env?: NodeJS.ProcessEnv;
  cache?: string;
  run?: RunCommand;
  /** Told once, before a fetch starts: it takes a while and uses the network. */
  announce?: (message: string) => void;
}

/**
 * The pinned tools, fetched if this machine does not have them yet.
 *
 * `ARCHITECTURE_DOCS_TOOLSET` names a folder that already holds them (an
 * `npm ci` of `toolset/`), for a machine with no network.
 */
export function ensureToolset({ env = process.env, cache = cacheFolder(env), run = runForReal, announce = (message) => console.error(message) }: EnsureOptions = {}): Toolset {
  if (env.ARCHITECTURE_DOCS_TOOLSET) {
    const given = toolsetIn(env.ARCHITECTURE_DOCS_TOOLSET);

    if (!isWhole(given)) {
      throw new CouldNotRun(`ARCHITECTURE_DOCS_TOOLSET is ${env.ARCHITECTURE_DOCS_TOOLSET}, and the tools are not in it. Run \`npm ci --ignore-scripts\` there with toolset.json as package.json and toolset.lock.json as package-lock.json, or unset the variable.`);
    }

    return given;
  }

  const lock = readFileSync(join(TOOLSET, "toolset.lock.json"), "utf8");
  const folder = join(cache, "tools", toolsetKey(lock));
  const toolset = toolsetIn(folder);

  if (isWhole(toolset)) {
    return toolset;
  }

  // Installed beside the final place and moved in whole, so that a run that
  // was stopped half-way never leaves a folder that looks finished.
  const partial = `${folder}.partial-${process.pid}`;

  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  writeFileSync(join(partial, "package.json"), readFileSync(join(TOOLSET, "toolset.json")));
  writeFileSync(join(partial, "package-lock.json"), lock);

  announce(`Fetching the tools into ${folder} (once per machine; needs the network) …`);

  // --ignore-scripts: nothing a package brings is run at install.
  const installed = run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: partial, env });

  if (installed.error !== undefined || installed.status !== 0) {
    rmSync(partial, { recursive: true, force: true });

    throw new CouldNotRun(
      installed.error !== undefined
        ? `npm did not start (${installed.error.message}). It ships with Node; check that \`npm --version\` answers.`
        : `the tools could not be fetched: ${firstLine(installed.stderr, installed.stdout)} They are fetched once, from the npm registry.`,
    );
  }

  if (existsSync(folder)) {
    // Another run finished first. Its folder is as good as this one.
    rmSync(partial, { recursive: true, force: true });
  } else {
    renameSync(partial, folder);
  }

  if (!isWhole(toolset)) {
    throw new CouldNotRun(`npm finished, and ${folder} does not hold the tools. Delete that folder and run again.`);
  }

  return toolset;
}

/**
 * A browser to draw diagrams in, or undefined. Asked in this order:
 *
 * 1. the variables a person sets on purpose;
 * 2. a headless-only build that Puppeteer downloaded for some other tool. It
 *    has no window and no icon, so a run is not seen;
 * 3. the browsers a machine usually has. The whole browser, started without a
 *    window. On macOS its icon may show while it runs;
 * 4. a whole browser from Puppeteer's folder.
 */
export function findBrowser(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = currentPlatform(),
  home: string = homedir(),
  exists: (path: string) => boolean = existsSync,
  list: (folder: string) => string[] = listFolder,
): string | undefined {
  for (const named of [env.ARCHITECTURE_DOCS_BROWSER, env.PUPPETEER_EXECUTABLE_PATH, env.CHROME_PATH]) {
    if (named) {
      return exists(named) ? named : undefined;
    }
  }

  // ~/.cache/puppeteer/<browser>/<platform>-<version>/<folder>/<binary>, newest version first.
  const puppeteer = join(home, ".cache", "puppeteer");
  const downloaded = (browser: string, binaries: string[]): string | undefined => {
    for (const version of list(join(puppeteer, browser)).sort().reverse()) {
      for (const inner of list(join(puppeteer, browser, version))) {
        const found = binaries.map((binary) => join(puppeteer, browser, version, inner, binary)).find((path) => exists(path));

        if (found !== undefined) {
          return found;
        }
      }
    }

    return undefined;
  };

  const usual: Record<string, string[]> = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge"],
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
  };

  return (
    downloaded("chrome-headless-shell", ["chrome-headless-shell", "chrome-headless-shell.exe"]) ??
    (usual[platform] ?? []).find((path) => exists(path)) ??
    downloaded("chrome", ["chrome", "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome.exe"])
  );
}

/** True for the headless-only build, which is started in another way than a whole browser. */
export function isHeadlessShell(browser: string): boolean {
  return /chrome-headless-shell(?:\.exe)?$/.test(browser);
}

function listFolder(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

/** What to tell a person whose machine has no browser this can use. */
export const NO_BROWSER =
  "no browser was found to render with. Install Chrome, Chromium or Edge, or set ARCHITECTURE_DOCS_BROWSER to the path of a Chromium-based browser.";

/**
 * How the browser is started. The sandbox is left on, except where a browser
 * cannot start with it: as root, and in CI containers.
 */
export function browserArguments(env: NodeJS.ProcessEnv = process.env, isRoot: boolean = process.getuid?.() === 0): string[] {
  return isRoot || env.CI ? ["--no-sandbox"] : [];
}
