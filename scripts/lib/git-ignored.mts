// Which of the files an install put in a project git ignores.
//
// A file that is on disk and ignored passes every check run here, and never
// reaches a commit: the branch does not carry it, and CI fails on what the
// branch lacks. An add-on that writes `.claude/commands/` into a project whose
// `.gitignore` has `.claude/` does just that, in silence. So the installer
// asks git, once, and names each such file with the rule that matches it.
//
// Nothing an install writes is meant to be ignored: a project created with
// every add-on has no such file (`scripts/create-project.test.mts`). A file
// git already tracks is never named, since no ignore rule applies to it.

import { spawnSync } from "node:child_process";
import { isAbsolute, posix } from "node:path";

/** Files that one rule of the project's ignore files matches. */
export interface IgnoredFiles {
  /** The file that holds the rule, from the project's folder: `.gitignore`, `../.gitignore`, `.git/info/exclude`, or an absolute path for the user's own. */
  source: string;
  line: number;
  pattern: string;
  /** The files it matches, in the project, sorted. */
  paths: string[];
}

/**
 * The files among `paths` (relative to the project) that git ignores and does
 * not track, grouped by the rule that matches them, in the order the rules
 * are first met. One call of git for every path. Empty when the project is not
 * in a git repository, or git cannot be run: there is nothing to tell then.
 * `git` is the command, replaced in a test.
 */
export function findIgnored(project: string, paths: string[], git = "git"): IgnoredFiles[] {
  // `-z`: each path in, and each field out, ends in NUL, so no name can be misread. `-v`: the rule that matched.
  const run = spawnSync(git, ["-C", project, "check-ignore", "-v", "-z", "--stdin"], { input: paths.map((path) => `${path}\0`).join(""), encoding: "utf8" });

  // Exit 1: nothing is ignored. 128: not a repository, or git could not tell. No status: git is not there.
  if (run.status !== 0) {
    return [];
  }

  const fields = run.stdout.split("\0");
  const prefix = repositoryPrefix(project, git);
  const rules = new Map<string, IgnoredFiles>();

  for (let at = 0; at + 3 < fields.length; at += 4) {
    const [source, line, pattern, path] = fields.slice(at, at + 4) as [string, string, string, string];
    const key = `${source}\0${line}\0${pattern}`;
    const rule = rules.get(key) ?? { source: fromProject(source, prefix), line: Number(line), pattern, paths: [] };

    rule.paths.push(path);
    rules.set(key, rule);
  }

  return [...rules.values()].map((rule) => ({ ...rule, paths: rule.paths.sort() }));
}

/** Where the project is in its repository: `` at the top, `apps/web/` in a folder of it. */
function repositoryPrefix(project: string, git: string): string {
  return spawnSync(git, ["-C", project, "rev-parse", "--show-prefix"], { encoding: "utf8" }).stdout.trim();
}

/** git names an ignore file of the repository from its top; a person reads it from the project's folder. */
function fromProject(source: string, prefix: string): string {
  return isAbsolute(source) ? source : posix.relative(prefix, source);
}
