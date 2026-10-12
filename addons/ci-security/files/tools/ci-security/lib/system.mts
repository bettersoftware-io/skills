// The places the tools touch the machine: the network, tar, a child process
// and the PATH. Everything that decides something is in install.mts, lint.mts
// and settings.mts, and takes these as arguments.

import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Download, Extract } from "./install.mts";
import type { Run } from "./settings.mts";

const DOWNLOAD_TIMEOUT_MS = 60_000;

/** A download over https. `request` is Node's own `fetch` unless a test gives another. */
export function createDownload(request: typeof fetch = fetch): Download {
  return async (url) => {
    let response: Response;

    try {
      // A release download answers with a redirect to where the file is stored.
      response = await request(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (error) {
      // fetch says only "fetch failed"; the reason (no DNS, refused, timed out) is in `cause`.
      const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;

      throw new Error(reason instanceof Error ? reason.message : String(reason));
    }

    if (!response.ok) {
      throw new Error(`the server answered ${response.status} ${response.statusText}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  };
}

/** Takes one file out of a .tar.gz with the system's tar. Throws when tar fails or is missing. */
export const extractWithTar: Extract = (archive, directory, member) => {
  execFileSync("tar", ["-xzf", archive, "-C", directory, member], { stdio: "pipe" });
};

/** Runs a program in `root` with the terminal as its output. Null: it was killed or did not start. */
export function runInherited(binary: string, runArguments: string[], root: string): number | null {
  return spawnSync(binary, runArguments, { cwd: root, stdio: "inherit" }).status;
}

/** Runs a program in `root` and keeps what it prints. A program that is not installed is a failed run (127), not a crash. */
export const runCaptured: Run = (program, runArguments, root) => {
  // The program gets the same folders as its own PATH: `gh` starts `git` by its name, and would find one a project brought.
  const path = trustedFolders(process.env.PATH, root).join(delimiter);
  const binary = findCommand(program, path);

  if (binary === undefined) {
    return { status: 127, stdout: "", stderr: `${program} is in no folder of the PATH` };
  }

  const result = spawnSync(binary, runArguments, { cwd: root, env: { ...process.env, PATH: path }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  return {
    status: result.error === undefined ? (result.status ?? 1) : 127,
    stdout: result.stdout ?? "",
    stderr: result.error === undefined ? (result.stderr ?? "") : result.error.message,
  };
};

/**
 * The full path of a program: the one given when it is a full path, the
 * first of that name in a folder of `path` otherwise. Undefined: it is in
 * none.
 *
 * A folder of the PATH counts only when no project fills it:
 *
 *   - it is written in full. `.` and an empty entry mean the folder a program
 *     is started in, and these tools start `gh` and `git` in the project;
 *   - it is not a `node_modules/.bin`. pnpm puts those first on the PATH of a
 *     script, and a dependency may ship a file of any name there;
 *   - it is not inside `project`, the checkout the program is started for.
 *
 * So a file named `gh` that a checkout or a dependency brought is not
 * started in place of GitHub's. Folders are compared by where they really
 * are: a link into the project is in the project.
 */
export function findCommand(name: string, path: string | undefined, project?: string): string | undefined {
  if (isAbsolute(name)) {
    return name;
  }

  if (name.includes("/") || name.includes(sep)) {
    return undefined;
  }

  // Windows finds `gh` as gh.exe. A .cmd or .bat is not started without a shell, so it is not looked for.
  const names = process.platform === "win32" ? [`${name}.exe`, name] : [name];

  return trustedFolders(path, project)
    .flatMap((folder) => names.map((file) => join(folder, file)))
    .find((file) => isExecutable(file));
}

/** The folders of `path` that no project fills, in their order: see `findCommand`. */
export function trustedFolders(path: string | undefined, project?: string): string[] {
  return (path ?? "").split(delimiter).filter((folder) => isAbsolute(folder) && !isFilledByAProject(folder, project));
}

function isFilledByAProject(folder: string, project: string | undefined): boolean {
  const real = realPath(folder);
  const parts = real.split(sep);

  if (parts.at(-1) === ".bin" && parts.at(-2) === "node_modules") {
    return true;
  }

  if (project === undefined) {
    return false;
  }

  const root = realPath(project);

  return real === root || real.startsWith(`${root}${sep}`);
}

/** Where a folder really is. One that is not there is taken as written: nothing is found in it either way. */
function realPath(folder: string): string {
  try {
    return realpathSync(folder);
  } catch {
    return resolve(folder);
  }
}

/** True when a file of that name in a folder of `path` can be run. */
export function hasCommand(name: string, path: string | undefined): boolean {
  return (path ?? "")
    .split(delimiter)
    .filter((folder) => folder !== "")
    .some((folder) => isExecutable(join(folder, name)));
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);

    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * True when the module at `moduleUrl` is the script Node was asked to run.
 * Compares real paths: reached through a symlink, a naive comparison is false
 * and the script would exit 0 having done nothing.
 */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];

  return entry !== undefined && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
}
