// Reads the worktrees of a project and says which are finished and which
// hold work: `audit-worktrees.mts` is the program, this is what it does.
//
// It only reads. The one command here that changes anything is the fetch of
// origin's main branch, in `auditWorktrees`. Every other call to git asks a
// question (`worktree list`, `symbolic-ref`, `rev-parse`, `merge-base`,
// `rev-list`, `log`, `for-each-ref`, `status`), and the folders are only
// listed. A command that removes something is printed for a person and never
// run.

import { type Dirent, readdirSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";

import { BRANCH_PREFIX, defaultBranch, isBase, NAME, REMOTE } from "../new-worktree.mts";
import { shellWord, shown } from "./shown.mts";
import type { Ran, Run } from "./system.mts";

const TOOL = "worktree:audit";
const USAGE = "usage: audit-worktrees.mts [name-filter]   e.g. audit-worktrees.mts rates   (the filter is one plain word: letters, digits and . _ -)";
const MERGED = "MERGED";
const NOT_CLEAN = "MERGED, NOT CLEAN";
const UNMERGED = "UNMERGED";
const NOT_JUDGED = "NOT JUDGED";
/** A commit as git prints it in full: SHA-1 or SHA-256. Nothing else is handed to git as a commit. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** How many commits, files and entries are named before "and N more". */
const FIRST_FEW = 5;
/** A subject, a reason or a line of stderr is cut here: a line of the report stays a line. */
const LONGEST_TEXT = 120;

type Verdict = typeof MERGED | typeof NOT_CLEAN | typeof UNMERGED | typeof NOT_JUDGED;
type Git = (...args: string[]) => Ran;

/** 0: everything was read, and judged against origin's main as it is now. 2: something was not: the last line says what. */
export type ExitCode = 0 | 2;

export interface AuditOptions {
  /** Anywhere inside the project, or inside one of its worktrees. */
  cwd: string;
  argv: string[];
  /** The ages in the report are counted back from here. */
  now: Date;
  /** Runs git, with its output captured. */
  run: Run;
  report: (line: string) => void;
}

/** One entry of `git worktree list --porcelain`. */
export interface Listed {
  path: string;
  /** The commit it stands on, as git printed it. */
  head: string | undefined;
  /** The branch that is checked out, without `refs/heads/`. Undefined: none is (detached, or a bare repository). */
  branch: string | undefined;
  /** Why it is locked, "" when no reason was given. Undefined: it is not locked. */
  locked: string | undefined;
  /** Why git would prune it: its folder is gone. Undefined: git would not. */
  prunable: string | undefined;
}

interface Changed {
  path: string;
  untracked: boolean;
}

type Tree = { state: "clean" } | { state: "not clean"; changed: Changed[] } | { state: "gone" } | { state: "unread"; reason: string };

interface Judged {
  verdict: Verdict;
  /** The lines under the verdict. */
  lines: string[];
  /** True when a command that removes it is among them. */
  removable: boolean;
}

/** What a commit is judged against, and how to ask. */
interface Bench {
  git: Git;
  /** The full name of the ref: `refs/remotes/origin/main`. It never starts with `-`. */
  main: string;
  /** The same as a person writes it: `origin/main`. */
  mainName: string;
  now: Date;
  /** What git was asked and did not answer, each said where it happened. Any entry makes the report less than whole. */
  missed: string[];
}

export function auditWorktrees({ cwd, argv, now, run: runProgram, report: print }: AuditOptions): ExitCode {
  // Every line goes out through this, whatever it was put together from.
  const report = (line: string): void => print(shown(line));
  const [filter] = argv;

  if (argv.length > 1 || (filter !== undefined && !NAME.test(filter))) {
    report(USAGE);

    return 2;
  }

  const git: Git = (...args) => runProgram("git", args, cwd);
  // `-z`: a path is then one field whatever it holds. git has had it since 2.36 (2022).
  const listed = git("worktree", "list", "--porcelain", "-z");
  // The first entry is the project's own checkout, wherever this was run from.
  const [own, ...linked] = listed.status === 0 ? parseWorktrees(listed.stdout) : [];

  if (own === undefined) {
    report(`SKIP ${TOOL}: git could not list the worktrees of ${cwd} (${said(listed)}). It is not inside a git repository, or git is older than 2.36. Nothing was judged`);

    return 2;
  }

  const base = defaultBranch(git);

  // What `origin/HEAD` names is read from the repository, so it is checked like a word a person gave.
  if (!isBase(base)) {
    report(`SKIP ${TOOL}: ${REMOTE}'s main branch is recorded as "${base}", which is not a plain branch name. Nothing was judged`);

    return 2;
  }

  const bench: Bench = { git, main: `refs/remotes/${REMOTE}/${base}`, mainName: `${REMOTE}/${base}`, now, missed: [] };
  // The one call that changes the repository: without it the verdicts are against main as it was at the last fetch.
  const fetched = git("fetch", REMOTE, "--end-of-options", base);
  const mainTip = git("rev-parse", "--verify", "--quiet", "--end-of-options", `${bench.main}^{commit}`).stdout.trim();

  if (!COMMIT.test(mainTip)) {
    report(
      `SKIP ${TOOL}: this clone has no ${bench.mainName} to judge against${fetched.status === 0 ? "" : `, and could not fetch ${base} from ${REMOTE} (${said(fetched)})`}. Nothing was judged`,
    );

    return 2;
  }

  /** What makes this report less than whole. Empty: exit 0. */
  const gaps: string[] = [];
  const folder = join(dirname(own.path), `${basename(own.path)}-worktrees`);

  report(`${TOOL} of ${own.path}`);
  report(`judged against ${bench.mainName} at ${describeCommit(git, mainTip)}`);

  if (fetched.status === 0) {
    report(`  fetched from ${REMOTE} just now`);
  } else {
    const since = lastMoved(bench);

    report(`SKIP fetch: could not fetch ${base} from ${REMOTE} (${said(fetched)})`);
    report(`  The verdicts below are against ${bench.mainName} as this clone last had it, ${since}. Work merged since then reads as ${UNMERGED}`);
    gaps.push(`${base} could not be fetched from ${REMOTE}, so every verdict is against ${bench.mainName} as this clone last had it, ${since}`);
  }

  report(
    `note: a worktree is ${MERGED} when the commit it stands on is on ${bench.mainName}. A branch that reached main by a squash or a rebase reads as ${UNMERGED}: main then holds other commits than the branch's. The rule here is a merge commit (gh pr merge --merge)`,
  );

  const chosen = filter === undefined ? linked : linked.filter((worktree) => basename(worktree.path).includes(filter));
  const verdicts: Verdict[] = [];
  /** How many of the MERGED worktrees had a command printed. The others say why not under their verdict. */
  let commands = 0;

  if (filter !== undefined) {
    report(`filter: worktrees whose name holds "${filter}" (${chosen.length} of ${linked.length}). Orphan branches and stray folders are all listed`);
  }

  report("");

  if (linked.length === 0) {
    report("no linked worktree: this project has only its own checkout");
  } else if (chosen.length === 0) {
    report(`no worktree's name holds "${filter}"`);
    gaps.push(`no worktree's name holds "${filter}", so none of the ${count(linked.length, "linked worktree")} was judged`);
  }

  for (const worktree of chosen) {
    const { verdict, lines, removable: withCommand } = judgeWorktree(bench, runProgram, worktree);

    verdicts.push(verdict);
    commands += withCommand ? 1 : 0;
    report(`${verdict}  ${basename(worktree.path)}`);
    lines.forEach(report);
    report("");
  }

  const unjudged = verdicts.filter((verdict) => verdict === NOT_JUDGED).length;

  if (unjudged > 0) {
    gaps.push(`${count(unjudged, "worktree")} could not be judged`);
  }

  // A branch counts as checked out wherever it is: in the project's own checkout, and in a worktree the filter left out.
  const orphans = orphanBranches(bench, [own, ...linked]);

  report(orphans.title);
  orphans.lines.forEach(report);
  report("");
  gaps.push(...orphans.gaps);

  const strays = strayFolders(folder, linked);

  report(strays.title);
  strays.lines.forEach(report);
  report("");
  gaps.push(...strays.gaps, ...bench.missed);

  const tally = [MERGED, NOT_CLEAN, UNMERGED, NOT_JUDGED].map((verdict) => `${verdict} ${verdicts.filter((given) => given === verdict).length}`);
  const mergedWithoutCommand = verdicts.filter((verdict) => verdict === MERGED).length - commands;

  // MERGED is not "a command was printed": when the two numbers differ, the count gives both.
  if (mergedWithoutCommand > 0) {
    tally[0] = `${tally[0]} (a command for ${commands})`;
  }

  report(`count: ${count(verdicts.length, "worktree")} | ${tally.join(" | ")} | orphan branches ${orphans.found} | stray folders ${strays.found}`);

  for (const step of nextSteps(verdicts, commands > 0 || orphans.removable, mergedWithoutCommand, orphans.found + strays.found, own.path)) {
    report(`next: ${step}`);
  }

  if (gaps.length > 0) {
    report(`SKIP ${TOOL}: ${gaps.join("; ")}. This report is not whole, and is not to be read as one. Nothing was removed`);

    return 2;
  }

  report(`OK ${TOOL}: everything was read, and judged against ${bench.mainName} as fetched just now. Nothing was removed: this tool only reads`);

  return 0;
}

/** The entries of `git worktree list --porcelain -z`: the project's own checkout first, as git lists it. */
export function parseWorktrees(output: string): Listed[] {
  return output
    .split("\0\0")
    .filter((record) => record !== "")
    .map((record) => {
      const fields = new Map(
        record
          .split("\0")
          .filter((field) => field !== "")
          .map((field): [string, string] => {
            const space = field.indexOf(" ");

            return space === -1 ? [field, ""] : [field.slice(0, space), field.slice(space + 1)];
          }),
      );
      const ref = fields.get("branch");

      return {
        path: fields.get("worktree") ?? "",
        head: fields.get("HEAD"),
        branch: ref?.startsWith("refs/heads/") === true ? ref.slice("refs/heads/".length) : undefined,
        locked: fields.get("locked"),
        prunable: fields.get("prunable"),
      };
    });
}

function judgeWorktree(bench: Bench, runProgram: Run, worktree: Listed): Judged {
  const { path, branch, head, locked, prunable } = worktree;
  const lines = [
    `  path:    ${path}`,
    `  branch:  ${branch ?? "none: it is detached, so the verdict is about the commit it stands on"}`,
    ...(locked === undefined ? [] : [`  locked:  ${locked === "" ? "no reason was given" : cut(locked)}`]),
    ...(prunable === undefined ? [] : [`  prunable: ${cut(prunable)}`]),
  ];
  const onMain = isOnMain(bench, head);

  if (onMain === undefined) {
    return {
      verdict: NOT_JUDGED,
      lines: [...lines, `  git could not say whether its commit (${head ?? "none"}) is on ${bench.mainName}. No command is printed for it`],
      removable: false,
    };
  }

  lines.push(`  tip:     ${describeCommit(bench.git, head as string)}`);

  const tree = readTree(runProgram, worktree);

  if (!onMain) {
    return {
      verdict: UNMERGED,
      lines: [
        ...lines,
        ...commitsAhead(bench, head as string),
        `  tree:    ${describeTree(tree)}`,
        `  Live work${prunable === undefined ? "" : ", and its folder is gone: the commits are still in the repository"}. No removal command is printed for it`,
      ],
      removable: false,
    };
  }

  lines.push(`  tree:    ${describeTree(tree)}`);

  if (tree.state === "unread") {
    return {
      verdict: NOT_JUDGED,
      lines: [...lines, `  Its commit is on ${bench.mainName}, but whether the tree is clean is not known. No command is printed for it`],
      removable: false,
    };
  }

  if (tree.state === "not clean") {
    return {
      verdict: NOT_CLEAN,
      lines: [...lines, "  Not safe to remove without a look: removing the worktree deletes these files. No command is printed for it"],
      removable: false,
    };
  }

  // What `pnpm worktree` has just made for another session is exactly this, and a pasted removal would take the ground from under that session.
  if (standsWhereMainStood(bench, head as string)) {
    return {
      verdict: MERGED,
      lines: [
        ...lines,
        "  note:    its commit is one main itself once stood at, so it may hold no work of its own. A worktree just made looks like this: a session may be about to work in it",
        "  No command is printed for it. Ask whose it is first: it is finished only if nobody is about to use it",
      ],
      removable: false,
    };
  }

  if (locked !== undefined) {
    return {
      verdict: MERGED,
      lines: [...lines, "  It is locked, so git refuses to remove it, and no command is printed. Unlocking is for whoever locked it"],
      removable: false,
    };
  }

  const commands = removal(path, branch);

  return { verdict: MERGED, lines: [...lines, ...(commands ?? [noCommand(shellWord(path) === undefined ? "path" : "branch")])], removable: commands !== undefined };
}

/** True: the commit is on main. False: it is not. Undefined: git could not say. */
function isOnMain({ git, main }: Bench, commit: string | undefined): boolean | undefined {
  if (commit === undefined || !COMMIT.test(commit)) {
    return undefined;
  }

  // Exit 0: an ancestor. Exit 1: not one. Anything else: no such commit, a broken repository.
  const { status } = git("merge-base", "--is-ancestor", commit, main);

  return status === 0 ? true : status === 1 ? false : undefined;
}

/** How many commits main does not have, the first few of them, and how old the newest is. */
function commitsAhead({ git, main, mainName, now, missed }: Bench, tip: string): string[] {
  const counted = git("rev-list", "--count", `${main}..${tip}`);
  const total = Number(counted.stdout.trim());
  // Newest first. `%s` is the subject with its line ends taken out, so one commit is one line.
  const logged = git("log", "--no-show-signature", `--max-count=${FIRST_FEW}`, "--format=%h %ct %s", `${main}..${tip}`);

  if (counted.status !== 0 || logged.status !== 0 || !Number.isInteger(total)) {
    missed.push(`the commits of ${tip.slice(0, 7)} that are not on ${mainName} could not be listed`);

    return [`  commits: not on ${mainName}; git could not list them (${said(counted.status !== 0 ? counted : logged)})`];
  }

  const commits = logged.stdout.split("\n").filter((line) => line !== "");
  const newest = Number(commits[0]?.split(" ")[1]);

  return [
    `  commits: ${total} not on ${mainName}, the newest ${ago(now.getTime() / 1000 - newest)}`,
    ...commits.map((line) => {
      const [hash, , ...subject] = line.split(" ");

      return `           ${hash} ${cut(subject.join(" "))}`;
    }),
    ...(total > commits.length ? [`           and ${total - commits.length} more`] : []),
  ];
}

/**
 * True when the commit is on main's own line: the one main moves along, a
 * merge's first parent each time. A branch merged with a merge commit has its
 * tip off that line. One that never had a commit of its own has it on.
 */
function standsWhereMainStood({ git, main }: Bench, tip: string): boolean {
  // Main's own line, down to the tip's parents: short for a new worktree, and never main's whole history for an old one.
  const line = git("rev-list", "--first-parent", main, "--not", `${tip}^@`);

  // When git does not say, it is taken as one: the note is given and no command is printed. A look costs less than a session's worktree.
  return line.status !== 0 || line.stdout.split("\n").includes(tip);
}

/** What the worktree holds that no commit does: changed and untracked files. Ignored files are not looked at. */
function readTree(runProgram: Run, { path, prunable }: Listed): Tree {
  if (prunable !== undefined) {
    return { state: "gone" };
  }

  // `--no-optional-locks`: a session may be working in this tree, and a status that rewrote its index would be in its way.
  // `--untracked-files=normal`: a person's own setting can hide untracked files, and a tree that hides them reads as clean.
  const status = runProgram("git", ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=normal"], path);

  if (status.status !== 0) {
    return { state: "unread", reason: said(status) };
  }

  const changed = parseStatus(status.stdout);

  return changed.length === 0 ? { state: "clean" } : { state: "not clean", changed };
}

/** The entries of `git status --porcelain=v1 -z`. A rename is one entry: the name it had comes as a field of its own. */
function parseStatus(output: string): Changed[] {
  const fields = output.split("\0");
  const changed: Changed[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    const code = field.slice(0, 2);

    if (field === "") {
      continue;
    }

    changed.push({ path: field.slice(3), untracked: code === "??" });

    if (code.includes("R") || code.includes("C")) {
      index += 1;
    }
  }

  return changed;
}

function describeTree(tree: Tree): string {
  switch (tree.state) {
    case "clean":
      return "clean: no file is changed or untracked. Files git ignores are not looked at";
    case "gone":
      return "its folder is gone";
    case "unread":
      return `could not be read (${tree.reason})`;
    case "not clean":
      return `${count(tree.changed.length, "path")} not committed: ${tree.changed
        .slice(0, FIRST_FEW)
        .map(({ path, untracked }) => `${cut(path)} (${untracked ? "untracked" : "changed"})`)
        .join(", ")}${more(tree.changed.length)}`;
  }
}

/** The commands that remove a merged worktree and its branch. Undefined: one of the two cannot be written as a word, so neither is printed. */
function removal(path: string, branch: string | undefined): string[] | undefined {
  const folder = shellWord(path);
  const name = branch === undefined ? undefined : shellWord(branch);

  if (folder === undefined || (branch !== undefined && name === undefined)) {
    return undefined;
  }

  return [`  remove:  git worktree remove ${folder}`, ...(name === undefined ? [] : [`           git branch -D ${name}`])];
}

/** Said in place of a command whose path or branch would not be the same word when pasted. */
function noCommand(what: string): string {
  return `  No command is printed: its ${what} cannot be written as a word that names it when pasted. It holds a character that is written out above, or starts with a dash`;
}

interface Section {
  title: string;
  lines: string[];
  found: number;
  gaps: string[];
  /** True when a command that removes something is among the lines. */
  removable: boolean;
}

/** Local branches named `worktree-*` that no worktree has checked out, each judged like a worktree's tip. */
function orphanBranches(bench: Bench, worktrees: Listed[]): Section {
  // Every local branch, and the choice made here: a pattern handed to git does not match a name with a slash in it.
  const refs = bench.git("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads/");

  if (refs.status !== 0) {
    return { title: `orphan branches: could not be listed (${said(refs)})`, lines: [], found: 0, gaps: ["the local branches could not be listed"], removable: false };
  }

  const checkedOut = new Set(worktrees.map(({ branch }) => branch));
  const orphans = refs.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => ({ tip: line.slice(0, line.indexOf(" ")), name: line.slice(line.indexOf(" ") + 1 + "refs/heads/".length) }))
    .filter(({ name }) => name.startsWith(BRANCH_PREFIX) && !checkedOut.has(name));
  const lines: string[] = [];
  let unjudged = 0;
  let removable = false;

  for (const { tip, name } of orphans) {
    const onMain = isOnMain(bench, tip);

    if (onMain === undefined) {
      unjudged += 1;
      lines.push(`  ${NOT_JUDGED}  ${name}`, `    git could not say whether its commit is on ${bench.mainName}. No command is printed for it`);
      continue;
    }

    lines.push(`  ${onMain ? MERGED : UNMERGED}  ${name}`, `    tip:     ${describeCommit(bench.git, tip)}`);

    if (onMain) {
      const word = shellWord(name);

      removable = removable || word !== undefined;
      lines.push(word === undefined ? "    No command is printed: its name cannot be written as a word that names it when pasted" : `    remove:  git branch -D ${word}`);
    } else {
      lines.push(...commitsAhead(bench, tip).map((line) => `  ${line}`), "    Work that is on no worktree and not on main. No removal command is printed for it");
    }
  }

  return {
    title: orphans.length === 0 ? "orphan branches: none" : `orphan branches: ${orphans.length} (named ${BRANCH_PREFIX}*, checked out in no worktree)`,
    lines,
    found: orphans.length,
    gaps: unjudged === 0 ? [] : [`${count(unjudged, "orphan branch", "orphan branches")} could not be judged`],
    removable,
  };
}

/** What is in the project's worktree folder that git does not know as a worktree. Listed, with its top level, and left alone. */
function strayFolders(folder: string, linked: Listed[]): Section {
  const entries = entriesOf(folder);

  if (entries === "absent") {
    return { title: `stray folders: none (there is no ${folder})`, lines: [], found: 0, gaps: [], removable: false };
  }

  if (entries === "unread") {
    return { title: `stray folders: ${folder} could not be read`, lines: [], found: 0, gaps: [`${folder} could not be read`], removable: false };
  }

  // git lists a worktree by where it really is, and the folder's name comes from the same list.
  const known = linked.map(({ path }) => path);
  // Not a worktree itself, and not a folder on the way to one made by hand a level further down.
  const strays = entries.filter((entry) => {
    const at = join(folder, entry.name);

    return !known.includes(at) && !known.some((path) => path.startsWith(`${at}${sep}`));
  });

  if (strays.length === 0) {
    return { title: "stray folders: none", lines: [], found: 0, gaps: [], removable: false };
  }

  return {
    title: `stray folders: ${strays.length} (in ${folder}, and not a worktree git knows)`,
    // The name comes after a word of the tool's own: no line of the report starts with text from outside.
    lines: [...strays.map((entry) => `  STRAY  ${entry.name}: ${describeStray(folder, entry)}`), "  Listed only. What one holds is for a person to read before it goes"],
    found: strays.length,
    gaps: [],
    removable: false,
  };
}

function describeStray(folder: string, entry: Dirent): string {
  // A link is named and not followed: where it points is not this folder's.
  if (entry.isSymbolicLink()) {
    return "a link, not followed";
  }

  if (!entry.isDirectory()) {
    return "a file, not a folder";
  }

  const inside = entriesOf(join(folder, entry.name));

  if (inside === "absent" || inside === "unread") {
    return "a folder that could not be read";
  }

  const named = inside.slice(0, FIRST_FEW).map((item) => `${cut(item.name)}${item.isDirectory() ? "/" : ""}`);

  return inside.length === 0 ? "an empty folder" : `holds ${count(inside.length, "entry", "entries")}: ${named.join(", ")}${more(inside.length)}`;
}

/** What to do with the report. Each line is there only when the report holds what it is about. */
function nextSteps(verdicts: Verdict[], removable: boolean, withoutCommand: number, leftovers: number, project: string): string[] {
  const steps: string[] = [];

  if (verdicts.includes(MERGED) || leftovers > 0) {
    steps.push("ask a person before anything is removed, and name what will go. A worktree may belong to a session that is still running, which this tool cannot see");
  }

  if (removable) {
    steps.push(
      `run a "remove:" command from ${project}, not from inside the worktree it names. Removing a worktree deletes the files git ignores in it too. If git refuses, that is its answer: never add --force`,
    );
  }

  if (withoutCommand > 0) {
    steps.push(`${MERGED} with no "remove:" line under it: what stands there says why. Do not write the command by hand`);
  }

  if (verdicts.includes(NOT_CLEAN)) {
    steps.push(`${NOT_CLEAN}: read the files it names, and commit or discard them with their owner, before it is removed`);
  }

  if (verdicts.includes(UNMERGED)) {
    steps.push(`${UNMERGED}: work someone stopped in. Finish it through a pull request, or ask its owner; the branch is whole and can be picked up`);
  }

  return steps;
}

/** A commit in one line: its short hash, its day and its subject. */
function describeCommit(git: Git, commit: string): string {
  const logged = git("log", "-1", "--no-show-signature", "--format=%h %cs %s", commit);

  return logged.status === 0 ? cut(logged.stdout.trim()) : commit.slice(0, 9);
}

/** When this clone's copy of origin's main last moved, from its reflog: the last fetch that brought something. */
function lastMoved({ git, main, now }: Bench): string {
  // With a date format, the reflog's selector holds the entry's time: `origin/main@{1791881160}`.
  const entry = git("log", "-g", "-1", "--no-show-signature", "--date=unix", "--format=%gd", main);
  const at = /@\{(\d+)\}$/.exec(entry.stdout.trim())?.[1];

  return entry.status === 0 && at !== undefined ? `which last moved ${ago(now.getTime() / 1000 - Number(at))}` : "and git has no record of when that was";
}

function entriesOf(folder: string): Dirent[] | "absent" | "unread" {
  try {
    return readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unread";
  }
}

/** What git said when it failed, as one short line. */
function said({ status, stderr }: Ran): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return lines.length === 0 ? `exit ${status}` : cut(lines.join("; "));
}

function ago(seconds: number): string {
  if (seconds < 60) {
    return "under a minute ago";
  }

  if (seconds < 3600) {
    return `${count(Math.floor(seconds / 60), "minute")} ago`;
  }

  return seconds < 86_400 ? `${count(Math.floor(seconds / 3600), "hour")} ago` : `${count(Math.floor(seconds / 86_400), "day")} ago`;
}

function count(number: number, one: string, many = `${one}s`): string {
  return `${number} ${number === 1 ? one : many}`;
}

function more(total: number): string {
  return total > FIRST_FEW ? `, and ${total - FIRST_FEW} more` : "";
}

/** Text from outside, held to a length: by character, so that no pair is cut in half. */
function cut(text: string): string {
  const characters = Array.from(text);

  return characters.length > LONGEST_TEXT ? `${characters.slice(0, LONGEST_TEXT).join("")}...` : text;
}
