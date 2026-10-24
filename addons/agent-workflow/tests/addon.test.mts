import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { addToProject } from "../../../scripts/add-to-project.mts";
import { changelog } from "../files/tools/agent-workflow/changelog.mts";
import { judgeCall } from "../files/tools/agent-workflow/hooks/split-outward-commands.mts";
import { groupRuns, hostOf } from "../files/tools/agent-workflow/lib/hook-registration.mts";
import { isOutward } from "../files/tools/agent-workflow/lib/outward.mts";
import { ASK_RULES, CLAUDE_SETTINGS, CODEX_HOOKS, COMMAND_NEEDS, DUE_HOOK_COMMANDS, DUE_HOOK_MATCHERS, DUE_HOOK_SCRIPT, EDIT_ASK_RULES, HOOK_COMMANDS, HOOK_SCRIPT, RETIRED_ARGUMENT, RETIRED_ASK_RULES, RETIRED_FILES } from "../files/tools/agent-workflow/lib/host.mts";
import { ONCE_ALLOWED, OLD_SETTING_ON } from "./shapes.mts";
import { ADDON, createFolder, git, readJson, REPOSITORY, writeFile } from "./support.mts";

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

interface HostSettings {
  permissions?: { allow?: string[]; ask?: string[]; deny?: string[] };
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

interface Manifest {
  recommended: boolean;
  packageJson: Record<string, { scripts?: Record<string, string>; devDependencies?: Record<string, string> }>;
  gates: { fast: string[]; full: string[] };
  startingFiles: string[];
  retiredFiles: Record<string, { replacedBy?: string; note: string }>;
  retiredHookCommands: Record<string, string>;
  hostSettings: Record<string, HostSettings>;
  verify: string;
}

const MANIFEST = readJson<Manifest>(ADDON, "addon.json");
const FILES = readdirSync(join(ADDON, "files"), { recursive: true, encoding: "utf8" });
const WORKFLOW = readFileSync(join(ADDON, "files/.github/workflows/weekly-tag.yml"), "utf8");
const RELEASE_WORKFLOW = readFileSync(join(ADDON, "files/.github/workflows/sync-releases.yml"), "utf8");
const WRITER_WORKFLOW = readFileSync(join(ADDON, "files/.github/workflows/changelog-writer.yml"), "utf8");
const COMMANDS = Object.keys(COMMAND_NEEDS);
const SECTION = readFileSync(join(ADDON, "AGENTS.section.md"), "utf8");
const CLAUDE_HOOK = `node "$CLAUDE_PROJECT_DIR/${HOOK_SCRIPT}"`;
/** The group the add-on registers for the tool that runs a command and reports its lines. */
const MONITOR_GROUP = { matcher: "Monitor", hooks: [{ type: "command", command: CLAUDE_HOOK, timeout: 5 }] };
/** The rule that version had about its setting file. A merge takes nothing out, so it stays. */
const OLD_SETTING_RULE = "Edit(/tools/agent-workflow.config.json)";
/** For a test that starts the hook once per command of a table. */
const SPAWNS_TIMEOUT = 120_000;
/** How the version before this one had Claude Code start the hook. */
const OLD_CLAUDE_HOOK = `${CLAUDE_HOOK} ${RETIRED_ARGUMENT}`;

describe("the add-on's manifest", () => {
  it("is recommended: a new project ships its work this way unless it has a reason not to", () => {
    expect(MANIFEST.recommended).toBe(true);
  });

  it("adds scripts that each run a tool it ships, and proves itself with one of them", () => {
    const scripts = MANIFEST.packageJson["."]?.scripts ?? {};

    expect(Object.keys(scripts)).toEqual(["worktree", "worktree:audit", "changelog", "changelog:releases", "agent-workflow:check", "check:status"]);

    for (const script of Object.values(scripts)) {
      const tool = /^node (tools\/agent-workflow\/[\w-]+\.mts)$/.exec(script)?.[1];

      expect(tool !== undefined && existsSync(join(ADDON, "files", tool)), script).toBe(true);
    }

    expect(MANIFEST.verify).toBe("pnpm agent-workflow:check");
  });

  it("installs no package, and joins gate:fast with the status page's check only: a host's settings, which the hook check reads, are the project's to change", () => {
    expect(Object.values(MANIFEST.packageJson).filter((patch) => patch.devDependencies !== undefined)).toEqual([]);
    expect(MANIFEST.gates).toEqual({ fast: ["pnpm check:status"], full: [] });
  });

  it("leaves CHANGELOG.md to the project once it is written, and ships no setting", () => {
    expect(MANIFEST.startingFiles).toEqual(["CHANGELOG.md", "docs/STATUS.md", "docs/IDEAS.md"]);
    expect(FILES.filter((file) => /config/.test(file))).toEqual([]);
  });

  it("names both setting files it had before, with nothing in their place, and says to delete them", () => {
    expect(Object.keys(MANIFEST.retiredFiles)).toEqual(RETIRED_FILES);

    for (const path of RETIRED_FILES) {
      expect(MANIFEST.retiredFiles[path]?.replacedBy).toBeUndefined();
      expect(MANIFEST.retiredFiles[path]?.note).toContain("The hook no longer lets anything run without one, whatever this file says");
      expect(MANIFEST.retiredFiles[path]?.note).toContain("Delete the file.");
      expect(FILES).not.toContain(path);
    }
  });

  it("names the command line it registered for Claude Code before, and the one it registers now", () => {
    expect(MANIFEST.retiredHookCommands).toEqual({ [`${CLAUDE_HOOK} ${RETIRED_ARGUMENT}`]: CLAUDE_HOOK });
  });

  it("ships TypeScript and nothing else that runs", () => {
    expect(FILES.filter((file) => /\.(js|mjs|cjs|jsx|py|sh|bash)$/.test(file))).toEqual([]);
    expect(FILES.filter((file) => file.endsWith(".mts")).length).toBeGreaterThan(5);
  });

  it("registers the hook with the command lines the check looks for, each as an entry the host would run", () => {
    for (const path of [CLAUDE_SETTINGS, CODEX_HOOKS]) {
      const [group] = MANIFEST.hostSettings[path]?.hooks?.PreToolUse ?? [];

      expect(group?.hooks.map((hook) => hook.command)).toEqual([HOOK_COMMANDS[path]]);
      expect(groupRuns(group, HOOK_COMMANDS[path] as string, "Bash", hostOf(path))).toBe(true);
    }
  });

  it("asks each host for the same entries the project's own check looks for", () => {
    const claude = MANIFEST.hostSettings[CLAUDE_SETTINGS];
    const codex = MANIFEST.hostSettings[CODEX_HOOKS];

    expect(Object.keys(MANIFEST.hostSettings)).toEqual([CLAUDE_SETTINGS, CODEX_HOOKS]);
    expect(claude?.permissions).toEqual({ ask: [...ASK_RULES, ...EDIT_ASK_RULES] });
    expect(claude?.hooks).toEqual({
      PreToolUse: ["Bash", "Monitor"].map((matcher) => {
        return { matcher, hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${HOOK_SCRIPT}"`, timeout: 5 }] };
      }),
      SessionStart: [{ matcher: "startup|resume|clear", hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${DUE_HOOK_SCRIPT}"`, timeout: 5 }] }],
    });
    expect(Object.keys(codex ?? {})).toEqual(["hooks"]);
    expect(codex?.hooks?.SessionStart).toEqual([{ matcher: "startup|resume", hooks: [{ type: "command", command: `node ${DUE_HOOK_SCRIPT}`, statusMessage: "Checking the changelog", timeout: 5 }] }]);
    expect(codex?.hooks?.PreToolUse).toHaveLength(1);
    expect(codex?.hooks?.PreToolUse?.[0]?.matcher).toBe("Bash");
    expect(codex?.hooks?.PreToolUse?.[0]?.hooks[0]?.command).toBe(`node ${HOOK_SCRIPT}`);
    expect(JSON.stringify(MANIFEST.hostSettings)).not.toContain(RETIRED_ARGUMENT);
    expect(existsSync(join(ADDON, "files", HOOK_SCRIPT))).toBe(true);
    expect(existsSync(join(ADDON, "files", DUE_HOOK_SCRIPT))).toBe(true);
  });

  it("registers the reminder in both hosts with the matcher and command the check looks for", () => {
    expect(DUE_HOOK_SCRIPT).toBe("tools/agent-workflow/hooks/changelog-due.mts");
    expect(DUE_HOOK_COMMANDS).toEqual({ [CLAUDE_SETTINGS]: `node "$CLAUDE_PROJECT_DIR/${DUE_HOOK_SCRIPT}"`, [CODEX_HOOKS]: `node ${DUE_HOOK_SCRIPT}` });
    expect(DUE_HOOK_MATCHERS).toEqual({ [CLAUDE_SETTINGS]: "startup|resume|clear", [CODEX_HOOKS]: "startup|resume" });

    for (const path of [CLAUDE_SETTINGS, CODEX_HOOKS]) {
      const groups = MANIFEST.hostSettings[path]?.hooks?.SessionStart ?? [];

      expect(groups).toHaveLength(1);
      expect(groups[0]?.matcher).toBe(DUE_HOOK_MATCHERS[path]);
      expect(groups.some((group) => groupRuns(group, DUE_HOOK_COMMANDS[path] ?? "", "startup", hostOf(path)))).toBe(true);
    }
  });
});

// A model of how Claude Code matches a rule, from its documentation and from
// the code of version 2.1.296. `*` stands for any text, everything else is
// literal, and the whole command must match. A rule that ends in `:*` is the
// older prefix form: what stands before it is literal, a `*` included, and
// the command is that text or starts with it and a space. It is not the
// host's own code, so what it proves is that the rules say what they are
// meant to say, not that a given version of the host reads them so.
describe("the permission rules, read the way the host reads them", () => {
  it("are ask rules only: the add-on lets nothing run without a prompt", () => {
    expect(MANIFEST.hostSettings[CLAUDE_SETTINGS]?.permissions).toEqual({ ask: [...ASK_RULES, ...EDIT_ASK_RULES] });
    expect(JSON.stringify(MANIFEST.hostSettings)).not.toContain('"allow"');
    expect(JSON.stringify(MANIFEST.hostSettings)).not.toContain('"deny"');
  });

  it.each([
    "git push --force origin worktree-a",
    "git push -u origin worktree-a --force",
    "git push origin worktree-a --force-with-lease",
    "git push --force-with-lease=worktree-a origin worktree-a",
    "git push --force-if-includes origin worktree-a",
    "git push -f origin worktree-a",
    "git push origin worktree-a -f",
    "git push -u origin worktree-a -fu",
    "git push origin +worktree-a",
    "git push -u origin +worktree-a",
    "git push origin worktree-a +main",
    "git push origin worktree-a --delete main",
    "git push origin --delete worktree-a",
    "git push -d origin worktree-a",
    "git push origin -d worktree-a",
    "git push --mirror origin",
    "git push origin --mirror",
    "git push --all origin",
    "git push origin --all",
    "git push origin worktree-a --tags",
    "git push --tags",
    "git push --prune origin worktree-a",
    "gh pr merge 12 --admin",
    "gh pr merge 12 --merge --admin --delete-branch",
  ])("always asks: %s", (command) => {
    expect(asks(command)).toBe(true);
  });

  it.each([
    "git push",
    "git push origin main",
    "git push -u origin worktree-rates-filter",
    "git push origin worktree-f-key-fix",
    "git push -u origin worktree-force-refresh",
    "git push origin worktree-delete-button",
    "git push origin worktree-all-tags",
    "gh pr merge 12 --merge --delete-branch",
    "gh pr create --title t --body b",
    "git pushd --force",
  ])("says nothing about: %s", (command) => {
    expect(asks(command)).toBe(false);
  });

  it("hold no `:*`, which the host reads as a prefix at the end of a rule and warns about anywhere in one", () => {
    expect([...ASK_RULES, ...EDIT_ASK_RULES].filter((rule) => rule.includes(":*"))).toEqual([]);
    expect(JSON.stringify(MANIFEST.hostSettings)).not.toContain(":*");
  });

  it("no longer hold the rule for a push with a colon, which matched no push: the hook asks about that one", () => {
    expect(RETIRED_ASK_RULES).toEqual(["Bash(git push *:*)"]);
    expect(ASK_RULES.filter((rule) => RETIRED_ASK_RULES.includes(rule))).toEqual([]);
    expect(matches("Bash(git push *:*)", "git push origin worktree-a:main")).toBe(false);
    expect(matches("Bash(git push *:*)", "git push * origin")).toBe(true);
    expect(matches("Bash(git push *:**)", "git push origin worktree-a:main")).toBe(true);
    expect(asks("git push origin worktree-a:main")).toBe(false);
    expect(judgeCall({ tool_name: "Bash", tool_input: { command: "git push origin worktree-a:main" } })?.decision).toBe("ask");
  });
});

describe("the weekly-tag workflow", () => {
  it("pins every action by a full commit hash, with its version beside it", () => {
    const uses = [...WORKFLOW.matchAll(/^\s*-?\s*uses: (.+)$/gm)].map((match) => match[1] ?? "");

    expect(uses.length).toBeGreaterThan(0);

    for (const action of uses) {
      expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+/);
    }
  });

  it("uses the same pins as the starter's own workflow", () => {
    const starter = readFileSync(join(REPOSITORY, "starter/.github/workflows/ci.yml"), "utf8");

    for (const [, action] of WORKFLOW.matchAll(/uses: (\S+)/g)) {
      expect(starter).toContain(`uses: ${action}`);
    }
  });

  it("can only read by default, and gives the one job that writes exactly what it needs", () => {
    const [top, job] = WORKFLOW.split(/^jobs:$/m);

    expect(top).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect([...(job ?? "").matchAll(/^ {6}([\w-]+): (read|write) # \S.+$/gm)].map((match) => `${match[1]}: ${match[2]}`)).toEqual([
      "contents: write",
      "issues: write",
      "pull-requests: read",
    ]);
  });

  it("never runs twice at once, and never cancels a run that may be half way through tagging", () => {
    expect(WORKFLOW).toMatch(/^concurrency:\n {2}group: weekly-tag\n {2}cancel-in-progress: false\n/m);
  });

  it("does not leave the token in the checkout, and takes the history it needs", () => {
    expect(WORKFLOW).toMatch(/persist-credentials: false/);
    expect(WORKFLOW).toMatch(/fetch-depth: 0/);
  });

  it("puts no expression in a command line, and does not run on another repository's code", () => {
    const runs = [...WORKFLOW.matchAll(/^\s*run: (.+)$/gm)].map((match) => match[1] ?? "");

    expect(runs).toEqual(["node tools/agent-workflow/close-week.mts"]);
    expect(WORKFLOW).not.toMatch(/pull_request_target|workflow_run/);
    expect(WORKFLOW).toMatch(/^on:\n {2}schedule:\n {4}- cron: "5 0 \* \* 1"\n {2}workflow_dispatch:\n/m);
  });

  it("installs nothing before the step that holds the token that can write", () => {
    expect(WORKFLOW).not.toMatch(/pnpm install|npm install|corepack/);
    expect(WORKFLOW).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
  });
});

describe("the release workflow", () => {
  const pins = (text: string): string[] => [...text.matchAll(/^\s*-?\s*uses: (.+)$/gm)].map((match) => match[1] ?? "");

  it("pins the same actions, by the same commits, as the weekly-tag workflow", () => {
    expect(pins(RELEASE_WORKFLOW).length).toBeGreaterThan(0);
    expect(pins(RELEASE_WORKFLOW)).toEqual(pins(WORKFLOW));
    expect(pins(RELEASE_WORKFLOW).filter((action) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+/.test(action))).toEqual([]);
  });

  it("does nothing until the project sets the variable to true", () => {
    expect(RELEASE_WORKFLOW).toMatch(/^ {4}if: vars\.CHANGELOG_RELEASES == 'true' && /m);
  });

  it("writes on a push only to the default branch, whatever it is called, and checks that branch out", () => {
    expect(RELEASE_WORKFLOW).toMatch(/&& \(github\.event_name != 'push' \|\| github\.ref_name == github\.event\.repository\.default_branch\)$/m);
    expect(RELEASE_WORKFLOW).not.toMatch(/branches:/);
    expect(RELEASE_WORKFLOW).toMatch(/^ {10}ref: \$\{\{ github\.event\.repository\.default_branch \}\}$/m);
  });

  it("can only read by default, and gives the one job exactly contents: write", () => {
    const [top, job] = RELEASE_WORKFLOW.split(/^jobs:$/m);

    expect(top).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect([...(job ?? "").matchAll(/^ {6}([\w-]+): (read|write)$/gm)].map((match) => `${match[1]}: ${match[2]}`)).toEqual(["contents: write"]);
  });

  it("never runs twice at once, and never cancels a run that may be half way through writing", () => {
    expect(RELEASE_WORKFLOW).toMatch(/^concurrency:\n {2}group: sync-releases\n {2}cancel-in-progress: false\n/m);
  });

  it("does not leave the token in the checkout, and takes only the files it needs", () => {
    expect(RELEASE_WORKFLOW).toMatch(/persist-credentials: false/);
    expect(RELEASE_WORKFLOW).toMatch(/sparse-checkout: \|\n {12}CHANGELOG\.md\n {12}tools\/agent-workflow\n/);
  });

  it("runs on a change to the changelog or to the script it runs, and nowhere else but the clock and by hand", () => {
    expect(RELEASE_WORKFLOW).toMatch(/^on:\n {2}push:\n {4}paths:\n {6}- CHANGELOG\.md\n {6}- tools\/agent-workflow\/sync-releases\.mts\n {6}- tools\/agent-workflow\/lib\/releases\.mts\n {6}- tools\/agent-workflow\/lib\/changelog\.mts\n {2}schedule:\n {4}- cron: "30 0 \* \* 1"\n {2}workflow_dispatch:\n/m);
    expect(RELEASE_WORKFLOW).not.toMatch(/pull_request_target|workflow_run/);
  });

  it("puts no expression in the release job's command line: the repository and branch come through the environment", () => {
    const runs = [...RELEASE_WORKFLOW.matchAll(/^\s*run: (.+)$/gm)].map((match) => match[1] ?? "");

    expect(runs).toEqual(['node tools/agent-workflow/sync-releases.mts --repo "$GITHUB_REPOSITORY" --branch "$DEFAULT_BRANCH" --apply']);
    expect(RELEASE_WORKFLOW).toMatch(/^ {10}DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}$/m);
  });

  it("installs nothing before the release step that holds the token that can write", () => {
    expect(RELEASE_WORKFLOW).not.toMatch(/pnpm install|npm install|corepack/);
    expect(RELEASE_WORKFLOW).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
  });

  it("runs the script the manifest's changelog:releases runs, and ships it with what it imports", () => {
    expect(MANIFEST.packageJson["."]?.scripts?.["changelog:releases"]).toBe("node tools/agent-workflow/sync-releases.mts");
    expect(existsSync(join(ADDON, "files/tools/agent-workflow/lib/releases.mts"))).toBe(true);
  });
});

describe("the writer workflow", () => {
  const pins = (text: string): string[] => [...text.matchAll(/^\s*-?\s*uses: (.+)$/gm)].map((match) => match[1] ?? "");
  const jobs = WRITER_WORKFLOW.split(/^jobs:$/m)[1] ?? "";
  const writeJob = jobs.split(/^ {2}publish:$/m)[0] ?? "";
  const publishJob = jobs.split(/^ {2}publish:$/m)[1] ?? "";
  const stepsOf = (job: string): string[] => (job.split(/^ {4}steps:\n/m)[1] ?? "").split(/^ {6}- /m).slice(1);
  const writeSteps = stepsOf(writeJob);
  const publishSteps = stepsOf(publishJob);
  const indexOf = (steps: string[], needle: string): number => steps.findIndex((step) => step.includes(needle));
  const permissionsOf = (job: string): string[] => [...job.matchAll(/^ {6}([\w-]+): (read|write)(?: #.*)?$/gm)].map((match) => `${match[1]}: ${match[2]}`);
  const allowedTools = (): string[] => (WRITER_WORKFLOW.match(/--allowedTools "([^"]+)"/)?.[1] ?? "").split(",");
  const runsOf = (text: string): string[] => [...text.matchAll(/^ +run: (.*(?:\n {10,}.*)*)$/gm)].map((match) => match[1] ?? "");
  // Each of these is the commit of a release that was at least 7 days old when it was chosen.
  const PINS = [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
    "anthropics/claude-code-action@f27be6b65a4652f08a2ba3cff79114829b588967 # v1.0.252",
    "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2",
    "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2",
  ];

  it("runs nothing until CHANGELOG_WRITER is true", () => {
    expect(writeJob).toMatch(/^ {4}if: vars\.CHANGELOG_WRITER == 'true'$/m);
    expect(WRITER_WORKFLOW).toMatch(/^on:\n {2}schedule:\n {4}- cron: "0 1 \* \* 1"\n {2}workflow_dispatch:\n/m);
    expect(WRITER_WORKFLOW).not.toMatch(/pull_request_target|workflow_run/);
  });

  it("stops with a message when the secret is missing, as its first step, before anything is checked out or installed", () => {
    const first = writeSteps[0] ?? "";

    expect(first).toContain("ANTHROPIC_API_KEY is not set: add the secret or unset CHANGELOG_WRITER");
    expect(first).toMatch(/^ {10}ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}$/m);
    expect(first).toMatch(/^ {12}exit 1$/m);
    expect(first).not.toContain("uses:");
  });

  it("maps the exit of due to a flag: 0 is not due, 1 is due, anything else fails", () => {
    const due = writeSteps[indexOf(writeSteps, "id: due")] ?? "";

    expect(due).toContain("node tools/agent-workflow/changelog.mts due --ref HEAD");
    expect(due).toMatch(/if \[ "\$status" -eq 0 \]; then\n {12}echo "due=false" >> "\$GITHUB_OUTPUT"\n {10}elif \[ "\$status" -eq 1 \]; then\n/);
    expect(due).toMatch(/^ {16}echo "due=true"$/m);
    expect(due).toMatch(/ {10}else\n {12}cat "\$RUNNER_TEMP\/due\.txt"\n {12}exit 1\n {10}fi/);
    expect(due).toMatch(/^ {16}echo "weeks=\$weeks"$/m);
    expect(due).toMatch(/^ {16}echo "sha=\$\(git rev-parse HEAD\)"$/m);
    expect(due).toMatch(/^ {16}echo "newest=\$\{weeks##\* \}"$/m);
    expect(due).toMatch(/^ {16}echo "sha=\$\(git rev-parse HEAD\)"\n {14}\} >> "\$GITHUB_OUTPUT"$/m);
  });

  it("does not write while a changelog pull request is open", () => {
    const due = writeSteps[indexOf(writeSteps, "id: due")] ?? "";

    expect(due).toContain(`gh pr list --state open --author app/github-actions --json headRefName --jq '[.[] | select(.headRefName | startswith("changelog/"))] | length'`);
    expect(due).toMatch(/if \[ "\$open" -gt 0 \]; then\n {14}echo "due=false" >> "\$GITHUB_OUTPUT"\n {14}echo "an open changelog pull request is waiting for review" >> "\$GITHUB_STEP_SUMMARY"/);
    expect(due).toMatch(/^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  });

  it("checks what is due before installing or running Claude Code, and installs and runs only when it is", () => {
    const names = ["Check the secret", "actions/checkout@", "actions/setup-node@", "id: due", "enable-corepack", "pnpm install --frozen-lockfile", "anthropics/claude-code-action@", "actions/upload-artifact@"];

    expect(names.map((name) => indexOf(writeSteps, name))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    for (const index of [4, 5, 6, 7]) {
      expect(writeSteps[index]).toMatch(/^ {8}if: steps\.due\.outputs\.due == 'true'$/m);
    }
  });

  it("pins every action by commit, at the commits chosen, the same checkout and setup-node as weekly-tag", () => {
    expect(pins(WRITER_WORKFLOW).filter((action, index, all) => all.indexOf(action) === index).sort()).toEqual([...PINS].sort());
    expect(pins(WRITER_WORKFLOW).filter((action) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+/.test(action))).toEqual([]);
    expect(pins(WORKFLOW).filter((action) => !pins(WRITER_WORKFLOW).includes(action))).toEqual([]);
    expect(WRITER_WORKFLOW.match(/persist-credentials: false/g)?.length).toBe(2);
    expect(WRITER_WORKFLOW.match(/fetch-depth: 0/g)?.length).toBe(2);
  });

  it("splits the agent from the token that writes: two jobs, each with exactly its permissions", () => {
    expect(WRITER_WORKFLOW).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(WRITER_WORKFLOW).toMatch(/^concurrency:\n {2}group: changelog-writer\n {2}cancel-in-progress: false\n/m);
    expect(permissionsOf(writeJob)).toEqual(["contents: read", "pull-requests: read", "issues: read"]);
    expect(permissionsOf(publishJob)).toEqual(["contents: write", "pull-requests: write", "issues: read"]);
    expect([...jobs.matchAll(/^ {2}([\w-]+):$/gm)].map((match) => match[1])).toEqual(["write", "publish"]);
    expect(publishJob).not.toContain("anthropics/");
    expect(publishJob).not.toMatch(/pnpm install|corepack/);
    expect(writeJob).not.toMatch(/contents: write|pull-requests: write/);
  });

  it("hands the file over: publish needs write, runs only when write found a week due, and takes its outputs", () => {
    expect(publishJob).toMatch(/^ {4}needs: write$/m);
    expect(publishJob).toMatch(/^ {4}if: needs\.write\.result == 'success' && needs\.write\.outputs\.due == 'true'$/m);
    expect(writeJob).toMatch(/^ {4}outputs:\n {6}due: \$\{\{ steps\.due\.outputs\.due \}\}\n {6}sha: \$\{\{ steps\.due\.outputs\.sha \}\}\n {6}weeks: \$\{\{ steps\.due\.outputs\.weeks \}\}\n {6}newest: \$\{\{ steps\.due\.outputs\.newest \}\}\n/m);
    expect(writeSteps[indexOf(writeSteps, "actions/upload-artifact@")]).toMatch(/^ {10}path: CHANGELOG\.md$/m);
    expect(publishSteps.map((step) => /actions\/(checkout|setup-node|download-artifact)@/.exec(step)?.[1])).toEqual(["checkout", "setup-node", "download-artifact", undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(writeJob).toMatch(/^ {6}sha: \$\{\{ steps\.due\.outputs\.sha \}\}$/m);
    expect(publishJob).toMatch(/^ {6}WRITTEN_FROM: \$\{\{ needs\.write\.outputs\.sha \}\}$/m);
  });

  it("gives the agent only what it needs: its allowed tools are exact, with no git, no write through gh and no bare Write or Edit", () => {
    expect(allowedTools()).toEqual([
      "Read(./**)",
      "Edit(./CHANGELOG.md)",
      "Write(./CHANGELOG.md)",
      "Bash(pnpm changelog weeks)",
      "Bash(pnpm changelog prs:*)",
      "Bash(pnpm changelog check:*)",
      "Bash(pnpm changelog defs:*)",
      "Bash(pnpm changelog due:*)",
      "Bash(gh pr view:*)",
    ]);
    expect(WRITER_WORKFLOW).toMatch(/^ {12}--max-turns 40$/m);
    expect(WRITER_WORKFLOW).toMatch(/^ {12}--disallowedTools "Read\(\/\/proc\/\*\*\)"$/m);
    expect(WRITER_WORKFLOW).toMatch(/^ {12}--setting-sources user$/m);
    expect(WRITER_WORKFLOW).toMatch(/^ {6}CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"$/m);
  });

  it("never merges, and gives the agent a read-only token through the with block", () => {
    const agent = writeSteps[indexOf(writeSteps, "anthropics/claude-code-action@")] ?? "";

    expect(WRITER_WORKFLOW.replace(/^\s*#.*$/gm, "")).not.toMatch(/gh pr merge/);
    expect(agent).toMatch(/^ {10}github_token: \$\{\{ github\.token \}\}$/m);
    expect(agent).toMatch(/^ {10}anthropic_api_key: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}$/m);
    expect(agent).toMatch(/^ {12}Write or extend the changelog entries for these weeks: \$\{\{ steps\.due\.outputs\.weeks \}\}\.\n {12}Follow \.claude\/commands\/workflow\/changelog\.md, in its "In CI" section\.$/m);
  });

  it("checks the week names before it uses them, and copies only CHANGELOG.md, and only a change", () => {
    const take = publishSteps[indexOf(publishSteps, "Take the file")] ?? "";

    expect(take.match(/\^\[0-9\]\{4\}-W\[0-9\]\{2\}\$/g)?.length).toBe(2);
    expect(take).toContain('"$week" =~');
    expect(take).toContain('"$NEWEST" =~');
    expect(take).toMatch(/if ! git diff --quiet "\$WRITTEN_FROM" HEAD -- CHANGELOG\.md; then\n {12}echo "::error::CHANGELOG\.md changed on the default branch while the writer ran\. Run the workflow again"\n {12}exit 1/);
    expect(take.indexOf("WRITTEN_FROM\" HEAD")).toBeLessThan(take.indexOf("cp "));
    expect(take).toMatch(/cp "\$RUNNER_TEMP\/changelog\/CHANGELOG\.md" CHANGELOG\.md/);
    expect(take).toContain("git diff --quiet -- CHANGELOG.md");
    expect(take).toMatch(/the writer changed nothing in CHANGELOG\.md"\n {12}exit 1/);
  });

  it("refuses a file that has a token or a key added to it, and never prints the match", () => {
    const scan = publishSteps[indexOf(publishSteps, "Look for a token or a key")] ?? "";

    expect(indexOf(publishSteps, "Take the file")).toBeLessThan(indexOf(publishSteps, "Look for a token or a key"));
    expect(indexOf(publishSteps, "Look for a token or a key")).toBeLessThan(indexOf(publishSteps, "Commit CHANGELOG.md alone"));

    for (const pattern of ["sk-ant-", "ghs_", "ghp_", "gho_", "ghu_", "ghr_", "github_pat_", "-----BEGIN"]) {
      expect(scan).toContain(`'${pattern}'`);
    }

    expect(scan).toContain('git diff -U0 -- CHANGELOG.md | grep \'^+\' | grep -q -F -e "$pattern"');
    expect(scan).toMatch(/Nothing was committed"\n {14}exit 1/);
    expect(scan).not.toMatch(/echo [^\n]*\$match/);
  });

  it("checks each week, then commits CHANGELOG.md alone as the bot", () => {
    const check = publishSteps[indexOf(publishSteps, "id: check")] ?? "";
    const commit = publishSteps[indexOf(publishSteps, "Commit CHANGELOG.md alone")] ?? "";

    expect(check).toContain('node tools/agent-workflow/changelog.mts check "$week"');
    expect(check).toMatch(/^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
    expect(check).toContain('echo "failed=${failed# }" >> "$GITHUB_OUTPUT"');
    expect(commit).toContain("git add -- CHANGELOG.md");
    expect(commit).toContain('-c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -m "docs(changelog): ${WEEKS// /, }"');
  });

  it("pushes one branch by an explicit refspec, with the token on that command alone", () => {
    const push = publishSteps[indexOf(publishSteps, "Push the branch")] ?? "";

    expect(push).toContain('git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" push origin "HEAD:refs/heads/changelog/$NEWEST"');
    expect(push).toContain('echo "::add-mask::$auth"');
    expect(push).not.toMatch(/--force|-f |--mirror|--all|--tags|push -u/);
    expect(WRITER_WORKFLOW.match(/git (-c \S+ |-c "[^"]+" )*push/g)?.length).toBe(1);
    expect(WRITER_WORKFLOW.replace(/^\s*#.*$/gm, "")).not.toMatch(/git config|git remote/);
  });

  it("opens the pull request with a body of its own: the issues it closes, and a draft when a check failed", () => {
    const issues = publishSteps[indexOf(publishSteps, "id: issues")] ?? "";
    const open = publishSteps[indexOf(publishSteps, "Open the pull request")] ?? "";

    expect(issues).toContain('gh issue list --author app/github-actions --state open --search "in:title Changelog:"');
    expect(issues).toContain("endswith($week)");
    expect(issues).toMatch(/run: \|\n {10}set -o pipefail\n/);
    expect(open).toContain('body+=$\'\\n\'"Closes #$number"');
    expect(open).toContain("draft=(--draft)");
    expect(open).toContain('gh pr create --title "docs(changelog): ${WEEKS// /, }" --body "$body" --head "changelog/$NEWEST" "${draft[@]}"');
    expect(open).toMatch(/if \[ -n "\$FAILED" \]; then/);
  });

  it("puts no expression in a command line: every one goes through env", () => {
    const blocks = runsOf(WRITER_WORKFLOW);

    expect(blocks.length).toBe(11);
    expect(blocks.filter((block) => block.includes("${{"))).toEqual([]);
  });
});

describe("the mutants of this add-on", () => {
  // `mutation-check.mts` runs each `test` in a shell. Between backticks, or after
  // a dollar sign and a bracket, a shell runs what is written: a filter that
  // quoted the name of a test as a command between backticks once ran it.
  it("have no test command that a shell would read a second command out of", () => {
    const mutants = readJson<{ name?: string; test: string }[]>(ADDON, "tests/mutants.json");

    expect(mutants.length).toBeGreaterThan(100);
    expect(mutants.filter(({ test }) => /\x60|\$[({]/.test(test)).map(({ name, test }) => name ?? test)).toEqual([]);
  });
});

describe("the commands", () => {
  it("are the seven the check knows about", () => {
    expect(readdirSync(join(ADDON, "files/.claude/commands/workflow")).sort()).toEqual(COMMANDS.map((name) => `${name}.md`).sort());
  });

  it.each(COMMANDS)("%s says what it does, and what it may run", (name) => {
    const { frontmatter } = readCommand(name);

    expect(frontmatter).toMatch(/^description: \S.{20,}$/m);
    expect(frontmatter).toMatch(/^allowed-tools: /m);
  });

  // `allowed-tools` is what a command may run with no prompt while it is the
  // one running. The add-on's rule is that every outward step asks, so a
  // command is let run only what it names, and none of that leaves the
  // machine: by a closed list here, and by the hook's own reading of a step.
  it.each(COMMANDS)("%s may run unasked only what it names, each by its first words, and nothing that leaves the machine", (name) => {
    const { frontmatter, body } = readCommand(name);
    const needs = COMMAND_NEEDS[name];
    const scripts = new Set([
      ...scriptsOf(join(ADDON, "addon.json")),
      ...Object.keys(readJson<{ scripts: Record<string, string> }>(REPOSITORY, "starter/package.json").scripts),
      ...(needs === undefined ? [] : scriptsOf(join(REPOSITORY, "addons", needs, "addon.json"))),
    ]);
    const tools = (/^allowed-tools: (.+)$/m.exec(frontmatter)?.[1] ?? "").split(", ");
    const programs = tools.filter((tool) => tool.startsWith("Bash")).map((tool) => /^Bash\((.+):\*\)$/.exec(tool)?.[1] ?? `not a grant by first words: ${tool}`);
    const reads = /^(?:git (?:rev-parse|status|worktree list|rev-list|ls-files)|gh (?:pr (?:list|view)|run list|issue list|repo view)|grep|ls|node tools\/agent-workflow\/requires\.mts)$/;

    expect(tools.filter((tool) => !tool.startsWith("Bash") && !["Read", "Write", "Edit"].includes(tool))).toEqual([]);
    expect(programs.length).toBeGreaterThan(0);
    expect(programs.filter((program) => !reads.test(program) && !(program.startsWith("pnpm ") && scripts.has(program.slice(5))))).toEqual([]);
    expect(programs.filter((program) => isOutward(program.split(" ")))).toEqual([]);
    expect(programs.filter((program) => !body.includes(program))).toEqual([]);
  });

  it.each(["git push", "gh pr create", "gh pr merge", "gh workflow run", "gh api", "git fetch", "git grep", "git log", "gh run download", "git worktree remove", "git branch"])("no command may run %s unasked", (step) => {
    const granted = COMMANDS.flatMap((name) => (/^allowed-tools: (.+)$/m.exec(readCommand(name).frontmatter)?.[1] ?? "").split(", ").map((tool) => `${name}: ${tool}`));

    expect(granted.filter((grant) => grant.includes(`(${step}`) || /\((?:git|gh|pnpm|node|sh|bash|find):\*\)/.test(grant))).toEqual([]);
  });

  // A block run before the command is read is parsed by the host and matched
  // against `allowed-tools`. One it will not analyse yields an error in place
  // of data, and the command carries on. These commands have none.
  it.each(COMMANDS)("%s runs nothing before it is read", (name) => {
    expect(readCommand(name).text).not.toMatch(/!`/);
  });

  it.each(COMMANDS)("%s tells a host that does not fill in the arguments where to take them from", (name) => {
    const { body } = readCommand(name);

    expect(body).toContain("`$ARGUMENTS`");
    expect(body).toMatch(/this\s+host does not fill it in/);
  });

  it.each(Object.entries(COMMAND_NEEDS).filter(([, needs]) => needs !== undefined))(
    "%s first asks whether the %s add-on is there, and stops if it is not",
    (name, needs) => {
      const { body } = readCommand(name);
      const first = /^## (\d+)\. (.+)$/m.exec(body);

      expect(first?.[1]).toBe("0");
      expect(first?.[2]).toBe(`This needs the ${needs} add-on`);
      expect(body.slice(first?.index, body.indexOf("\n## ", (first?.index ?? 0) + 1))).toContain(`node tools/agent-workflow/requires.mts ${needs}`);
      expect(body).toMatch(/If it does not exit 0, report the line it printed and stop/);
      expect(existsSync(join(REPOSITORY, "addons", needs as string, "addon.json"))).toBe(true);
    },
  );

  it("needs no other add-on for the changelog", () => {
    expect(COMMAND_NEEDS.changelog).toBeUndefined();
    expect(readCommand("changelog").text).not.toContain("requires.mts");
  });

  it.each(["status", "docs", "worktrees"])("needs no other add-on for %s, which every project with this add-on can run", (name) => {
    expect(Object.hasOwn(COMMAND_NEEDS, name)).toBe(true);
    expect(COMMAND_NEEDS[name]).toBeUndefined();
    expect(readCommand(name).text).not.toContain("requires.mts");
  });

  it("has a command for the status that reads the page of what is left and changes nothing", () => {
    const { frontmatter, body } = readCommand("status");

    expect(body).toContain('grep -E "^## |^- \\*\\*" docs/STATUS.md');
    expect(body).toContain("gh run list --branch main");
    expect(frontmatter).toMatch(/^allowed-tools: (?:Bash\([^)]+\), )+Read$/m);
    expect(body).toContain("If the newest finished run of a\n   workflow on main failed, that is the first line");
  });

  it("has a command for the documents that sends each kind of finding to its place, and stops before it writes", () => {
    const { body } = readCommand("docs");
    const steps = [...body.matchAll(/^## (\d+\. .+)$/gm)].map((match) => match[1] ?? "");

    expect(body).toContain("| Work that is not done, or the end of work that was pending | `docs/STATUS.md`");
    expect(body).toContain("| An idea nobody has committed to | `docs/IDEAS.md` |");
    expect(steps).toEqual([
      "1. See what documents there are",
      "2. Decide where it belongs",
      "3. Read the nearest document in full",
      "4. Propose, then stop",
      "5. Write it, in a worktree",
      "6. Ship it",
    ]);
    expect(body).toContain("Wait for a yes.");
  });

  it("has a command for the worktrees that may run the audit and nothing that removes, and asks before anything goes", () => {
    const { frontmatter, body } = readCommand("worktrees");

    expect(frontmatter).toMatch(/^allowed-tools: Bash\(pnpm worktree:audit:\*\), Read$/m);
    expect(body).toContain("Never remove a worktree or delete a branch without a yes from the user");
    expect(body).toContain("- **Never `--force`.**");
    expect(body).toContain("- **Only what the audit printed a command for.**");
    expect(body).toContain("Exit\n2: something was not read or not judged");
  });

  it("has a command for the motion audit that never calls a run that did not happen a pass", () => {
    const { body } = readCommand("perf-audit");

    expect(body).toContain("pnpm perf:motion-audit --assert-still");
    expect(body).toContain('Report exit 2 as "not run", never as a pass.');
    expect(body).toContain("Wait for a yes before you change anything.");
  });

  it.each(COMMANDS)("%s names only scripts that this add-on, the one it needs, or the starter has", (name) => {
    const known = new Set([...scriptsOf(join(ADDON, "addon.json")), ...Object.keys(readJson<{ scripts: Record<string, string> }>(REPOSITORY, "starter/package.json").scripts)]);
    const needs = COMMAND_NEEDS[name];

    for (const script of needs === undefined ? [] : scriptsOf(join(REPOSITORY, "addons", needs, "addon.json"))) {
      known.add(script);
    }

    const named = [...readCommand(name).body.matchAll(/pnpm ([a-z][\w:-]*)/g)].map((match) => match[1] ?? "");

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((script) => !known.has(script))).toEqual([]);
  });

  it.each(COMMANDS)("%s has a skill of the same name for Codex, which points at it", (name) => {
    const skill = readFileSync(join(ADDON, "files/.agents/skills", `workflow-${name}`, "SKILL.md"), "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";

    expect(frontmatter).toMatch(new RegExp(`^name: workflow-${name}$`, "m"));
    expect(frontmatter).toMatch(/^description: Use when .{20,}$/m);
    expect(skill).toContain(`\`.claude/commands/workflow/${name}.md\``);
    expect(skill).toMatch(/`\$ARGUMENTS` is not filled in/);
  });

  it("has no skill for Codex without a command behind it", () => {
    expect(readdirSync(join(ADDON, "files/.agents/skills")).sort()).toEqual(COMMANDS.map((name) => `workflow-${name}`).sort());
  });
});

describe("the section for AGENTS.md", () => {
  it("names only scripts the add-on adds or the starter has", () => {
    const known = new Set([...scriptsOf(join(ADDON, "addon.json")), ...Object.keys(readJson<{ scripts: Record<string, string> }>(REPOSITORY, "starter/package.json").scripts)]);
    const named = [...SECTION.matchAll(/pnpm ([a-z][\w:-]*)/g)].map((match) => match[1] ?? "");

    expect(named).toContain("worktree");
    expect(named.filter((script) => !known.has(script))).toEqual([]);
  });

  it("points at command files that are shipped", () => {
    const paths = [...SECTION.matchAll(/`(\.claude\/commands\/workflow\/[\w-]+\.md)`/g)].map((match) => match[1] ?? "");

    expect(paths.map((path) => path.replace(/^.*\/|\.md$/g, "")).sort()).toEqual([...COMMANDS].sort());

    for (const path of paths) {
      expect(existsSync(join(ADDON, "files", path)), path).toBe(true);
    }
  });

  it("says every outward step asks, and names no setting, no argument and no pattern rule that would let one run", () => {
    expect(SECTION).toContain("The hook never lets a command run without a prompt.");
    expect(SECTION).toContain("of Claude Code it asks about a push that is not written plainly");
    expect(SECTION).not.toMatch(/agent-workflow\.config|--host=|worktree-\*|pr merge \*|pr create \*/);
  });

  it("takes a green pull request to main: a merge commit, found on main before the worktree goes, and main watched after", () => {
    expect(SECTION).toContain("gh pr merge <number> --merge");
    expect(SECTION).toContain("git merge-base --is-ancestor <commit> origin/main");
    expect(SECTION).toContain("gh run list --branch main --commit <merge commit>");
    expect(SECTION).not.toMatch(/gh pr merge [^\n]*--(squash|rebase|auto|admin)/);
  });
});

describe("the page of what is left that it starts a project with", () => {
  const status = readFileSync(join(ADDON, "files/docs/STATUS.md"), "utf8");
  const ideas = readFileSync(join(ADDON, "files/docs/IDEAS.md"), "utf8");
  const headings = [...status.matchAll(/^## (.+)$/gm)].map((match) => match[1] ?? "");

  it("has the sections the section of AGENTS.md names, in its order, and no entry", () => {
    const rows = [...SECTION.matchAll(/^\| ([A-Z][^|]+?) \| [^|]+ \|$/gm)].map((match) => match[1] ?? "");

    expect(headings).toEqual(["In progress", "Designed, not built", "Planned, and held by something", "Next, with no plan yet", "Waiting on a person", "Known limits"]);
    expect(rows.filter((row) => row !== "Section")).toEqual(headings);
    expect(status).not.toMatch(/^- /m);
  });

  it("has a line for the date of its last edit, which the section tells an agent to set", () => {
    expect(status).toContain("**Last updated: no entry yet**");
    expect(SECTION).toContain("Every edit sets `Last updated` to today's date.");
  });

  it("points at the page of ideas, which points back, and at the changelog beside the project's root", () => {
    expect(status).toContain("[IDEAS.md](IDEAS.md)");
    expect(status).toContain("(../CHANGELOG.md)");
    expect(ideas).toContain("[STATUS.md](STATUS.md)");
  });

  it("tells an agent to write what a piece of work leaves into the page, in that work's pull request", () => {
    expect(SECTION).toContain("Write each one into `docs/STATUS.md`, in the pull request of\nthe work that left it.");
    expect(SECTION).toContain("remove the entry, in that pull request");
  });
});

describe("the changelog it starts a project with", () => {
  it("has no week yet, and passes its own check for a week in which nothing was merged", () => {
    const root = createFolder({ "CHANGELOG.md": readFileSync(join(ADDON, "files/CHANGELOG.md"), "utf8") });
    const lines: string[] = [];
    const status = changelog({
      root,
      argv: ["check", "2026-W40", "--merged", ""],
      now: new Date("2026-10-06T00:00:00Z"),
      run: () => ({ status: 0, stdout: "git@github.com:acme/app.git\n", stderr: "" }),
      report: (line) => lines.push(line),
    });

    expect(lines).toEqual(["PASS changelog 2026-W40: 0 merged pull request(s), all cited, every citation defined"]);
    expect(status).toBe(0);
  });
});

describe("the add-on in a project that has the kit", () => {
  it("merges its hook and its rules into both hosts' settings, beside the kit's hooks", () => {
    const project = createProjectWithKit();
    const kitClaude = readJson<HostSettings>(project, CLAUDE_SETTINGS);
    const kitCodex = readJson<HostSettings>(project, CODEX_HOOKS);

    const result = addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });
    const claude = readJson<HostSettings>(project, CLAUDE_SETTINGS);
    const codex = readJson<HostSettings>(project, CODEX_HOOKS);

    expect(claude.hooks?.PostToolUse).toEqual(kitClaude.hooks?.PostToolUse);
    expect(claude.hooks?.Stop).toEqual(kitClaude.hooks?.Stop);
    expect(claude.hooks?.PreToolUse).toEqual(MANIFEST.hostSettings[CLAUDE_SETTINGS]?.hooks?.PreToolUse);
    expect(claude.permissions).toEqual({ ask: [...ASK_RULES, ...EDIT_ASK_RULES] });
    expect(codex.description).toBe(kitCodex.description);
    expect(codex.hooks?.Stop).toEqual(kitCodex.hooks?.Stop);
    expect(codex.hooks?.PreToolUse).toEqual(MANIFEST.hostSettings[CODEX_HOOKS]?.hooks?.PreToolUse);
    expect(claude.hooks?.SessionStart).toEqual(MANIFEST.hostSettings[CLAUDE_SETTINGS]?.hooks?.SessionStart);
    expect(codex.hooks?.SessionStart).toEqual(MANIFEST.hostSettings[CODEX_HOOKS]?.hooks?.SessionStart);
    expect(result.settingsChanges).toHaveLength(ASK_RULES.length + EDIT_ASK_RULES.length + 5);
    expect(result.unmerged).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it("leaves both settings files byte for byte as they were when it is added a second time", () => {
    const project = createProjectWithKit();

    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    const before = [CLAUDE_SETTINGS, CODEX_HOOKS].map((path) => readFileSync(join(project, path), "utf8"));
    const again = addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    expect([CLAUDE_SETTINGS, CODEX_HOOKS].map((path) => readFileSync(join(project, path), "utf8"))).toEqual(before);
    expect(again.settingsChanges).toEqual([]);
    expect(again.files.written).toEqual([]);
  });

  it("never drops a rule, a hook or a setting the project added, before or after", () => {
    const project = createProjectWithKit();
    const own = readJson<HostSettings>(project, CLAUDE_SETTINGS);

    own.model = "opus";
    own.permissions = { allow: ["Bash(make *)"], deny: ["Bash(rm -rf *)"], ask: ["Bash(npm publish *)"] };
    own.hooks = { ...own.hooks, PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "node tools/own/guard.mts" }] }] };
    writeFile(project, CLAUDE_SETTINGS, JSON.stringify(own));

    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    const merged = readJson<HostSettings>(project, CLAUDE_SETTINGS);

    merged.permissions?.allow?.push("Bash(pnpm test)");
    writeFile(project, CLAUDE_SETTINGS, JSON.stringify(merged));
    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    const final = readJson<HostSettings>(project, CLAUDE_SETTINGS);

    expect(final.model).toBe("opus");
    expect(final.permissions).toEqual({
      allow: ["Bash(make *)", "Bash(pnpm test)"],
      deny: ["Bash(rm -rf *)"],
      ask: ["Bash(npm publish *)", ...ASK_RULES, ...EDIT_ASK_RULES],
    });
    expect(final.hooks?.PreToolUse?.map((group) => group.hooks[0]?.command)).toEqual([
      "node tools/own/guard.mts",
      CLAUDE_HOOK,
      CLAUDE_HOOK,
    ]);
    expect(final.hooks?.Stop).toEqual(own.hooks.Stop);
  });

  it("adds a rule again that the project took out: it cannot tell a rule removed from one never added", () => {
    const project = createProjectWithKit();

    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    const settings = readJson<HostSettings>(project, CLAUDE_SETTINGS);

    settings.permissions = { ...settings.permissions, ask: [...ASK_RULES, ...EDIT_ASK_RULES].filter((rule) => !rule.includes("--tags")) };
    writeFile(project, CLAUDE_SETTINGS, JSON.stringify(settings));

    const again = addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    expect(again.settingsChanges).toEqual([`${CLAUDE_SETTINGS}: permissions.ask: Bash(git push *--tags*)`]);
  });

  it("proves itself in the project it was just added to, with the command the manifest names", () => {
    const project = createProjectWithKit();

    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    const script = readJson<{ scripts: Record<string, string> }>(project, "package.json").scripts["agent-workflow:check"] ?? "";
    const verify = spawnSync(process.execPath, script.replace(/^node /, "").split(" "), { cwd: project, encoding: "utf8" });

    expect(MANIFEST.verify).toBe("pnpm agent-workflow:check");
    expect(verify.stdout).toContain("PASS hook: refuses an outward step joined to others, asks about a push that is not written plainly, and says nothing about a plain push alone, whatever it is started with");
    expect(verify.stdout).not.toMatch(/NOTE (?:setting|Claude Code|Codex)/);
    expect(verify.stdout).toContain("PASS Claude Code: all 18 ask rules are in");
    expect(verify.stdout).toContain("PASS Codex: .codex/hooks.json runs the hook before each shell command");
    expect(verify.stdout).not.toContain("FAIL");
    expect(verify.status).toBe(0);
  });

  it("fails that proof once the hook is taken out of a host's settings", () => {
    const project = createProjectWithKit();

    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    const codex = readJson<HostSettings>(project, CODEX_HOOKS);

    delete codex.hooks?.PreToolUse;
    writeFileSync(join(project, CODEX_HOOKS), JSON.stringify(codex));

    const verify = spawnSync(process.execPath, ["tools/agent-workflow/check.mts"], { cwd: project, encoding: "utf8" });

    expect(verify.status).toBe(1);
    expect(verify.stdout).toContain("FAIL Codex: .codex/hooks.json does not register");
  });

  it("leaves a project that had the old setting and the old registration right: its hook started as it is now, the rest of its entry kept, and the one for the Monitor tool beside it", () => {
    const project = createProjectAsBefore();
    const before = readJson<HostSettings>(project, CLAUDE_SETTINGS);

    const updated = addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });
    const after = readJson<HostSettings>(project, CLAUDE_SETTINGS);

    expect(after.hooks?.PreToolUse).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: CLAUDE_HOOK, timeout: 30 }] }, MONITOR_GROUP]);
    expect({ ...after, hooks: { ...after.hooks, PreToolUse: before.hooks?.PreToolUse } }).toEqual(before);
    expect(after.permissions?.ask).toEqual([...ASK_RULES, ...EDIT_ASK_RULES, OLD_SETTING_RULE]);
    expect([...updated.settingsChanges].sort()).toEqual([`${CLAUDE_SETTINGS}: hooks.PreToolUse: ${CLAUDE_HOOK}`, `${CLAUDE_SETTINGS}: hooks.PreToolUse: ${OLD_CLAUDE_HOOK} is now ${CLAUDE_HOOK}`].sort());
    expect(updated.created).toEqual([]);
    expect(updated.unmerged).toEqual([]);
    expect(updated.notes).toEqual(RETIRED_FILES.map((path) => `${path} is no longer read, and nothing took its place. ${MANIFEST.retiredFiles[path]?.note}`));
    expect(readJson(project, RETIRED_FILES[0] as string)).toEqual(OLD_SETTING_ON);
    // The files of the removed feature went with the update: only what the add-on ships now is left.
    expect(readdirSync(join(project, "tools/agent-workflow/lib")).sort()).toEqual(readdirSync(join(ADDON, "files/tools/agent-workflow/lib")).sort());
  });

  it("passes its proof in such a project, and notes the setting files that are left", () => {
    const project = createProjectAsBefore();

    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    const verify = spawnSync(process.execPath, ["tools/agent-workflow/check.mts"], { cwd: project, encoding: "utf8" });

    expect(verify.stdout).toContain(`NOTE setting: ${RETIRED_FILES[0]} is no longer read`);
    expect(verify.stdout).toContain(`NOTE setting: ${RETIRED_FILES[1]} is no longer read`);
    expect(verify.stdout).toContain("PASS Claude Code: an editing tool asks before it changes the hook");
    expect(verify.stdout).not.toContain(RETIRED_ARGUMENT);
    expect(verify.stdout).not.toContain("registers the hook");
    expect(verify.stdout).not.toContain("FAIL");
    expect(verify.status).toBe(0);
  });

  it("notes the old argument in its proof before the update, and fails for one thing only: no hook before the Monitor tool", () => {
    const project = createProjectAsBefore();
    const verify = spawnSync(process.execPath, ["tools/agent-workflow/check.mts"], { cwd: project, encoding: "utf8" });

    expect(verify.stdout).toContain(`NOTE Claude Code: ${CLAUDE_SETTINGS} starts the hook with ${RETIRED_ARGUMENT}`);
    expect(verify.stdout.split("\n").filter((line) => line.startsWith("FAIL"))).toEqual([expect.stringContaining("does not run the hook before a command given to the Monitor tool")]);
    expect(verify.status).toBe(1);

    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    expect(spawnSync(process.execPath, ["tools/agent-workflow/check.mts"], { cwd: project, encoding: "utf8" }).status).toBe(0);
  }, SPAWNS_TIMEOUT);

  it("answers as it should when started by the old registration, in that project, with the old setting on", () => {
    const project = createProjectAsBefore();
    const startHook = (command: string) =>
      spawnSync("/bin/sh", ["-c", OLD_CLAUDE_HOOK], {
        cwd: project,
        env: { ...process.env, CLAUDE_PROJECT_DIR: project },
        input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: project, permission_mode: "default" }),
        encoding: "utf8",
      });

    for (const command of ONCE_ALLOWED) {
      expect(startHook(command), command).toMatchObject({ status: 0, stdout: "", stderr: "" });
    }

    expect(startHook("git commit -m wip && git push -u origin worktree-a").stdout).toContain('"permissionDecision":"deny"');
  }, SPAWNS_TIMEOUT);

  it("rewrites the old registration where it stands, and takes nothing out, in a project that has the new one in a group beside it", () => {
    const project = createProjectAsBefore();
    const settings = readJson<HostSettings>(project, CLAUDE_SETTINGS);
    const beside = { matcher: "Edit", hooks: [{ type: "command", command: CLAUDE_HOOK, timeout: 5 }] };

    settings.hooks?.PreToolUse?.unshift(beside);
    writeFile(project, CLAUDE_SETTINGS, JSON.stringify(settings));

    const updated = addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    expect(readJson<HostSettings>(project, CLAUDE_SETTINGS).hooks?.PreToolUse).toEqual([beside, { matcher: "Bash", hooks: [{ type: "command", command: CLAUDE_HOOK, timeout: 30 }] }, MONITOR_GROUP]);
    expect([...updated.settingsChanges].sort()).toEqual([`${CLAUDE_SETTINGS}: hooks.PreToolUse: ${CLAUDE_HOOK}`, `${CLAUDE_SETTINGS}: hooks.PreToolUse: ${OLD_CLAUDE_HOOK} is now ${CLAUDE_HOOK}`].sort());
    expect(addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" }).settingsChanges).toEqual([]);
  });

  it("adds its two groups in a project whose only copy of the hook is under a matcher that runs for no shell command, and its proof says why", () => {
    const project = createProjectWithKit();

    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    const settings = readJson<HostSettings>(project, CLAUDE_SETTINGS);
    const moved = [{ matcher: "Nothing", hooks: [{ type: "command", command: CLAUDE_HOOK, timeout: 5 }] }];

    writeFile(project, CLAUDE_SETTINGS, JSON.stringify({ ...settings, hooks: { ...settings.hooks, PreToolUse: moved } }));

    const proof = spawnSync(process.execPath, ["tools/agent-workflow/check.mts"], { cwd: project, encoding: "utf8" });

    expect(proof.status).toBe(1);
    expect(proof.stdout).toContain(`FAIL Claude Code: ${CLAUDE_SETTINGS} names ${HOOK_SCRIPT} under hooks.PreToolUse, but not as a hook the host is known to run before a shell command.`);

    const updated = addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    expect(updated.settingsChanges).toEqual([`${CLAUDE_SETTINGS}: hooks.PreToolUse: ${CLAUDE_HOOK}`, `${CLAUDE_SETTINGS}: hooks.PreToolUse: ${CLAUDE_HOOK}`]);
    expect(readJson<HostSettings>(project, CLAUDE_SETTINGS).hooks?.PreToolUse).toEqual([...moved, ...(MANIFEST.hostSettings[CLAUDE_SETTINGS]?.hooks?.PreToolUse ?? [])]);
    expect(spawnSync(process.execPath, ["tools/agent-workflow/check.mts"], { cwd: project, encoding: "utf8" }).status).toBe(0);
  }, SPAWNS_TIMEOUT);

  it("says a setting file is left on each update until it is deleted, and changes the settings once", () => {
    const project = createProjectAsBefore();
    const update = () => addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    expect(update().notes).toHaveLength(2);

    const again = update();

    expect(again.notes).toHaveLength(2);
    expect(again.settingsChanges).toEqual([]);

    rmSync(join(project, RETIRED_FILES[1] as string));

    expect(update().notes).toHaveLength(1);

    rmSync(join(project, RETIRED_FILES[0] as string));

    expect(update().notes).toEqual([]);
  });

  it("exits 3, and lists what was not merged, when the project's settings hold a value of another kind where its rules go", () => {
    const project = createProjectWithKit();
    const settings = readJson<Record<string, unknown>>(project, CLAUDE_SETTINGS);

    writeFile(project, CLAUDE_SETTINGS, JSON.stringify({ ...settings, permissions: { ask: "Bash(x)" } }));

    const run = spawnSync(process.execPath, [join(REPOSITORY, "scripts/add-to-project.mts"), project, "agent-workflow", "--scope", "@acme"], { encoding: "utf8" });

    expect(run.status).toBe(3);
    expect(run.stdout).toContain("Not merged: 1 place(s) in a host's settings file. The add-on is not whole until they are (exit 3):");
    expect(run.stdout).toContain(`  - ${CLAUDE_SETTINGS}: permissions.ask is a value in the project and a list is needed there, so ${ASK_RULES.length + EDIT_ASK_RULES.length} entries were not merged: Bash(git push *--force*); `);
    expect(run.stdout).not.toContain("Still to do by hand:");
    expect(run.stdout).toContain(`merged   ${CLAUDE_SETTINGS}: hooks.PreToolUse:`);

    // The project's own check passes while nothing allows a push by pattern, and fails once a rule does: the rules that back it are not there.
    expect(spawnSync(process.execPath, ["tools/agent-workflow/check.mts"], { cwd: project, encoding: "utf8" }).status).toBe(0);

    writeFile(project, CLAUDE_SETTINGS, JSON.stringify({ ...readJson<HostSettings>(project, CLAUDE_SETTINGS), permissions: { ask: "Bash(x)", allow: ["Bash(git push *)"] } }));

    expect(spawnSync(process.execPath, ["tools/agent-workflow/check.mts"], { cwd: project, encoding: "utf8" }).status).toBe(1);
  }, SPAWNS_TIMEOUT);

  it("exits 0 when everything went in", () => {
    const project = createProjectWithKit();
    const run = spawnSync(process.execPath, [join(REPOSITORY, "scripts/add-to-project.mts"), project, "agent-workflow", "--scope", "@acme"], { encoding: "utf8" });

    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain("Not merged");
  });

  it("writes the changelog once, the commands, the skills for Codex and the workflow", () => {
    const project = createProjectWithKit();
    const result = addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    expect([...result.created].sort()).toEqual(["CHANGELOG.md", "docs/IDEAS.md", "docs/STATUS.md"]);
    expect(result.files.written).toEqual(expect.arrayContaining([".github/workflows/weekly-tag.yml", ".claude/commands/workflow/changelog.md", ".agents/skills/workflow-changelog/SKILL.md", HOOK_SCRIPT]));

    writeFile(project, "CHANGELOG.md", "# Changelog\n\n## 2026-W40 — the project's own entry\n");
    addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

    expect(readFileSync(join(project, "CHANGELOG.md"), "utf8")).toContain("the project's own entry");
  });
});

/** Whether an ask rule matches the command. */
function asks(command: string): boolean {
  return ASK_RULES.some((rule) => {
    return matches(rule, command);
  });
}

/** Whether one rule matches the command: as a prefix when it ends in `:*`, and with `*` as any text when it does not. */
function matches(rule: string, command: string): boolean {
  const pattern = /^Bash\((.*)\)$/.exec(rule)?.[1] ?? "";
  const prefix = /^(.+):\*$/.exec(pattern)?.[1];

  if (prefix !== undefined) {
    return command === prefix || command.startsWith(`${prefix} `);
  }

  return new RegExp(`^${pattern.split("*").map(escapeForRegExp).join(".*")}$`, "s").test(command);
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readCommand(name: string): { text: string; frontmatter: string; body: string } {
  const text = readFileSync(join(ADDON, "files/.claude/commands/workflow", `${name}.md`), "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";

  return { text, frontmatter, body: text.slice(frontmatter.length + 8) };
}

function scriptsOf(manifest: string): string[] {
  const { packageJson } = JSON.parse(readFileSync(manifest, "utf8")) as Manifest;

  return Object.values(packageJson).flatMap((patch) => Object.keys(patch.scripts ?? {}));
}

/**
 * A project as the version before this one left it, with everything it had
 * turned on: Claude Code's settings start the hook with the old argument and
 * a timeout of 30 and hold the rule about edits of the setting, and both
 * setting files are there.
 */
function createProjectAsBefore(): string {
  const project = createProjectWithKit();

  addToProject({ project, unit: "agent-workflow", repository: REPOSITORY, scope: "@acme" });

  const settings = readJson<HostSettings>(project, CLAUDE_SETTINGS);
  const hook = settings.hooks?.PreToolUse?.[0]?.hooks[0];

  if (hook === undefined || settings.permissions?.ask === undefined) {
    throw new Error("the add-on did not register its hook");
  }

  hook.command = OLD_CLAUDE_HOOK;
  hook.timeout = 30;
  // That version registered the hook for `Bash` alone.
  settings.hooks = { ...settings.hooks, PreToolUse: (settings.hooks?.PreToolUse ?? []).slice(0, 1) };
  settings.permissions.ask.push(OLD_SETTING_RULE);
  writeFile(project, CLAUDE_SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
  writeFile(project, RETIRED_FILES[0] as string, `${JSON.stringify(OLD_SETTING_ON)}\n`);
  writeFile(project, RETIRED_FILES[1] as string, "export const on: boolean = true;\n");

  return project;
}

/** A small project with the real kit in it, as `create-project.mts` leaves one. */
function createProjectWithKit(): string {
  const project = createFolder({
    "package.json": `${JSON.stringify({ name: "project", scripts: { "gate:fast": "pnpm gates", "gate:full": "pnpm gate:fast" } }, null, 2)}\n`,
    "packages/web/package.json": '{ "name": "@acme/web" }\n',
    "AGENTS.md": "# Working here\n",
  });

  addToProject({ project, unit: "kit", repository: REPOSITORY });
  git(project, "init", "--quiet");

  return project;
}
