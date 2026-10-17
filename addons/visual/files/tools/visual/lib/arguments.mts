// What `pnpm visual:jitter` was asked to do.

import { resolve } from "node:path";

const DEFAULT_RUNS = 3;

export class UsageError extends Error {}

export type JitterRequest =
  | { mode: "capture"; runs: number; /** Only these scenarios; none listed means all. */ scenarios: string[] }
  | { mode: "compare"; directories: string[] };

/**
 * The `playwright test -g` pattern that selects exactly these scenarios' tests.
 * Playwright matches it against the whole title (project, file, test name,
 * separated by spaces), so a name must follow a space or start the title, and
 * must end it: `price-row-up` does not pick `price-row-up-wide`. Regex
 * characters in a name are taken literally. Playwright reads the pattern
 * without regard to case.
 */
export function grepFor(scenarios: string[]): string {
  const names = scenarios.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  return `(?:^|\\s)(?:${names.join("|")})$`;
}

export function parseArguments(argv: string[]): JitterRequest {
  const directories: string[] = [];
  const scenarios: string[] = [];
  let runs: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;

    if (argument === "--runs") {
      runs = Number(argv[index + 1]);
      index += 1;

      if (!Number.isInteger(runs) || runs < 2) {
        throw new UsageError("--runs needs a whole number of 2 or more: noise is a difference between captures");
      }
    } else if (argument === "--scenario") {
      const name = argv[index + 1];

      if (name === undefined || name.startsWith("--")) {
        throw new UsageError("--scenario needs the name of a scenario");
      }

      scenarios.push(name);
      index += 1;
    } else if (argument.startsWith("--")) {
      throw new UsageError(`unknown argument "${argument}"`);
    } else {
      directories.push(resolve(argument));
    }
  }

  if (directories.length === 0) {
    return { mode: "capture", runs: runs ?? DEFAULT_RUNS, scenarios };
  }

  if (runs !== undefined) {
    throw new UsageError("give --runs or folders to compare, not both");
  }

  if (scenarios.length > 0) {
    throw new UsageError("--scenario chooses what to capture, so it cannot go with folders that were captured already");
  }

  if (directories.length < 2) {
    throw new UsageError("give at least two folders to compare");
  }

  return { mode: "compare", directories };
}
