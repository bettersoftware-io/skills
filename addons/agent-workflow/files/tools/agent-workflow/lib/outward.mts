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
const GIT_OPTIONS_WITH_VALUE = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env", "--attr-source"];
/**
 * A setting `git -c` or `--config-env` gives that may make a word of its own a
 * command: `alias.p=push` runs `git p` as a push, and an included file may
 * hold such an alias.
 */
const ALIAS_SETTING = /^(?:alias|include|includeif)\./i;
/**
 * A value that hands git settings, the files they are read from, or the place
 * it finds its commands (`GIT_EXEC_PATH`, and `PATH` for a `git-<name>`
 * program): so an alias, or a `git-<name>` program, the reader cannot see. Set
 * anywhere in a script (in front of git, as a step of its own, or with
 * `export`), it makes every `git` of that script one this cannot judge.
 */
const GIT_SETTINGS = /^(?:GIT_CONFIG\w*|GIT_DIR|GIT_COMMON_DIR|GIT_EXEC_PATH|HOME|PATH|XDG_CONFIG_HOME)(?:\[.*\])?\+?=/;
/** A value set in front of a command. `A+=1 git push` runs git as `A=1 git push` does, and `PATH[0]=…` sets `PATH`. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[.*\])?\+?=/;
/** `git config` options that only read, in front of the key: git stops reading options at the first word that is not one. */
const CONFIG_READ_OPTIONS = ["--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list", "-l"];
/** `git config` subcommands that only read: only right after `config`, for anywhere else git takes the word for a value. */
const CONFIG_READ_COMMANDS = ["get", "list"];
/** `git config` options that take the next word as their value, so a read word after one is no action: `--comment --get`. git takes any of them cut short (`--comm`). */
const CONFIG_OPTIONS_WITH_VALUE = ["--comment", "--file", "-f", "--blob", "--type", "--default", "--value"];
/** How many words behind a wrapper that name a program this reads are tried as the command, before the stage is not read at all. */
const WRAPPED_CANDIDATES = 32;

/**
 * A stage not read because a wrapper is followed by more than
 * `WRAPPED_CANDIDATES` words that name git, gh or a shell. Those words were
 * read, so the hook refuses it whatever the text looks like.
 */
export class WrappedLimitError extends LimitError {}
/**
 * An `env` that is the command, with options or `-S` text this cannot read:
 * what it runs is not known, and the words it runs need not name anything.
 * Refused whatever the text looks like, and by either host.
 */
export class UnreadEnvError extends LimitError {}
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
/** `env`'s options of one letter that take no value, on macOS and in GNU env. They join: `-iv`. */
const ENV_FLAGS = "0iv";
/** `env`'s options of one letter that take a value, joined (`-uFOO`) or as the next word, and `-S`, whose value is a command line. */
const ENV_FLAGS_WITH_VALUE = "uCPS";
/** GNU `env`'s long options. It takes any start of one that fits only one: `--split-str=`. Their values, when they have one, are joined by `=`. */
const ENV_LONG_OPTIONS = ["null", "ignore-environment", "debug", "block-signal", "default-signal", "ignore-signal", "list-signal-handling", "help", "version"];
/** The long options that take a value, joined by `=` or as the next word. */
const ENV_LONG_OPTIONS_WITH_VALUE = ["unset", "chdir", "split-string"];
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
  /** Whether the script itself sets what git reads its settings from: `eval` runs it in the shell of the step after. */
  moves: boolean;
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

function judgeScript(script: Script, depth = 0, settingsMoved = false): Reading {
  // `bash -c "bash -c '…'"`: each level is read by a reader of its own, so the reader's bound does not count them.
  if (depth > DEEPEST_NESTING) {
    throw new LimitError(`the command nests commands more than ${DEEPEST_NESTING} deep`);
  }

  // A setting made in an outer script holds in what it runs; one made inside `$(…)` does not hold outside it.
  const moves = script.steps.some((step) => step.some((stage) => stage.some((word) => GIT_SETTINGS.test(word))));
  let moved = settingsMoved || moves;
  let movedByEval = false;
  const outward: string[] = [];
  let chained = false;
  let redirected = false;
  let pushed = false;
  let steps = 0;

  for (const step of script.steps) {
    // `env '-Sgit push …'` is all options to the eye: its command is in the text of `-S`.
    const stages = step.filter((stage) => commandWords(stage).length > 0 || splitStringScript(stage) !== undefined);

    if (stages.length > 0) {
      steps += 1;
    }

    let behind = false;

    for (const stage of stages) {
      const words = commandWords(stage);

      if (isOutward(words) || (moved && isGit(words))) {
        outward.push(words.slice(0, 3).join(" "));
        // What stands behind a pipe from another command is no lone step: a filter comes after, never before.
        chained ||= behind;
        pushed ||= isGit(words);
        redirected ||= moved || isRedirectedPush(stage, words);
      }

      behind = true;

      // `bash -c "…"`, `eval "…"` and `env -S "…"` run what their argument says.
      const inline = inlineScript(words) ?? splitStringScript(stage);

      if (inline !== undefined) {
        const inner = judgeScript(inline, depth + 1, moved);

        outward.push(...inner.outward);
        chained ||= inner.chained;
        redirected ||= inner.redirected;
        pushed ||= inner.pushed;
        // `eval 'export HOME=…'` sets it in this shell, for the steps after; `bash -c` sets it in a shell that ends.
        movedByEval ||= programName(words[0] ?? "") === "eval" && inner.moves;
        moved ||= movedByEval;
      }
    }
  }

  let beside = 0;
  let within = false;

  for (const nested of script.nested) {
    const inner = judgeScript(nested, depth + 1, moved);

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
  return {
    outward,
    chained: chained || (outward.length > 0 && (steps > 1 || outward.length > 1)),
    redirected,
    pushed,
    runs: steps > 0 || beside > 0,
    moves: moves || movedByEval,
  };
}

/**
 * Whether the text holds a word an outward step is written with. Asked only
 * about a command that was not read, where the choice is between refusing a
 * command that may be local and letting a chain through unread.
 */
export function mentionsOutward(text: string): boolean {
  return mentions(text, /(?:^|[^A-Za-z0-9_-])(?:push|gh)(?:$|[^A-Za-z0-9_-])/);
}

/**
 * Whether the text names git at all. Asked only about a command too long or
 * too deeply nested to read: git may run an outward step under a name the
 * text does not show (an alias from settings given in front of it), and a
 * command of that size is rare enough to refuse.
 */
export function mentionsGit(text: string): boolean {
  return mentions(text, /(?:^|[^A-Za-z0-9_-])git(?:\.exe)?(?:$|[^A-Za-z0-9_-])/i);
}

function mentions(text: string, word: RegExp): boolean {
  // Also with each line continuation taken out, as the shell reads it: `pu`, a continuation and `sh` are `push`.
  // Any run of backslashes before a new line goes too: backticks make two of them one, and then a continuation.
  // And with every quote and backslash taken out, as the shell takes them out of a word: `pu"s"h`, `g\it`.
  const joined = text.replace(/\\+\n/g, "");

  return word.test(text) || word.test(joined) || word.test(joined.replace(/['"\\]/g, ""));
}

/**
 * The command's own words: no `VAR=value` in front, no `then`, `time`, `env`
 * or `xargs`, and none of what such a word takes before the command (`nice
 * -n 5`, `timeout 30s`, `command --`).
 *
 * Such a program's options are not all known here (`stdbuf -o L`, `xargs -I
 * {}`, `env -C dir`, `exec -a name`), and an option's value may itself be
 * `git` or `gh` (`env -C git git push`). So when one stands in front, each
 * later word that names a program this reads is tried in turn, and the first
 * that is an outward step, or runs a command from its argument, is taken for
 * the command; with none, the first such word. A wrong guess refuses a chain;
 * it lets none through. More than `WRAPPED_CANDIDATES` such words and the
 * stage is not read: `LimitError`.
 */
export function commandWords(stage: Stage): string[] {
  let start = 0;
  let led = false;

  // By index: a stage can hold hundreds of thousands of such words, and a copy of the rest for each takes longer than a host waits.
  for (; start < stage.length; start += 1) {
    const word = stage[start] ?? "";

    if (LEADING_WORDS.includes(programName(word))) {
      led = true;
    } else if (led && LEADING_OPTIONS_WITH_VALUE.includes(word)) {
      start += 1;
    } else if (!(ASSIGNMENT.test(word) || (led && (word.startsWith("-") || LEADING_VALUE.test(word))))) {
      break;
    }
  }

  return led ? stage.slice(wrappedStart(stage, start)) : stage.slice(start);
}

/** Where the command behind a wrapper starts: see `commandWords`. */
function wrappedStart(stage: Stage, start: number): number {
  let first: number | undefined;
  let tried = 0;

  for (let index = start; index < stage.length; index += 1) {
    if (!isJudged(stage[index] ?? "")) {
      continue;
    }

    tried += 1;

    if (tried > WRAPPED_CANDIDATES) {
      throw new WrappedLimitError(`a program that runs a command is followed by more than ${WRAPPED_CANDIDATES} words that name git, gh or a shell`);
    }

    const words = stage.slice(index);

    if (isOutward(words) || inlineScript(words) !== undefined) {
      return index;
    }

    first ??= index;
  }

  return first ?? start;
}

/** The program a word names: the last part of a path written with either slash, without `.exe`, in lower case. */
function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? "").replace(/\.exe$/i, "").toLowerCase();
}

/** A program whose words this reads: git, gh, and what runs a command from its argument. */
function isJudged(word: string): boolean {
  const program = programName(word);

  return program === "git" || program === "gh" || program === "eval" || SHELLS.includes(program);
}

function isGit(words: string[]): boolean {
  return programName(words[0] ?? "") === "git";
}

export function isOutward(words: string[]): boolean {
  if (isGit(words)) {
    const options = words.slice(1);
    const own = skipGitOptions(options);

    return GIT_OUTWARD.includes(own[0] ?? "") || setsAlias(options.slice(0, options.length - own.length)) || writesAlias(own);
  }

  const program = programName(words[0] ?? "");

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
    own[0] !== "push" ||
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

/**
 * Whether git's own options set an alias. The alias's name is the only word
 * the reader sees of the command it stands for, so a command that sets one is
 * taken for an outward step: refused in a chain, asked about alone.
 */
function setsAlias(options: string[]): boolean {
  return options.some((option, index) => {
    const value = option === "-c" || option === "--config-env" ? options[index + 1] : /^--config-env=(.*)$/.exec(option)?.[1];

    return ALIAS_SETTING.test(value ?? "");
  });
}

/**
 * Whether `git config` writes an alias, or a file that may hold one:
 * `git config alias.p push`, `git config set …`, `--add include.path …`. The
 * next step's `git p` is then all the reader sees of a push.
 */
function writesAlias(own: string[]): boolean {
  const args = own.slice(1);

  return own[0] === "config" && !onlyReads(args) && args.some((word) => ALIAS_SETTING.test(word));
}

/** Whether `git config` is given a read: a subcommand right after `config`, or a read option among the options in front of the key. */
function onlyReads(args: string[]): boolean {
  if (CONFIG_READ_COMMANDS.includes(args[0] ?? "")) {
    return true;
  }

  for (let index = 0; args[index]?.startsWith("-") && args[index] !== "--"; index += 1) {
    if (CONFIG_READ_OPTIONS.includes(args[index] ?? "")) {
      return true;
    }

    index += CONFIG_OPTIONS_WITH_VALUE.some((option) => option.startsWith(args[index] ?? "")) ? 1 : 0;
  }

  return false;
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

/**
 * What `env -S <text>` will run, when it can be read: env splits the text
 * into words, and goes on reading them as its own arguments (`-S '-i git
 * push'`), so it is what `env` with those words runs. No shell reads the
 * text: it is not a command line, as what `bash -c` takes is.
 *
 * An `env` this finds as the command (`standsFirst`) is refused when its
 * options or its text cannot be read. Any other only names it: `grep env -rn .`.
 */
function splitStringScript(stage: Stage): Script | undefined {
  const env = stage.findIndex((word) => programName(word) === "env");

  if (env === -1) {
    return undefined;
  }

  const sure = standsFirst(stage, env);
  const split = readEnvOptions(stage, env);

  if (split === "unread") {
    if (sure) {
      throw new UnreadEnvError("env is given an option that is not read here");
    }

    return undefined;
  }

  if (split === undefined) {
    return undefined;
  }

  // env reads its own quotes, its escapes (`\_`, `\t`) and `${NAME}` in the text: what it runs is then not this text.
  if (/[\\$'"]/.test(split.text)) {
    if (sure) {
      throw new UnreadEnvError("env -S is given text that env changes before it runs it");
    }

    return undefined;
  }

  // Split as env splits it, at any white space and up to a word that starts with `#`. Then quoted: to env `;` and `#x` are parts of words.
  const words = split.text.split(/\s+/);
  const end = words.findIndex((word) => word.startsWith("#"));
  const run = [...(end === -1 ? words : words.slice(0, end)), ...stage.slice(split.after)];

  return readScript(["env", ...run.map((word) => `'${word.replaceAll("'", "'\\''")}'`)].join(" "));
}

/**
 * Whether only what may stand before a command stands in front of this word.
 * A wrapper's options are not all known, so one may take the word after it
 * (`stdbuf -o L`, `timeout -s KILL`); a wrong guess refuses an `env` that was
 * no command, and lets none through.
 */
function standsFirst(stage: Stage, word: number): boolean {
  let led = false;

  for (let index = 0; index < word; index += 1) {
    const current = stage[index] ?? "";

    if (LEADING_WORDS.includes(programName(current))) {
      led = true;
    } else if (led && current.startsWith("-")) {
      index += stage[index + 1]?.startsWith("-") ? 0 : 1;
    } else if (!ASSIGNMENT.test(current) && !(led && LEADING_VALUE.test(current))) {
      return false;
    }
  }

  return true;
}

/**
 * Walks `env`'s options: the text of `-S` and the index of the word after it,
 * undefined when env gets no `-S`, "unread" at an option it does not have.
 */
function readEnvOptions(stage: Stage, env: number): { text: string; after: number } | "unread" | undefined {
  for (let index = env + 1; index < stage.length; index += 1) {
    const word = stage[index] ?? "";
    const taken = word.startsWith("--") && word !== "--" ? readEnvLongOption(word) : word.startsWith("-") && word.length > 1 && word !== "--" ? readEnvFlags(word) : undefined;

    if (taken === "unread") {
      return taken;
    }

    if (taken !== undefined) {
      const value = taken.value ?? (taken.takesValue ? stage[index + 1] : undefined);

      if (taken.split) {
        return value === undefined ? undefined : { text: value, after: index + (taken.value === undefined ? 2 : 1) };
      }

      index += taken.takesValue && taken.value === undefined ? 1 : 0;
    } else if (word !== "-" && !ASSIGNMENT.test(word)) {
      return undefined;
    }
  }

  return undefined;
}

/** What an option of `env` asks of the words after it. */
interface EnvOption {
  takesValue: boolean;
  /** Its value, when it is in the same word. */
  value?: string;
  /** It is `-S`: the value is a command line. */
  split: boolean;
}

/** `-iv`, `-uFOO`, `-vS text`: letters that join, up to one that takes a value. */
function readEnvFlags(word: string): EnvOption | "unread" {
  for (let at = 1; at < word.length; at += 1) {
    const flag = word.charAt(at);

    if (ENV_FLAGS_WITH_VALUE.includes(flag)) {
      const rest = word.slice(at + 1);

      return { takesValue: true, value: rest === "" ? undefined : rest, split: flag === "S" };
    }

    if (!ENV_FLAGS.includes(flag)) {
      return "unread";
    }
  }

  return { takesValue: false, split: false };
}

/** `--unset=FOO`, `--split-str text`. */
function readEnvLongOption(word: string): EnvOption | "unread" {
  const [name = "", ...value] = word.slice(2).split("=");
  const known = [...ENV_LONG_OPTIONS, ...ENV_LONG_OPTIONS_WITH_VALUE];
  const fits = known.includes(name) ? [name] : known.filter((option) => option.startsWith(name));
  const option = fits.length === 1 ? (fits[0] ?? "") : undefined;

  if (option === undefined) {
    return "unread";
  }

  return { takesValue: ENV_LONG_OPTIONS_WITH_VALUE.includes(option), value: value.length > 0 ? value.join("=") : undefined, split: option === "split-string" };
}

/** What `bash -c <text>` or `eval <text>` will run, when it can be read. */
function inlineScript(words: string[]): Script | undefined {
  const program = programName(words[0] ?? "");
  let text: string | undefined;

  if (program === "eval") {
    text = words.slice(1).join(" ");
  } else if (SHELLS.includes(program)) {
    const flag = words.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));

    text = flag === -1 ? undefined : words[flag + 1];
  }

  return text === undefined ? undefined : readScript(text);
}

/** The script a text holds, or undefined when it cannot be read. */
function readScript(text: string): Script | undefined {
  try {
    return parseShell(text);
  } catch (error) {
    if (error instanceof ShellError) {
      return undefined;
    }

    throw error;
  }
}
