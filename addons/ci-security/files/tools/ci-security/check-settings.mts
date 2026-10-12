#!/usr/bin/env node
// Says which of the repository's settings on GitHub are off: the ones the
// checks of this add-on depend on, and that no file in the project can set.
//
//   node tools/ci-security/check-settings.mts               this project
//   node tools/ci-security/check-settings.mts --root <dir>  another checkout
//
// One line per setting. PASS: it is on. FAIL: it is off, and the lines under
// it say where it is in GitHub's pages and give the `gh api` command that
// switches it on. SKIP: GitHub was not asked or did not say (no `gh`, not
// logged in, no access to that setting); that is not a pass and not "off".
//
// It only reads: every call is `gh api --method GET`. The command under a
// FAIL line is printed for a person to run. This tool never runs it.
//
// It needs `gh`, a login and the network, and a login may not be let to read
// every setting. That is why it is not in `pnpm gate:fast` or
// `pnpm gate:full`: a gate needs nothing beyond `pnpm install`.
//
// Exit 0: every setting was read and is on. Exit 1: a setting is off. Exit
// 2: no setting is off, and one or all of them could not be read; or the
// arguments are wrong. Exit 2 is not a pass; say that the settings were not
// read.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkSettings, shown } from "./lib/settings.mts";
import { isMainModule, runCaptured } from "./lib/system.mts";

/** The project root to read: the one this tool is installed in, unless `--root <dir>` names another. Undefined: the arguments are wrong. */
export function parseArguments(argv: string[], installedIn: string): string | undefined {
  if (argv.length === 0) {
    return installedIn;
  }

  return argv.length === 2 && argv[0] === "--root" && argv[1] !== "" ? resolve(argv[1] as string) : undefined;
}

if (isMainModule(import.meta.url)) {
  const root = parseArguments(process.argv.slice(2), dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

  if (root === undefined) {
    console.error(shown(`repo:settings could not run: unknown arguments "${process.argv.slice(2).join(" ")}" (use --root <dir>)`));
    process.exitCode = 2;
  } else {
    // Set, not process.exit(): the lines printed above still reach a pipe that is slow to read.
    process.exitCode = checkSettings({ root, run: runCaptured, report: (line) => console.log(line) });
  }
}
