#!/usr/bin/env node
// Proves the agent-workflow add-on is in place in this project.
//
//   node tools/agent-workflow/check.mts
//
// It runs the hook on four commands: one it must refuse, one it must ask a
// person about (a push with a colon), and two it must say nothing about, of
// which one is a routine push that an older version of the hook let run
// without a prompt. Each is run as the hook is started now and as an older
// registration starts it. Then it reads each host's settings file to see that
// the hook is registered there.
//
// The session-start reminder of the weeks due in CHANGELOG.md is read the same
// way, under hooks.SessionStart, for the start source "startup".
//
// "Registered" is decided as each host decides whether to run a hook, by
// `lib/hook-registration.mts`: the group's matcher is read as the host reads
// it, and the entry must be a command hook with exactly the command line the
// add-on registers, with nothing that narrows or weakens the run. The
// installer's merge decides it with a copy of the same file.
//
// What is looked at beyond the two files: `.claude/settings.local.json`, for
// `disableAllHooks` only. What is not: a person's own settings and managed
// settings, which can add hooks and can switch these off; the `--settings`
// flag; and whether Codex has been told to trust this project's hooks, which
// it asks a person once per hook and which no file in the project records.
//
// A permission rule counts when its exact text is in `permissions.ask`.
// Claude Code's documentation says an `ask` rule wins over an `allow` rule,
// and a `deny` rule is stricter still, so neither is checked here. A rule an
// older version merged in that the host does not read as it was meant is
// named, so that a person takes it out.
//
// A host's settings file belongs to the project. What the project chose is
// reported as a NOTE: so is the rule that asks before an editing tool changes
// the hook, when the project took it out. These are failures: the hook does not behave (it
// answers a command with anything but what that command calls for); it is not registered in a
// settings file that exists; an `allow` rule with a `*` lets a push or a
// merge run unasked while the `ask` rules that catch a forced or destructive
// one are missing.
//
// It also renders each week of the project's CHANGELOG.md as the notes of a
// GitHub Release, offline, with the same function `sync-releases.mts --check`
// uses. A missing file or a file with no week is a SKIP line, not a failure.
//
// Exit 0: nothing failed. Exit 1: a FAIL line says what and how to fix it.
// Exit 2: no host settings file exists, so there was nothing to judge.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ASK_RULES, CLAUDE_LOCAL_SETTINGS, CLAUDE_SETTINGS, CODEX_HOOKS, COMMAND_NEEDS, DUE_HOOK_COMMANDS, DUE_HOOK_SCRIPT, EDIT_ASK_RULES, HOOK_COMMANDS, HOOK_SCRIPT, RETIRED_ARGUMENT, RETIRED_ASK_RULES, RETIRED_FILES, WIDE_ALLOW } from "./lib/host.mts";
import { groupRuns, hostOf } from "./lib/hook-registration.mts";
import { isMainModule } from "./lib/main.mts";
import { renderCheck } from "./lib/releases.mts";
import { installedIn } from "./requires.mts";

/** The name both hosts give the tool that runs a shell command. */
const SHELL_TOOL = "Bash";
/**
 * Claude Code's tool that runs a shell command and reports each line it
 * prints. The host judges its command by the rules for `Bash`, so an `allow`
 * rule for a push lets it push, and a hook registered for `Bash` alone never
 * sees it. Codex has no such tool.
 */
const WATCH_TOOL = "Monitor";
/** The start source the changelog reminder must run for, in both hosts. */
const START_SOURCE = "startup";
const REFUSED_SAMPLE = "git add -A && git commit -m wip && git push";
/** A push that names a work branch and writes to main. No permission rule can say it, so the hook asks. */
const ASKED_SAMPLE = "git push origin worktree-sample:main";
const UNANSWERED_SAMPLE = "git push origin main";
/** A routine push in the exact form an older version of the hook let run without a prompt. */
const ROUTINE_SAMPLE = "git push -u origin worktree-sample 2>&1 | tail -2";
const FIX = "Run the installer again (add-to-project.mts <project> agent-workflow): it merges what is missing and removes nothing";

type Settings = Record<string, unknown>;
/** A refusal, a question, nothing, or a hook that does not behave: it failed, or it gave an answer it must never give. */
type Decision = "deny" | "ask" | "none" | "broken" | `"${string}", which it must never answer`;

export interface CheckOptions {
  root: string;
  /** Runs the hook with a payload on its standard input, started with `args`. */
  runHook: (payload: unknown, args: string[]) => { status: number; stdout: string };
  report: (line: string) => void;
}

export function check({ root, runHook, report }: CheckOptions): number {
  let failed = false;
  let judged = 0;
  const fail = (line: string): void => {
    failed = true;
    report(`FAIL ${line}`);
  };
  const ask = (command: string, args: string[]): Decision =>
    decisionOf(runHook({ tool_name: "Bash", tool_input: { command }, cwd: root, permission_mode: "default" }, args));
  const asNow: string[] = [];
  const asBefore = [RETIRED_ARGUMENT];
  const samples: [string, Decision][] = [
    [REFUSED_SAMPLE, "deny"],
    [ASKED_SAMPLE, "ask"],
    [UNANSWERED_SAMPLE, "none"],
    [ROUTINE_SAMPLE, "none"],
  ];
  const wrong = samples
    .flatMap(([command, expected]) => [asNow, asBefore].map((args) => ({ command, args, expected, got: ask(command, args) })))
    .filter(({ expected, got }) => got !== expected);

  for (const { command, args, expected, got } of wrong) {
    fail(`hook: \`${command}\` started ${args.length === 0 ? "with no argument" : `with ${args.join(" ")}`} answered ${got.startsWith('"') ? got : `"${got}"`}, not "${expected}"`);
  }

  if (wrong.length === 0) {
    report("PASS hook: refuses an outward step joined to others, asks about a push that is not written plainly, and says nothing about a plain push alone, whatever it is started with");
  }

  for (const path of RETIRED_FILES.filter((file) => existsSync(join(root, file)))) {
    report(`NOTE setting: ${path} is no longer read. The hook lets nothing run without a prompt, whatever that file says. Delete it`);
  }

  for (const [host, path] of [
    ["Claude Code", CLAUDE_SETTINGS],
    ["Codex", CODEX_HOOKS],
  ] as const) {
    const settings = readSettings(root, path);

    if (settings === "absent") {
      report(`SKIP ${host}: there is no ${path}, so the hook does not run there`);
      continue;
    }

    judged += 1;

    if (settings === "unreadable") {
      fail(`${host}: ${path} is not a JSON object, so the host reads no hook from it`);
      continue;
    }

    // The command lines the add-on registers for this host, now and before. Any other is not vouched for.
    const known = [HOOK_COMMANDS[path], `${HOOK_COMMANDS[path]} ${RETIRED_ARGUMENT}`];
    const groups = groupsBeforeToolUse(settings);
    const registered = known.flatMap((command) => groups.filter((group) => groupRuns(group, command, SHELL_TOOL, hostOf(path))).map(() => command));
    const named = JSON.stringify(groups).includes(HOOK_SCRIPT);

    if (registered.length > 0) {
      report(`PASS ${host}: ${path} runs the hook before each shell command`);

      if (path === CLAUDE_SETTINGS && !known.some((command) => groups.some((group) => groupRuns(group, command, WATCH_TOOL, hostOf(path))))) {
        fail(
          `${host}: ${path} does not run the hook before a command given to the ${WATCH_TOOL} tool. Claude Code lets that tool run a command under the rules for ${SHELL_TOOL}, so a push allowed there is neither refused in a chain nor asked about. ${FIX}`,
        );
      }
    } else if (named) {
      fail(
        `${host}: ${path} names ${HOOK_SCRIPT} under hooks.PreToolUse, but not as a hook the host is known to run before a shell command. It needs a group whose matcher covers ${SHELL_TOOL}, and in it an entry of type "command" whose command is exactly \`${HOOK_COMMANDS[path]}\`, with no "if", not "async", and a timeout above 0 or none. ${FIX}`,
      );
    } else {
      fail(`${host}: ${path} does not register ${HOOK_SCRIPT} under hooks.PreToolUse. ${FIX}`);
    }

    if (sessionGroups(settings).some((group) => groupRuns(group, DUE_HOOK_COMMANDS[path], START_SOURCE, hostOf(path)))) {
      report(`PASS ${host}: ${path} runs the changelog reminder at the start of a session`);
    } else {
      fail(`${host}: ${path} does not run ${DUE_HOOK_SCRIPT} at the start of a session (hooks.SessionStart, for "${START_SOURCE}"), so the weeks due in CHANGELOG.md are not named. ${FIX}`);
    }

    for (const [file, switched] of [[path, settings], ...(path === CLAUDE_SETTINGS ? [[CLAUDE_LOCAL_SETTINGS, readSettings(root, CLAUDE_LOCAL_SETTINGS)] as const] : [])] as const) {
      if (typeof switched === "object" && switched.disableAllHooks !== undefined && switched.disableAllHooks !== false) {
        fail(`${host}: ${file} sets disableAllHooks, so no hook of the project runs, this one included. Take that setting out, or set it to false`);
      }
    }

    if (registered.length > 1) {
      report(`NOTE ${host}: ${path} registers the hook ${registered.length} times, so it runs that often before each command. Keep one`);
    }

    if (registered.some((command) => command.endsWith(RETIRED_ARGUMENT))) {
      report(`NOTE ${host}: ${path} starts the hook with ${RETIRED_ARGUMENT}, as an older version of the add-on did. The hook ignores it. Remove the argument when you like`);
    }

    if (path === CLAUDE_SETTINGS) {
      failed = judgePermissions(settings, report) || failed;
    }
  }

  const installed = installedIn(root) ?? [];

  for (const [command, needs] of Object.entries(COMMAND_NEEDS)) {
    if (!existsSync(join(root, ".claude/commands/workflow", `${command}.md`))) {
      fail(`command: .claude/commands/workflow/${command}.md is missing. ${FIX}`);
    } else if (needs !== undefined && !installed.includes(needs)) {
      report(`NOTE command /workflow:${command}: needs the "${needs}" add-on, which this project does not have. It stops and says so when run`);
    } else {
      report(`PASS command /workflow:${command}`);
    }
  }

  failed = judgeRendering(root, report) || failed;

  if (failed) {
    return 1;
  }

  if (judged === 0) {
    report(`SKIP agent-workflow: neither ${CLAUDE_SETTINGS} nor ${CODEX_HOOKS} exists, so no host runs the hook. That is not a pass. ${FIX}`);

    return 2;
  }

  return 0;
}

/**
 * Reports whether each week of CHANGELOG.md renders as the notes of a GitHub
 * Release, offline. A project with no file, or no week yet, has nothing to
 * render: that is a SKIP, not a failure. Returns true when a week fails.
 */
function judgeRendering(root: string, report: (line: string) => void): boolean {
  const file = join(root, "CHANGELOG.md");

  if (!existsSync(file)) {
    report("SKIP changelog releases: there is no CHANGELOG.md, so there is no release to render");

    return false;
  }

  const text = readFileSync(file, "utf8");
  const { weeks, problems } = renderCheck(text);

  if (weeks === 0) {
    report("SKIP changelog releases: CHANGELOG.md has no week yet, so there is no release to render");

    return false;
  }

  for (const problem of problems) {
    report(`FAIL changelog releases: ${problem}. Add the definition, or run \`pnpm changelog defs --write\``);
  }

  if (problems.length === 0) {
    report(`PASS changelog releases: ${weeks} week(s) of CHANGELOG.md render as release notes`);
  }

  return problems.length > 0;
}

/** Reports on the permission rules. Returns true when something failed. */
function judgePermissions(settings: Settings, report: (line: string) => void): boolean {
  const permissions = (settings.permissions ?? {}) as { allow?: unknown; ask?: unknown };
  const allow = Array.isArray(permissions.allow) ? (permissions.allow as unknown[]) : [];
  const ask = Array.isArray(permissions.ask) ? (permissions.ask as unknown[]) : [];
  const missingAsk = ASK_RULES.filter((rule) => !ask.includes(rule));
  const missingEdit = EDIT_ASK_RULES.filter((rule) => !ask.includes(rule));
  const wide = allow.filter((rule): rule is string => typeof rule === "string" && WIDE_ALLOW.test(rule));

  for (const rule of RETIRED_ASK_RULES.filter((retired) => ask.includes(retired))) {
    report(`NOTE Claude Code: ${rule} is still in permissions.ask. Claude Code reads it as a prefix that matches no command, and warns about it at each start. The hook asks about such a push now. Delete the rule`);
  }

  // The project may take the rule out: its settings are its own. It is told what that leaves open.
  report(
    missingEdit.length === 0
      ? "PASS Claude Code: an editing tool asks before it changes the hook (a shell command that writes it is not covered by any rule)"
      : `NOTE Claude Code: ${missingEdit.join(", ")} is not in permissions.ask, so an editing tool may change the hook that refuses a chain without asking. ${FIX}`,
  );

  for (const rule of wide) {
    report(`NOTE Claude Code: the allow rule ${rule} lets more run unasked than its words say: a "*" also matches a second branch, another flag, a "$(…)"`);
  }

  if (missingAsk.length > 0 && wide.length > 0) {
    report(`FAIL Claude Code: ${wide.join(", ")} allows by pattern, and a forced or destructive push, an --admin merge or the --apply of changelog tag or changelog:releases is not set to ask. Missing from permissions.ask: ${missingAsk.join(", ")}. ${FIX}`);

    return true;
  }

  report(
    missingAsk.length === 0
      ? `PASS Claude Code: all ${ASK_RULES.length} ask rules are in, so a forced or destructive push, an --admin merge and the --apply of changelog tag and changelog:releases ask whatever else allows them`
      : `NOTE Claude Code: ${missingAsk.length} of ${ASK_RULES.length} ask rules (forced or destructive pushes, --admin merges, the --apply of changelog tag and changelog:releases) are not in permissions.ask. No allow rule lets a push or a merge run by pattern, so those forms ask anyway`,
  );

  return false;
}

/** What a run of the hook answered. */
function decisionOf({ status, stdout }: { status: number; stdout: string }): Decision {
  if (status !== 0) {
    return "broken";
  }

  if (stdout.trim() === "") {
    return "none";
  }

  try {
    const decision = (JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecision?: unknown } }).hookSpecificOutput?.permissionDecision;

    return decision === "deny" || decision === "ask" ? decision : typeof decision === "string" ? `"${decision}", which it must never answer` : "broken";
  } catch {
    return "broken";
  }
}

function readSettings(root: string, path: string): Settings | "absent" | "unreadable" {
  const file = join(root, path);

  if (!existsSync(file)) {
    return "absent";
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Settings) : "unreadable";
  } catch {
    return "unreadable";
  }
}

/** The groups of hooks the settings register to run before a tool call. The event's name is read as the hosts read it: in this case only. */
function groupsBeforeToolUse(settings: Settings): unknown[] {
  const groups = (settings.hooks as { PreToolUse?: unknown } | undefined)?.PreToolUse;

  return Array.isArray(groups) ? groups : [];
}

/** The groups of hooks the settings register to run when a session starts. */
function sessionGroups(settings: Settings): unknown[] {
  const groups = (settings.hooks as { SessionStart?: unknown } | undefined)?.SessionStart;

  return Array.isArray(groups) ? groups : [];
}

/** Runs the shipped hook the way a host does: the payload on its standard input. */
export function createHookRunner(root: string): CheckOptions["runHook"] {
  return (payload, args) => {
    const file = join(root, HOOK_SCRIPT);

    if (!existsSync(file)) {
      return { status: 127, stdout: `${HOOK_SCRIPT} does not exist` };
    }

    const ran = spawnSync(process.execPath, [file, ...args], { cwd: root, input: JSON.stringify(payload), encoding: "utf8" });

    return { status: ran.status ?? 1, stdout: ran.stdout ?? "" };
  };
}

if (isMainModule(import.meta.url)) {
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

  process.exitCode = check({
    root,
    runHook: createHookRunner(root),
    report: (line) => console.log(line),
  });
}
