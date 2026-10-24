// Decides whether a shell command joins an outward step to anything else.
//
// An outward step sends something off this machine or changes shared state:
// a push, a pull request written to, a workflow started. Each one is meant to
// be a tool call of its own, so that the permission prompt it raises names
// what is being approved and nothing else waits behind it.

import { DEEPEST_NESTING, LimitError, parseShell, type Script, ShellError, type Stage } from "./shell.mts";

/** `gh <group> <action>` pairs that write. Every other pair reads. */
const GH_OUTWARD: Record<string, string[]> = {
  pr: ["create", "merge", "edit", "comment", "close", "reopen", "ready", "review"],
  issue: ["create", "comment", "edit", "close", "reopen"],
  workflow: ["run", "enable", "disable"],
  run: ["rerun", "cancel", "delete"],
  release: ["create", "delete", "edit", "upload"],
  repo: ["create", "delete", "edit", "fork"],
};
const GIT_OUTWARD = ["push"];
const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];
/** `gh api` sends these as a request body, which makes the call a write unless a method says otherwise. */
const GH_API_FIELDS = ["-f", "-F", "--field", "--raw-field", "--input"];
/** `git` options that take their value as the next word. */
const GIT_OPTIONS_WITH_VALUE = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"];
/**
 * Words before a command that are not the command: what a shell allows there,
 * and programs that run the command that follows them. Claude Code looks past
 * the second kind as well when it matches a rule to a command (`timeout`,
 * `time`, `nice`, `stdbuf`, `nohup`, `command`, `builtin`, `noglob`, and
 * `xargs` for an `allow` rule), so a push behind one must be read here too.
 */
const LEADING_WORDS = [
  ...["then", "do", "else", "elif", "if", "while", "until", "!", "{", "}"],
  ...["time", "command", "exec", "nohup", "env", "xargs", "timeout", "nice", "stdbuf", "builtin", "noglob"],
];
/** What such a program takes before the command it runs, beside its options: a number (`nice -n 5`) or a time (`timeout 30s`). */
const LEADING_VALUE = /^\d+(?:\.\d+)?[smhd]?$/;
/** Options of such a program that take their value as the next word, whatever it is: `timeout -s KILL`, `env -u NAME`. */
const LEADING_OPTIONS_WITH_VALUE = ["-s", "--signal", "-k", "--kill-after", "-n", "-u"];
const SHELLS = ["bash", "sh", "zsh", "dash", "ksh"];
/**
 * A word nothing hides in: letters, digits and `. _ - /`. Any other
 * character is a colon, or one the shell may read as something to fill in:
 * an expansion, an escape left as written, a pattern for file names. The
 * plain ones are listed, not the others: a list of what to look out for is
 * never whole.
 */
const PLAIN_WORD = /^[A-Za-z0-9._/-]+$/;
/**
 * The options of `git push` that change nothing about what is pushed or
 * where. Any other is asked about, written out, shortened (`--de`) or joined
 * to another (`-uf`): git reads both, and no permission rule can.
 */
const PLAIN_PUSH_OPTIONS = ["-u", "--set-upstream", "-v", "--verbose", "-q", "--quiet", "--progress", "--porcelain", "-n", "--dry-run", "--atomic"];
/** The options of `git` itself that say nothing about where a push goes. `-C` takes a folder as its next word. */
const PLAIN_GIT_OPTIONS = ["--no-pager", "-P"];
/** A quote or a backslash: the shell takes it out of a word, so `-"f"` is `-f` to git and to nothing that reads the text. */
const QUOTING = /['"\\]/;

export interface Verdict {
  /** The outward steps found, as the first words of each. */
  outward: string[];
  /** True when an outward step shares the command with anything else. */
  chained: boolean;
  /** True when a push among them is not written plainly, so it may write to another branch than the one it names first, or delete one. */
  redirected: boolean;
}

/** A verdict, whether a `git push` is among the outward steps, and whether the script runs any command at all. */
interface Reading extends Verdict {
  pushed: boolean;
  runs: boolean;
}

/**
 * Judges one command line. Undefined when it cannot be read: then this has no
 * verdict, and the host's own permission rules are the only judge. Throws
 * `LimitError` for a command it will not read: too long, or nested too deep.
 */
export function judgeCommand(command: string): Verdict | undefined {
  try {
    const { pushed, outward, chained, redirected } = judgeScript(parseShell(command));

    // The reader takes quotes out of the words, as the shell does. A rule of the host reads the text with them in.
    return { outward, chained, redirected: redirected || (pushed && QUOTING.test(command)) };
  } catch (error) {
    if (error instanceof ShellError) {
      return undefined;
    }

    throw error;
  }
}

function judgeScript(script: Script, depth = 0): Reading {
  // `bash -c "bash -c '…'"`: each level is read by a reader of its own, so the reader's bound does not count them.
  if (depth > DEEPEST_NESTING) {
    throw new LimitError(`the command nests commands more than ${DEEPEST_NESTING} deep`);
  }

  const outward: string[] = [];
  let chained = false;
  let redirected = false;
  let pushed = false;
  let steps = 0;

  for (const step of script.steps) {
    const stages = step.filter((stage) => commandWords(stage).length > 0);

    if (stages.length > 0) {
      steps += 1;
    }

    let behind = false;

    for (const stage of stages) {
      const words = commandWords(stage);

      if (isOutward(words)) {
        outward.push(words.slice(0, 3).join(" "));
        // What stands behind a pipe from another command is no lone step: a filter comes after, never before.
        chained ||= behind;
        pushed ||= isGit(words);
        redirected ||= isRedirectedPush(stage, words);
      }

      behind = true;

      // `bash -c "…"` and `eval "…"` run what their argument says.
      const inline = inlineScript(words);

      if (inline !== undefined) {
        const inner = judgeScript(inline, depth + 1);

        outward.push(...inner.outward);
        chained ||= inner.chained;
        redirected ||= inner.redirected;
        pushed ||= inner.pushed;
      }
    }
  }

  let beside = 0;
  let within = false;

  for (const nested of script.nested) {
    const inner = judgeScript(nested, depth + 1);

    outward.push(...inner.outward);
    // An outward step inside `$(…)` of another command runs beside that command.
    chained ||= inner.chained || (inner.outward.length > 0 && steps > 0);
    redirected ||= inner.redirected;
    pushed ||= inner.pushed;
    beside += inner.runs ? 1 : 0;
    within ||= inner.outward.length > 0;
  }

  // Two `$(…)` side by side, one of them outward: `A=$(git add -A) B=$(git push)` runs both.
  chained ||= within && beside > 1;

  // One outward step with a filter behind a pipe, or with a `$(cat …)` that
  // only feeds it, is still one step. Two of them, or one beside any other
  // step, is a chain.
  return { outward, chained: chained || (outward.length > 0 && (steps > 1 || outward.length > 1)), redirected, pushed, runs: steps > 0 || beside > 0 };
}

/**
 * Whether the text holds a word an outward step is written with. Asked only
 * about a command that was not read, where the choice is between refusing a
 * command that may be local and letting a chain through unread.
 */
export function mentionsOutward(text: string): boolean {
  const word = /(?:^|[^A-Za-z0-9_-])(?:push|gh)(?:$|[^A-Za-z0-9_-])/;

  // Also with each line continuation taken out, as the shell reads it: `pu`, a continuation and `sh` are `push`.
  // Any run of backslashes before a new line goes too: backticks make two of them one, and then a continuation.
  return word.test(text) || word.test(text.replace(/\\+\n/g, ""));
}

/**
 * The command's own words: no `VAR=value` in front, no `then`, `time`, `env`
 * or `xargs`, and none of what such a word takes before the command (`nice
 * -n 5`, `timeout 30s`, `command --`).
 */
export function commandWords(stage: Stage): string[] {
  let start = 0;
  let led = false;

  // By index: a stage can hold hundreds of thousands of such words, and a copy of the rest for each takes longer than a host waits.
  for (; start < stage.length; start += 1) {
    const word = stage[start] ?? "";

    if (LEADING_WORDS.includes(word)) {
      led = true;
    } else if (led && LEADING_OPTIONS_WITH_VALUE.includes(word)) {
      start += 1;
    } else if (!(/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || (led && (word.startsWith("-") || LEADING_VALUE.test(word))))) {
      break;
    }
  }

  return stage.slice(start);
}

function isGit(words: string[]): boolean {
  return (words[0] ?? "").split("/").pop() === "git";
}

export function isOutward(words: string[]): boolean {
  if (isGit(words)) {
    return GIT_OUTWARD.includes(skipGitOptions(words.slice(1))[0] ?? "");
  }

  const program = (words[0] ?? "").split("/").pop();

  if (program === "gh") {
    const rest = skipGhOptions(words.slice(1));
    const [group = "", action = ""] = rest;

    return group === "api" ? isWritingApiCall(rest) : (GH_OUTWARD[group] ?? []).includes(action);
  }

  return false;
}

/**
 * Whether an outward step is a `git push` that is not written plainly. A
 * plain one is `git`, perhaps behind `-C <folder>`, then `push`, options that
 * change nothing about what is pushed, and plain words for the remote and the
 * branch. Anything else may write elsewhere than it names first, or delete:
 *
 * - a word that is not plain: a colon (`source:target`, `:target`, a remote
 *   written as a URL), or what the shell turns into another word before git
 *   sees it (`"$BRANCH"`, a backtick, an escape, braces, a pattern);
 * - any other option, of `push` or of `git` (`-c remote.origin.push=a:b`);
 * - a value set in front of `git`, which git may take as a setting
 *   (`GIT_CONFIG_VALUE_0=a:b`);
 * - `xargs` in front, which adds words from what it is fed.
 */
function isRedirectedPush(stage: Stage, outward: string[]): boolean {
  if (!isGit(outward)) {
    return false;
  }

  const led = stage.slice(0, stage.length - outward.length);
  const own = skipGitOptions(outward.slice(1));
  const before = outward.slice(1, outward.length - own.length);

  return (
    led.some((word) => word === "xargs" || word.includes("=")) ||
    !isPlainFolderOnly(before) ||
    own.slice(1).some((word) => (word.startsWith("-") ? !PLAIN_PUSH_OPTIONS.includes(word) : !PLAIN_WORD.test(word)))
  );
}

/** Whether git's own options, before `push`, are `-C <folder>` and ones that say nothing about a push. */
function isPlainFolderOnly(options: string[]): boolean {
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index] ?? "";

    if (option === "-C" && PLAIN_WORD.test(options[index + 1] ?? "")) {
      index += 1;
    } else if (!PLAIN_GIT_OPTIONS.includes(option)) {
      return false;
    }
  }

  return true;
}

/** `git -C dir -c key=value push` → `push`. */
function skipGitOptions(words: string[]): string[] {
  let start = 0;

  while (words[start]?.startsWith("-")) {
    start += GIT_OPTIONS_WITH_VALUE.includes(words[start] ?? "") ? 2 : 1;
  }

  return words.slice(start);
}

/** `gh -R owner/name pr merge` → `pr merge`. */
function skipGhOptions(words: string[]): string[] {
  let start = 0;

  while (words[start]?.startsWith("-")) {
    start += ["-R", "--repo"].includes(words[start] ?? "") ? 2 : 1;
  }

  return words.slice(start);
}

/** The first method named decides; with none, a request body makes it a write. */
function isWritingApiCall(words: string[]): boolean {
  for (const [index, word] of words.entries()) {
    if (word === "-X" || word === "--method") {
      return WRITE_METHODS.includes((words[index + 1] ?? "").toUpperCase());
    }

    const joined = /^(?:--method=|-X)(.+)$/.exec(word)?.[1];

    if (joined !== undefined) {
      return WRITE_METHODS.includes(joined.toUpperCase());
    }
  }

  return words.some((word) => GH_API_FIELDS.includes(word) || /^(?:--field|--raw-field|--input)=/.test(word));
}

/** What `bash -c <text>` or `eval <text>` will run, when it can be read. */
function inlineScript(words: string[]): Script | undefined {
  const program = (words[0] ?? "").split("/").pop() ?? "";
  let text: string | undefined;

  if (program === "eval") {
    text = words.slice(1).join(" ");
  } else if (SHELLS.includes(program)) {
    const flag = words.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));

    text = flag === -1 ? undefined : words[flag + 1];
  }

  if (text === undefined) {
    return undefined;
  }

  try {
    return parseShell(text);
  } catch (error) {
    if (error instanceof ShellError) {
      return undefined;
    }

    throw error;
  }
}
