// Asks GitHub which of the repository's settings are on, and says so in
// three words:
//
//   PASS  the setting is on
//   FAIL  the setting is off. The lines under it say where it is in GitHub's
//         pages and give the command that switches it on
//   SKIP  GitHub was not asked, or did not say. Not a pass, and not "off"
//
// It only reads. Every call to GitHub is `gh api --method GET`, made in one
// function (`askGitHub`). A command that changes a setting is printed for a
// person and never run.
//
// "Off" and "no answer" are kept apart. GitHub answers 404 for a setting that
// is off and also for one the login may not see, so a 404 counts as off only
// where it can mean nothing else: see `meansOff`.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { type RequiredChecks, requiredChecks } from "./required-checks.mts";

export interface Ran {
  /** The exit code; 127 when the program could not be started. */
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs a program in a folder and waits for it. Replaced in tests. */
export type Run = (program: string, args: string[], cwd: string) => Ran;

export interface SettingsOptions {
  /** The project root: where the workflows are, and the checkout whose `origin` names the repository. */
  root: string;
  run: Run;
  report: (line: string) => void;
}

/** 0: every setting was read and is on. 1: one is off. 2: none is off, and one or all could not be read. */
export type ExitCode = 0 | 1 | 2;

type Answer = { ok: true; body: unknown } | { ok: false; exit: number; http: number | undefined; message: string };

type Verdict = { state: "on"; note?: string } | { state: "off"; detail: string; where?: string; fix?: string } | { state: "unread"; reason: string };

interface Result {
  setting: string;
  verdict: Verdict;
}

const ON: Verdict = { state: "on" };
const WORD = { on: "PASS", off: "FAIL", unread: "SKIP" };
const PAGE = 100;
const NO_GH = "`gh` is not installed. It is GitHub's command-line tool: https://cli.github.com";
const WORKFLOWS_NAME_NONE = "no job in .github/workflows runs on every pull request, so there is no status check to ask for";

/** The languages GitHub accepts when CodeQL default setup is changed. It reports two more (`javascript`, `typescript`) and refuses them. */
const CODEQL_LANGUAGES = ["actions", "c-cpp", "csharp", "go", "java-kotlin", "javascript-typescript", "python", "ruby", "swift"];

/**
 * What a terminal acts on or does not show, by Unicode's own classes and not
 * by a list of ranges, which a new character would not be in: a control
 * character (Cc); a format mark, such as one that turns the text round, has
 * no width, or is a tag (Cf); half a pair, a private character and one that
 * is not assigned (Cs, Co, Cn); a line or paragraph end (Zl, Zp); and a
 * space that is not the space.
 */
const NOT_SHOWN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]|(?! )\p{Zs}/gu;

/**
 * A line as it may be printed. Much of what a line shows comes from outside:
 * a job's name and a file's name from the checkout, a ruleset's name and a
 * refusal from GitHub. A control character there can clear the line above
 * and write a PASS that no check gave, and a mark that turns the text round
 * can show a command other than the one that is pasted. Each is written out
 * as its escape. Inside the JSON of the command that is the same character,
 * so the ruleset asks for the same check.
 */
export function shown(line: string): string {
  // One escape for each of its two halves, when the character has two: that is how JSON writes it.
  return line.replace(NOT_SHOWN, (character) => Array.from({ length: character.length }, (_, half) => `\\u${character.charCodeAt(half).toString(16).padStart(4, "0")}`).join(""));
}

export function checkSettings({ root, run, report: print }: SettingsOptions): ExitCode {
  // Every line goes out through this, whatever it was put together from.
  const report = (line: string): void => print(shown(line));
  const found = findRepository(run, root);

  if (found.name === undefined) {
    report(nothingRead(found.problem));

    return 2;
  }

  const { name } = found;
  const api = `repos/${name}`;
  const web = `https://github.com/${name}/settings`;
  const ask = (path: string): Answer => askGitHub(run, root, path);
  const repository = ask(api);

  if (!repository.ok) {
    report(nothingRead(`${whyNoAnswer(repository)}${repository.http === 404 ? `. There is no repository ${name}, or this login may not see it` : ""}`));

    return 2;
  }

  const isAdmin = field(field(repository.body, "permissions"), "admin") === true;
  /**
   * True when a refusal can only mean "off". Two endpoints answer 404 for a
   * setting that is off, and every endpoint answers 404 to a login that may
   * not see the setting. An administrator sees them all, so their 404 is
   * "off"; so is one whose message says "disabled". Any other is no answer.
   */
  const meansOff = (answer: Answer): boolean => !answer.ok && answer.http === 404 && (isAdmin || /\bdisabled\b/i.test(answer.message));
  const off = (detail: string, where: string, fix: string): Verdict => ({ state: "off", detail, where, fix });
  const security = (setting: string): string => `Settings → Advanced Security → ${setting} (${web}/security_analysis)`;

  const alerts = ask(`${api}/vulnerability-alerts`);
  const updates = ask(`${api}/automated-security-fixes`);
  const reporting = ask(`${api}/private-vulnerability-reporting`);
  const codeql = ask(`${api}/code-scanning/default-setup`);
  const permissions = ask(`${api}/actions/permissions/workflow`);
  const deletes = field(repository.body, "delete_branch_on_merge");
  const updatesOn = updates.ok ? field(updates.body, "enabled") : undefined;
  const reportingOn = reporting.ok ? field(reporting.body, "enabled") : undefined;
  const tokenDefault = permissions.ok ? field(permissions.body, "default_workflow_permissions") : undefined;

  const results: Result[] = [
    {
      setting: "Dependabot alerts, and with them the dependency graph",
      verdict: alerts.ok ? ON : meansOff(alerts) ? off("off", security("Dependabot alerts"), `gh api -X PUT ${api}/vulnerability-alerts`) : notRead(alerts),
    },
    usesRenovate(root)
      ? {
          // Renovate opens the fixes, from the alerts above. With Dependabot's
          // on too, each fix would come from both bots.
          setting: "Dependabot security updates are off, as Renovate opens the fixes",
          verdict:
            updatesOn === false || meansOff(updates)
              ? ON
              : updatesOn === true
                ? off("on, so a fix would come from both bots", security("Dependabot security updates"), `gh api -X DELETE ${api}/automated-security-fixes`)
                : notRead(updates),
        }
      : {
          setting: "Dependabot security updates",
          verdict:
            updatesOn === true
              ? ON
              : updatesOn === false || meansOff(updates)
                ? off("off", security("Dependabot security updates"), `gh api -X PUT ${api}/automated-security-fixes`)
                : notRead(updates),
        },
    {
      setting: "Private vulnerability reporting",
      verdict:
        reportingOn === true
          ? ON
          : reportingOn === false
            ? off("off", security("Private vulnerability reporting"), `gh api -X PUT ${api}/private-vulnerability-reporting`)
            : notRead(reporting),
    },
    { setting: "CodeQL default setup, with the actions language", verdict: judgeCodeql(codeql, api, security("Code scanning → CodeQL analysis")) },
    {
      setting: "Workflow permissions default to read",
      verdict:
        tokenDefault === "read"
          ? ON
          : typeof tokenDefault === "string"
            ? off(
                `a workflow with no \`permissions:\` block gets a ${tokenDefault} token`,
                `Settings → Actions → General → Workflow permissions (${web}/actions)`,
                `gh api -X PUT ${api}/actions/permissions/workflow -f default_workflow_permissions=read`,
              )
            : notRead(permissions),
    },
    {
      setting: "Merged branches are deleted",
      verdict:
        deletes === true
          ? ON
          : deletes === false
            ? off("off", `Settings → General → Pull Requests → Automatically delete head branches (${web})`, `gh api -X PATCH ${api} -F delete_branch_on_merge=true`)
            : { state: "unread", reason: "GitHub left `delete_branch_on_merge` out of its answer, as it does for a login that can only read the repository" },
    },
  ];

  for (const result of results) {
    printResult(result, report);
  }

  const ruleset = judgeRuleset({ ask, api, branch: field(repository.body, "default_branch"), checks: requiredChecks(root) });

  for (const result of ruleset.results) {
    printResult(result, report);
  }

  results.push(...ruleset.results);

  if (ruleset.results.some(({ verdict }) => verdict.state === "off")) {
    const fix = rulesetFix({ ask, api, web, branch: ruleset.branch, checks: ruleset.checks });

    for (const line of fix.lines) {
      report(line);
    }

    // The body is many lines, and its line ends are its own: each line goes through `shown`, and they stay lines.
    print(fix.body.split("\n").map(shown).join("\n"));
    report("JSON");
  }

  const count = (state: Verdict["state"]): number => results.filter(({ verdict }) => verdict.state === state).length;

  report(`${name}: ${count("on")} on, ${count("off")} off, ${count("unread")} not read. Nothing was changed: this only reads.`);

  if (count("off") > 0) {
    report("A person runs a `fix:` command. An agent shows it to the user and does not run it.");
  }

  return count("off") > 0 ? 1 : count("unread") > 0 ? 2 : 0;
}

/** The files Renovate reads its config from, as Renovate looks for them. */
const RENOVATE_CONFIGS = ["renovate.json", "renovate.json5", ".github/renovate.json", ".github/renovate.json5", ".gitlab/renovate.json", ".gitlab/renovate.json5", ".renovaterc", ".renovaterc.json", ".renovaterc.json5"];

/** True when the project's update bot is Renovate: one of its config files is there. */
function usesRenovate(root: string): boolean {
  return RENOVATE_CONFIGS.some((path) => existsSync(join(root, path)));
}

function judgeCodeql(answer: Answer, api: string, where: string): Verdict {
  const state = answer.ok ? field(answer.body, "state") : undefined;
  const listed = answer.ok ? field(answer.body, "languages") : undefined;
  const languages = Array.isArray(listed) ? listed.filter((language) => typeof language === "string") : [];
  const command = `gh api -X PATCH ${api}/code-scanning/default-setup -f state=configured`;

  if (state === "not-configured") {
    return { state: "off", detail: "not set up", where, fix: command };
  }

  if (state !== "configured") {
    return notRead(answer);
  }

  // For about a minute after it is switched on, GitHub has not looked for the
  // languages yet: the state is `configured` and the list is empty. A command
  // written from that list would set it to `actions` alone.
  if (languages.length === 0) {
    return { state: "unread", reason: "GitHub is still setting it up and has found no language yet. Run this again in a minute" };
  }

  if (languages.includes("actions")) {
    return ON;
  }

  // GitHub replaces the whole list, so the languages it has are sent again.
  const wanted = ["actions", ...languages.filter((language) => language !== "actions" && CODEQL_LANGUAGES.includes(language))];

  return {
    state: "off",
    detail: `set up without the \`actions\` language (it has: ${languages.join(", ") || "none"}), so the workflows are not analysed`,
    where,
    fix: `${command}${wanted.map((language) => ` -f 'languages[]=${language}'`).join("")}`,
  };
}

interface RulesetVerdict {
  results: Result[];
  checks: RequiredChecks;
  /** The default branch, as it is written in a path of the API. */
  branch: string;
}

/**
 * The three things asked of the default branch, each its own line.
 *
 * Read from `rules/branches/<branch>`, not from the list of rulesets. That
 * endpoint returns the rules that hold on the branch: only those of an
 * active ruleset, from every ruleset that matches it, the organisation's
 * included, each with its parameters. The list of rulesets carries no rule,
 * so it costs one more read per ruleset, and each ruleset's branch patterns
 * (`~DEFAULT_BRANCH`, `refs/heads/ma*`, its excludes) would have to be
 * matched here the way GitHub matches them. One read, and GitHub does the
 * matching. What it cannot say is why a rule is missing; `rulesetFix` reads
 * the list for that, to name a ruleset that is there and not active.
 */
function judgeRuleset({ ask, api, branch, checks }: { ask: (path: string) => Answer; api: string; branch: unknown; checks: RequiredChecks }): RulesetVerdict {
  const name = typeof branch === "string" && branch !== "" ? branch : undefined;
  const label = (part: string): string => `Ruleset on ${name ?? "the default branch"}: ${part}`;
  const settings = [label("a pull request is required"), label("deletion and force pushes are blocked"), label("the status checks of every pull request are required")];
  const path = (name ?? "").split("/").map(encodeURIComponent).join("/");
  const all = (verdict: Verdict): RulesetVerdict => ({ results: settings.map((setting) => ({ setting, verdict })), checks, branch: path });

  if (name === undefined) {
    return all({ state: "unread", reason: "GitHub's answer does not name the default branch" });
  }

  const rules = askAll(ask, `${api}/rules/branches/${path}`);

  if (!rules.ok) {
    return all(notRead(rules));
  }

  const ofType = (type: string): unknown[] => rules.body.filter((rule) => field(rule, "type") === type);
  const open = [
    ...(ofType("deletion").length === 0 ? ["no active ruleset blocks deletion (`deletion`)"] : []),
    ...(ofType("non_fast_forward").length === 0 ? ["no active ruleset blocks a force push (`non_fast_forward`)"] : []),
  ];
  const asked = ofType("required_status_checks").flatMap((rule) => {
    const list = field(field(rule, "parameters"), "required_status_checks");

    return Array.isArray(list) ? list.map((check) => field(check, "context")) : [];
  });
  const missing = checks.contexts.filter((context) => !asked.includes(context));
  const quoted = (names: string[]): string => names.map((context) => `"${context}"`).join(", ");
  const notes = [
    ...(checks.leftOut.length > 0 ? [`not asked for, because a pull request can skip it or its check has no one name: ${quoted(checks.leftOut.map(({ job }) => job))}`] : []),
    ...checks.unread.map(({ file, reason }) => `not judged: ${file}, because ${reason}`),
  ];
  const note = notes.length === 0 ? "" : ` (${notes.join("; ")})`;

  return {
    checks,
    branch: path,
    results: [
      { setting: settings[0] as string, verdict: ofType("pull_request").length > 0 ? ON : { state: "off", detail: "no active ruleset requires one (`pull_request`)" } },
      { setting: settings[1] as string, verdict: open.length === 0 ? ON : { state: "off", detail: open.join("; ") } },
      {
        setting: settings[2] as string,
        verdict:
          checks.contexts.length === 0
            ? { state: "unread", reason: `${WORKFLOWS_NAME_NONE}${note}` }
            : missing.length === 0
              ? { state: "on", note: `${quoted(checks.contexts)}${note}` }
              : { state: "off", detail: `no active ruleset requires ${quoted(missing)}${note}` },
      },
    ],
  };
}

/** A ruleset that has all three: a pull request, no deletion and no force push, and the status checks named. */
export function rulesetBody(contexts: string[]): Record<string, unknown> {
  return {
    name: "default branch: pull request, checks, no deletion, no force push",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        // GitHub asks for all five. Each is the weakest value: the rule is that a pull request is needed, not who reviews it.
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      ...(contexts.length === 0
        ? []
        : [
            {
              type: "required_status_checks",
              parameters: { strict_required_status_checks_policy: false, required_status_checks: contexts.map((context) => ({ context })) },
            },
          ]),
    ],
  };
}

interface RulesetFix {
  /** Where a ruleset is made, what stands in the way, and the first line of the command. */
  lines: string[];
  /** What the command reads: the ruleset as JSON, on as many lines as it takes. */
  body: string;
}

/** What a person does about a ruleset that lacks something: where it is, and a command that makes one. */
function rulesetFix({ ask, api, web, branch, checks }: { ask: (path: string) => Answer; api: string; web: string; branch: string; checks: RequiredChecks }): RulesetFix {
  const listed = askAll(ask, `${api}/rulesets`);
  const inactive = (listed.ok ? listed.body : []).filter((ruleset) => field(ruleset, "target") === "branch" && field(ruleset, "enforcement") !== "active");
  // GitHub marks a branch `protected` for a ruleset too. `protection.enabled` is the older kind alone.
  const classic = ask(`${api}/branches/${branch}`);
  const hasClassic = classic.ok && field(field(classic.body, "protection"), "enabled") === true;

  const lines = [
    `  where: Settings → Rules → Rulesets (${web}/rules). A ruleset is made there, and changed there`,
    ...inactive.map(
      (ruleset) =>
        `  there: the ruleset "${String(field(ruleset, "name"))}" has the enforcement status "${String(field(ruleset, "enforcement"))}", so none of its rules count. Set it to Active there`,
    ),
    ...(hasClassic
      ? [`  there: the branch has a classic branch protection rule (Settings → Branches, ${web}/branches). This reads rulesets only, so that rule may already hold what a line above asks for`]
      : []),
    ...checks.leftOut.map(({ file, job, reason }) => `  left out of the status checks: "${job}" (${file}): ${reason}`),
    ...(checks.contexts.length === 0 ? [`  no status check is in the command below: ${WORKFLOWS_NAME_NONE}`] : []),
    "  fix:   this makes one ruleset that has all three. Rulesets add up, so it can stand beside one that is there:",
    `gh api -X POST ${api}/rulesets --input - <<'JSON'`,
  ];

  return {
    lines,
    body: JSON.stringify(rulesetBody(checks.contexts), null, 2),
  };
}

function printResult({ setting, verdict }: Result, report: (line: string) => void): void {
  if (verdict.state === "on") {
    report(`${WORD.on} ${setting}${verdict.note === undefined ? "" : `: ${verdict.note}`}`);
  } else if (verdict.state === "unread") {
    report(`${WORD.unread} ${setting}: not read, so this is not a pass and not "off". ${verdict.reason}`);
  } else {
    report(`${WORD.off} ${setting}: ${verdict.detail}`);

    if (verdict.where !== undefined && verdict.fix !== undefined) {
      report(`  where: ${verdict.where}`);
      report(`  fix:   ${verdict.fix}`);
    }
  }
}

function nothingRead(reason: string): string {
  return `${WORD.unread} repository settings: GitHub could not be asked, so nothing was read. This is not a pass. ${reason}`;
}

/** `owner/name` from the address of a remote on github.com. Undefined for any other address. */
export function parseRemote(url: string): string | undefined {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());

  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

/**
 * The repository this checkout belongs to: `origin` when it is on
 * github.com, which needs no network, and what `gh repo view` names when it
 * is not (another host name for the same server, a repository set with
 * `gh repo set-default`).
 */
function findRepository(run: Run, root: string): { name: string } | { name: undefined; problem: string } {
  const origin = run("git", ["remote", "get-url", "origin"], root);
  const fromOrigin = origin.status === 0 ? parseRemote(origin.stdout) : undefined;

  if (fromOrigin !== undefined) {
    return { name: fromOrigin };
  }

  const viewed = run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], root);
  const named = viewed.stdout.trim();

  if (viewed.status === 0 && /^[\w.-]+\/[\w.-]+$/.test(named)) {
    return { name: named };
  }

  // The address is not printed: one written with a token in it would show the token.
  const remote = origin.status === 0 ? "its `origin` is not an address on github.com" : "it has no `origin` remote";

  return {
    name: undefined,
    problem: viewed.status === 127 ? `${NO_GH} (and ${remote})` : `This folder has no GitHub repository: ${remote}, and \`gh repo view\` named none (${firstLine(viewed.stderr) || `exit ${viewed.status}`})`,
  };
}

/** One read of GitHub's API. The only place this tool asks GitHub for a setting, and the method is always GET. */
function askGitHub(run: Run, root: string, path: string): Answer {
  const ran = run("gh", ["api", "--method", "GET", path], root);

  if (ran.status === 0) {
    return { ok: true, body: parse(ran.stdout) };
  }

  // On a refusal gh prints GitHub's answer, which holds the status and the reason, and "gh: <reason> (HTTP <status>)" beside it.
  const body = parse(ran.stdout);
  const http = Number(field(body, "status") ?? /\(HTTP (\d{3})\)/.exec(ran.stderr)?.[1]);
  const message = field(body, "message");

  return { ok: false, exit: ran.status, http: Number.isInteger(http) ? http : undefined, message: typeof message === "string" ? message : firstLine(ran.stderr) };
}

/** Every page of a list. One page that fails is the answer: half a list is not a list. */
function askAll(ask: (path: string) => Answer, path: string): { ok: true; body: unknown[] } | Extract<Answer, { ok: false }> {
  const all: unknown[] = [];

  for (let page = 1; ; page += 1) {
    const answer = ask(`${path}?per_page=${PAGE}&page=${page}`);

    if (!answer.ok) {
      return answer;
    }

    if (!Array.isArray(answer.body)) {
      return { ok: false, exit: 1, http: 200, message: "the answer is not a list" };
    }

    all.push(...answer.body);

    if (answer.body.length < PAGE) {
      return { ok: true, body: all };
    }
  }
}

function notRead(answer: Answer): Verdict {
  return { state: "unread", reason: answer.ok ? `GitHub's answer is not one this tool knows: ${JSON.stringify(answer.body)?.slice(0, 120) ?? "nothing"}` : whyNoAnswer(answer) };
}

function whyNoAnswer({ exit, http, message }: Extract<Answer, { ok: false }>): string {
  if (exit === 127) {
    return NO_GH;
  }

  if (http === 401) {
    return `GitHub refused the login \`gh\` used (HTTP 401: ${message}). Run \`gh auth login\`, or look at GH_TOKEN`;
  }

  if (http === undefined && (exit === 4 || /gh auth login/.test(message))) {
    return "`gh` is not logged in. Run `gh auth login`";
  }

  return http === undefined ? `\`gh\` got no answer from GitHub (${message || `exit ${exit}`})` : `GitHub answered HTTP ${http}: ${message}`;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // No body (a 204), or one that is not JSON.
    return undefined;
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}
