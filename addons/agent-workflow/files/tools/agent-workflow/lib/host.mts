// What this add-on asks of each host's settings file. The installer merges
// the same entries in (they are also in the add-on's manifest); `check.mts`
// reads them back from the project.

export const HOOK_SCRIPT = "tools/agent-workflow/hooks/split-outward-commands.mts";

/** The session-start hook that names the changelog weeks that are due. */
export const DUE_HOOK_SCRIPT = "tools/agent-workflow/hooks/changelog-due.mts";

/**
 * Where a project kept the setting of a feature this add-on no longer has.
 * Nothing reads either file. The same paths are in the manifest, under
 * `retiredFiles`, where the installer reads them.
 */
export const RETIRED_FILES = ["tools/agent-workflow.config.json", "tools/agent-workflow.config.mts"];

/** A start-up argument an older registration of the hook carries. The hook ignores it. */
export const RETIRED_ARGUMENT = "--host=claude-code";

export const CLAUDE_SETTINGS = ".claude/settings.json";
/** A person's own settings for the project. They win over the project's, and can switch every hook off. */
export const CLAUDE_LOCAL_SETTINGS = ".claude/settings.local.json";
export const CODEX_HOOKS = ".codex/hooks.json";

/** The command line the add-on registers the hook with, in each host's file. The same text is in the manifest. */
export const HOOK_COMMANDS: Record<string, string> = {
  [CLAUDE_SETTINGS]: `node "$CLAUDE_PROJECT_DIR/${HOOK_SCRIPT}"`,
  [CODEX_HOOKS]: `node ${HOOK_SCRIPT}`,
};

/** The command line the add-on registers the session-start hook with, in each host's file. The same text is in the manifest. */
export const DUE_HOOK_COMMANDS: Record<string, string> = {
  [CLAUDE_SETTINGS]: `node "$CLAUDE_PROJECT_DIR/${DUE_HOOK_SCRIPT}"`,
  [CODEX_HOOKS]: `node ${DUE_HOOK_SCRIPT}`,
};

/** The start sources each host runs the session-start hook for: the same three in both, since Codex has `clear` too. */
export const DUE_HOOK_MATCHERS: Record<string, string> = {
  [CLAUDE_SETTINGS]: "startup|resume|clear",
  [CODEX_HOOKS]: "startup|resume|clear",
};

/**
 * Always ask. The add-on ships no `allow` rule, and its hook allows nothing.
 * These rules are the backstop for a project that adds an `allow` rule of its
 * own: a rule here wins over any `allow`. None holds `:*`: Claude Code reads
 * that at the end of a rule as its older prefix form, and warns about it
 * anywhere else. The hook asks about a push that is not written plainly in their place.
 */
export const ASK_RULES = [
  "Bash(git push *--force*)",
  "Bash(git push -f*)",
  "Bash(git push * -f*)",
  "Bash(git push * +*)",
  "Bash(git push *--delete*)",
  "Bash(git push -d*)",
  "Bash(git push * -d*)",
  "Bash(git push *--mirror*)",
  "Bash(git push *--all*)",
  "Bash(git push *--tags*)",
  "Bash(git push *--prune*)",
  "Bash(gh pr merge *--admin*)",
  "Bash(pnpm changelog tag *--apply*)",
  "Bash(pnpm changelog:releases *--apply*)",
  "Bash(pnpm run changelog tag *--apply*)",
  "Bash(node tools/agent-workflow/changelog.mts tag *--apply*)",
  "Bash(pnpm run changelog:releases *--apply*)",
  "Bash(node tools/agent-workflow/sync-releases.mts *--apply*)",
];

/**
 * Rules an older version merged in that Claude Code does not read as they
 * were meant. `Bash(git push *:*)` ends in `:*`, so it is a prefix that holds
 * a literal `*`: it matches no push, and the host warns about it at each
 * start. A merge removes no rule, so the check names one that is still there.
 */
export const RETIRED_ASK_RULES = ["Bash(git push *:*)"];

/**
 * Always ask before an editing tool changes the hook or the files beside it.
 * The hook is what refuses a chain, so a change to it is a person's to make.
 * An `Edit` rule is the one Claude Code reads for every built-in tool that
 * edits a file; a leading `/` is the project's root. A shell command that
 * writes the same files (`sed -i`, a redirection, `git checkout`) is not an
 * editing tool, and no rule here sees it.
 */
export const EDIT_ASK_RULES = ["Edit(/tools/agent-workflow/**)"];

/** An `allow` rule with a `*` for a push, a pull request opened or a merge: a `*` also matches a second branch, another flag, a `$(…)`. */
export const WIDE_ALLOW = /^Bash\((?:git push|gh pr create|gh pr merge)\b.*\*.*\)$/;

/** Slash commands that work only with another add-on in the project. */
export const COMMAND_NEEDS: Record<string, string | undefined> = {
  status: undefined,
  docs: undefined,
  worktrees: undefined,
  changelog: undefined,
  "coverage-backfill": "coverage",
  "visual-tolerance-audit": "visual",
  "perf-audit": "performance",
};
