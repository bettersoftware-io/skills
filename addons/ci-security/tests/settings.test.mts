import { spawnSync } from "node:child_process";
import { chmodSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseArguments } from "../files/tools/ci-security/check-settings.mts";
import { checkSettings, parseRemote, rulesetBody, shown } from "../files/tools/ci-security/lib/settings.mts";
import { API, CHECK, createGitHub, NOT_FOUND, PULL_REQUEST_RULE, type Reply, REPOSITORY, repository, requiredChecksRule, rule, type World } from "./github.mts";
import { ADDON, createFolder } from "./support.mts";

/** A project with one workflow, whose one job every pull request runs. */
const WORKFLOW = ["name: CI", "", "on:", "  pull_request:", "  push:", "    branches: [main]", "", "jobs:", "  checks:", `    name: ${CHECK}`, "    runs-on: ubuntu-latest", ""].join("\n");
const PROJECT = { ".github/workflows/ci.yml": WORKFLOW };

const PASS = {
  alerts: ["PASS Dependabot alerts, and with them the dependency graph"],
  updates: ["PASS Dependabot security updates"],
  reporting: ["PASS Private vulnerability reporting"],
  codeql: ["PASS CodeQL default setup, with the actions language"],
  permissions: ["PASS Workflow permissions default to read"],
  deletes: ["PASS Merged branches are deleted"],
  pullRequest: ["PASS Ruleset on main: a pull request is required"],
  history: ["PASS Ruleset on main: deletion and force pushes are blocked"],
  checks: [`PASS Ruleset on main: the status checks of every pull request are required: "${CHECK}"`],
};
const NOTHING_CHANGED = "Nothing was changed: this only reads.";
const A_PERSON_RUNS_IT = "A person runs a `fix:` command. An agent shows it to the user and does not run it.";
const NOT_READ = 'not read, so this is not a pass and not "off".';
const SECURITY_PAGE = "https://github.com/acme/app/settings/security_analysis";
const RULESET_WHERE = "  where: Settings → Rules → Rulesets (https://github.com/acme/app/settings/rules). A ruleset is made there, and changed there";
const RULESET_FIX = "  fix:   this makes one ruleset that has all three. Rulesets add up, so it can stand beside one that is there:";
const RULESET_COMMAND = "gh api -X POST repos/acme/app/rulesets --input - <<'JSON'";
const NO_GH = "`gh` is not installed. It is GitHub's command-line tool: https://cli.github.com";
const NOTHING_READ = "SKIP repository settings: GitHub could not be asked, so nothing was read. This is not a pass.";

describe("a repository with every setting on", () => {
  it("prints one PASS line for each setting, then the count, and exits 0", () => {
    const { status, lines } = check();

    expect(lines).toEqual(expected({}, "9 on, 0 off, 0 not read"));
    expect(status).toBe(0);
  });

  it("asks with reads only: where origin points, then one `gh api --method GET` for each thing it needs", () => {
    const read = (path: string): string[] => ["gh", "api", "--method", "GET", path];

    expect(check().calls).toEqual([
      ["git", "remote", "get-url", "origin"],
      read("repos/acme/app"),
      read("repos/acme/app/vulnerability-alerts"),
      read("repos/acme/app/automated-security-fixes"),
      read("repos/acme/app/private-vulnerability-reporting"),
      read("repos/acme/app/code-scanning/default-setup"),
      read("repos/acme/app/actions/permissions/workflow"),
      read("repos/acme/app/rules/branches/main?per_page=100&page=1"),
    ]);
  });
});

describe("a setting that is off", () => {
  it("fails Dependabot alerts on an administrator's 404, with where it is and the command that switches it on", () => {
    const { status, lines } = check({ answers: { [`${API}/vulnerability-alerts`]: NOT_FOUND } });

    expect(lines).toEqual(
      expected(
        {
          alerts: [
            "FAIL Dependabot alerts, and with them the dependency graph: off",
            `  where: Settings → Advanced Security → Dependabot alerts (${SECURITY_PAGE})`,
            "  fix:   gh api -X PUT repos/acme/app/vulnerability-alerts",
          ],
        },
        "8 on, 1 off, 0 not read",
      ),
    );
    expect(status).toBe(1);
  });

  it("fails Dependabot security updates that GitHub says are not enabled", () => {
    const { status, lines } = check({ answers: { [`${API}/automated-security-fixes`]: { body: { enabled: false, paused: false } } } });

    expect(lines).toEqual(
      expected(
        {
          updates: [
            "FAIL Dependabot security updates: off",
            `  where: Settings → Advanced Security → Dependabot security updates (${SECURITY_PAGE})`,
            "  fix:   gh api -X PUT repos/acme/app/automated-security-fixes",
          ],
        },
        "8 on, 1 off, 0 not read",
      ),
    );
    expect(status).toBe(1);
  });

  it("fails Dependabot security updates on an administrator's 404 too: GitHub answers that when Dependabot is off", () => {
    const { status, lines } = check({ answers: { [`${API}/automated-security-fixes`]: NOT_FOUND } });

    expect(lines[1]).toBe("FAIL Dependabot security updates: off");
    expect(status).toBe(1);
  });

  it("fails private vulnerability reporting that is not enabled", () => {
    const { status, lines } = check({ answers: { [`${API}/private-vulnerability-reporting`]: { body: { enabled: false } } } });

    expect(lines).toEqual(
      expected(
        {
          reporting: [
            "FAIL Private vulnerability reporting: off",
            `  where: Settings → Advanced Security → Private vulnerability reporting (${SECURITY_PAGE})`,
            "  fix:   gh api -X PUT repos/acme/app/private-vulnerability-reporting",
          ],
        },
        "8 on, 1 off, 0 not read",
      ),
    );
    expect(status).toBe(1);
  });

  it("fails CodeQL default setup that is not set up", () => {
    const { status, lines } = check({ answers: { [`${API}/code-scanning/default-setup`]: { body: { state: "not-configured", languages: ["actions", "javascript-typescript"] } } } });

    expect(lines).toEqual(
      expected(
        {
          codeql: [
            "FAIL CodeQL default setup, with the actions language: not set up",
            `  where: Settings → Advanced Security → Code scanning → CodeQL analysis (${SECURITY_PAGE})`,
            "  fix:   gh api -X PATCH repos/acme/app/code-scanning/default-setup -f state=configured",
          ],
        },
        "8 on, 1 off, 0 not read",
      ),
    );
    expect(status).toBe(1);
  });

  it("fails CodeQL set up without the actions language, and the command keeps the languages it has that GitHub accepts", () => {
    const { status, lines } = check({
      answers: { [`${API}/code-scanning/default-setup`]: { body: { state: "configured", languages: ["javascript", "javascript-typescript", "typescript", "python"] } } },
    });

    expect(lines.slice(3, 6)).toEqual([
      "FAIL CodeQL default setup, with the actions language: set up without the `actions` language (it has: javascript, javascript-typescript, typescript, python), so the workflows are not analysed",
      `  where: Settings → Advanced Security → Code scanning → CodeQL analysis (${SECURITY_PAGE})`,
      "  fix:   gh api -X PATCH repos/acme/app/code-scanning/default-setup -f state=configured -f 'languages[]=actions' -f 'languages[]=javascript-typescript' -f 'languages[]=python'",
    ]);
    expect(status).toBe(1);
  });

  it("fails workflow permissions that default to a write token", () => {
    const { status, lines } = check({ answers: { [`${API}/actions/permissions/workflow`]: { body: { default_workflow_permissions: "write", can_approve_pull_request_reviews: false } } } });

    expect(lines).toEqual(
      expected(
        {
          permissions: [
            "FAIL Workflow permissions default to read: a workflow with no `permissions:` block gets a write token",
            "  where: Settings → Actions → General → Workflow permissions (https://github.com/acme/app/settings/actions)",
            "  fix:   gh api -X PUT repos/acme/app/actions/permissions/workflow -f default_workflow_permissions=read",
          ],
        },
        "8 on, 1 off, 0 not read",
      ),
    );
    expect(status).toBe(1);
  });

  it("fails a repository that keeps a branch after its pull request is merged", () => {
    const { status, lines } = check({ answers: { [API]: repository({ delete_branch_on_merge: false }) } });

    expect(lines).toEqual(
      expected(
        {
          deletes: [
            "FAIL Merged branches are deleted: off",
            "  where: Settings → General → Pull Requests → Automatically delete head branches (https://github.com/acme/app/settings)",
            "  fix:   gh api -X PATCH repos/acme/app -F delete_branch_on_merge=true",
          ],
        },
        "8 on, 1 off, 0 not read",
      ),
    );
    expect(status).toBe(1);
  });

  it("prints the commands and runs none of them: with every setting off, each call is still a read", () => {
    const { status, lines, calls } = check({ answers: EVERYTHING_OFF });
    const toGitHub = calls.filter(([program]) => program === "gh");

    expect(status).toBe(1);
    expect(lines.filter((line) => line.startsWith("FAIL "))).toHaveLength(9);
    expect(lines.filter((line) => /^ {2}fix: {3}gh api -X (PUT|PATCH) /.test(line))).toHaveLength(6);
    expect(lines).toContain(RULESET_COMMAND);
    expect(toGitHub.length).toBeGreaterThan(7);
    expect(toGitHub.filter((call) => call.slice(1, 4).join(" ") !== "api --method GET" || call.length !== 5)).toEqual([]);
    expect(lines.slice(-2)).toEqual([`${REPOSITORY}: 0 on, 9 off, 0 not read. ${NOTHING_CHANGED}`, A_PERSON_RUNS_IT]);
  });
});

describe("a project whose update bot is Renovate", () => {
  const WITH_RENOVATE = { ...PROJECT, ".github/renovate.json5": "{}\n" };
  const RENOVATE_PASS = "PASS Dependabot security updates are off, as Renovate opens the fixes";

  it("passes Dependabot security updates that are off, and still asks for the alerts Renovate reads", () => {
    const { status, lines } = check({ answers: { [`${API}/automated-security-fixes`]: { body: { enabled: false, paused: false } } } }, WITH_RENOVATE);

    expect(lines).toEqual(expected({ updates: [RENOVATE_PASS] }, "9 on, 0 off, 0 not read"));
    expect(status).toBe(0);
  });

  it("passes them on an administrator's 404 too, which is how GitHub says they are off", () => {
    const { lines } = check({ answers: { [`${API}/automated-security-fixes`]: NOT_FOUND } }, WITH_RENOVATE);

    expect(lines[1]).toBe(RENOVATE_PASS);
  });

  it("fails Dependabot security updates that are on, since a fix would come from both bots, with the command that switches them off", () => {
    const { status, lines } = check({}, WITH_RENOVATE);

    expect(lines).toEqual(
      expected(
        {
          updates: [
            "FAIL Dependabot security updates are off, as Renovate opens the fixes: on, so a fix would come from both bots",
            `  where: Settings → Advanced Security → Dependabot security updates (${SECURITY_PAGE})`,
            "  fix:   gh api -X DELETE repos/acme/app/automated-security-fixes",
          ],
        },
        "8 on, 1 off, 0 not read",
      ),
    );
    expect(status).toBe(1);
  });

  it("knows Renovate by any file it reads its config from, at the root too", () => {
    const { lines } = check({}, { ...PROJECT, "renovate.json": "{}\n" });

    expect(lines[1]).toMatch(/^FAIL Dependabot security updates are off, as Renovate opens the fixes/);
  });
});

describe("a setting GitHub did not answer for is told apart from one that is off", () => {
  const readOnly = repository({ delete_branch_on_merge: true, permissions: { admin: false, push: false, pull: true } });

  it("does not call Dependabot alerts off on the 404 GitHub gives a login that may not see the setting", () => {
    const { status, lines } = check({ answers: { [API]: readOnly, [`${API}/vulnerability-alerts`]: NOT_FOUND } });

    expect(lines).toEqual(expected({ alerts: [`SKIP Dependabot alerts, and with them the dependency graph: ${NOT_READ} GitHub answered HTTP 404: Not Found`] }, "8 on, 0 off, 1 not read"));
    expect(status).toBe(2);
  });

  it("calls Dependabot alerts off for any login when GitHub's 404 says they are disabled", () => {
    const { status, lines } = check({ answers: { [API]: readOnly, [`${API}/vulnerability-alerts`]: { http: 404, message: "Vulnerability alerts are disabled." } } });

    expect(lines[0]).toBe("FAIL Dependabot alerts, and with them the dependency graph: off");
    expect(status).toBe(1);
  });

  it("does not call Dependabot security updates off on a 404 either, for a login that is no administrator", () => {
    const { status, lines } = check({ answers: { [API]: readOnly, [`${API}/automated-security-fixes`]: NOT_FOUND } });

    expect(lines[1]).toBe(`SKIP Dependabot security updates: ${NOT_READ} GitHub answered HTTP 404: Not Found`);
    expect(status).toBe(2);
  });

  it("gives GitHub's own reason for a 403 on code scanning and on the workflow permissions", () => {
    const { status, lines } = check({
      answers: {
        [`${API}/code-scanning/default-setup`]: { http: 403, message: "You are not authorized to read code scanning default setup." },
        [`${API}/actions/permissions/workflow`]: { http: 403, message: "Resource not accessible by personal access token" },
      },
    });

    expect(lines).toEqual(
      expected(
        {
          codeql: [`SKIP CodeQL default setup, with the actions language: ${NOT_READ} GitHub answered HTTP 403: You are not authorized to read code scanning default setup.`],
          permissions: [`SKIP Workflow permissions default to read: ${NOT_READ} GitHub answered HTTP 403: Resource not accessible by personal access token`],
        },
        "7 on, 0 off, 2 not read",
      ),
    );
    expect(status).toBe(2);
  });

  it("does not call private vulnerability reporting off when GitHub refuses the question", () => {
    const { status, lines } = check({ answers: { [`${API}/private-vulnerability-reporting`]: { http: 422, message: "Private vulnerability reporting is not available for this repository." } } });

    expect(lines[2]).toBe(`SKIP Private vulnerability reporting: ${NOT_READ} GitHub answered HTTP 422: Private vulnerability reporting is not available for this repository.`);
    expect(status).toBe(2);
  });

  it("does not call branch deletion off when GitHub leaves it out of its answer", () => {
    const { status, lines } = check({ answers: { [API]: repository({ delete_branch_on_merge: null }) } });

    expect(lines[5]).toBe(
      `SKIP Merged branches are deleted: ${NOT_READ} GitHub left \`delete_branch_on_merge\` out of its answer, as it does for a login that can only read the repository`,
    );
    expect(status).toBe(2);
  });

  it("does not guess at an answer it does not know: neither on nor off", () => {
    const { status, lines } = check({
      answers: {
        [`${API}/automated-security-fixes`]: { body: {} },
        [`${API}/private-vulnerability-reporting`]: { body: { enabled: "yes" } },
        [`${API}/code-scanning/default-setup`]: { body: { state: "pending", languages: ["actions"] } },
        [`${API}/actions/permissions/workflow`]: { body: { default_workflow_permissions: null } },
      },
    });

    expect(lines.slice(1, 5)).toEqual([
      `SKIP Dependabot security updates: ${NOT_READ} GitHub's answer is not one this tool knows: {}`,
      `SKIP Private vulnerability reporting: ${NOT_READ} GitHub's answer is not one this tool knows: {"enabled":"yes"}`,
      `SKIP CodeQL default setup, with the actions language: ${NOT_READ} GitHub's answer is not one this tool knows: {"state":"pending","languages":["actions"]}`,
      `SKIP Workflow permissions default to read: ${NOT_READ} GitHub's answer is not one this tool knows: {"default_workflow_permissions":null}`,
    ]);
    expect(status).toBe(2);
  });

  it("exits 1, not 2, when one setting is off and another could not be read", () => {
    const { status, lines } = check({
      answers: { [`${API}/private-vulnerability-reporting`]: { body: { enabled: false } }, [`${API}/code-scanning/default-setup`]: { http: 403, message: "Forbidden" } },
    });

    expect(lines.slice(-2)).toEqual([`${REPOSITORY}: 7 on, 1 off, 1 not read. ${NOTHING_CHANGED}`, A_PERSON_RUNS_IT]);
    expect(status).toBe(1);
  });
});

describe("when GitHub cannot be asked at all", () => {
  it("says gh is not installed, in one line that is not a pass, and exits 2", () => {
    const { status, lines } = check({ gh: "missing" });

    expect(lines).toEqual([`${NOTHING_READ} ${NO_GH}`]);
    expect(status).toBe(2);
  });

  it("says gh is not logged in, and how to log in", () => {
    const { status, lines } = check({ gh: "logged out" });

    expect(lines).toEqual([`${NOTHING_READ} \`gh\` is not logged in. Run \`gh auth login\``]);
    expect(status).toBe(2);
  });

  it("says GitHub refused the login when it answers 401", () => {
    const { status, lines } = check({ answers: { [API]: { http: 401, message: "Bad credentials" } } });

    expect(lines).toEqual([`${NOTHING_READ} GitHub refused the login \`gh\` used (HTTP 401: Bad credentials). Run \`gh auth login\`, or look at GH_TOKEN`]);
    expect(status).toBe(2);
  });

  it("says so when GitHub knows no such repository, or will not show it", () => {
    const { status, lines } = check({ answers: { [API]: NOT_FOUND } });

    expect(lines).toEqual([`${NOTHING_READ} GitHub answered HTTP 404: Not Found. There is no repository acme/app, or this login may not see it`]);
    expect(status).toBe(2);
  });

  it("gives gh's own first line when there is no network", () => {
    const { status, lines } = check({ answers: { [API]: { exit: 1, stderr: "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n" } } });

    expect(lines).toEqual([`${NOTHING_READ} \`gh\` got no answer from GitHub (error connecting to api.github.com)`]);
    expect(status).toBe(2);
  });

  it("asks GitHub nothing in a folder with no origin that gh knows no repository for", () => {
    const { status, lines, calls } = check({ origin: null });

    expect(lines).toEqual([`${NOTHING_READ} This folder has no GitHub repository: it has no \`origin\` remote, and \`gh repo view\` named none (no git remotes found)`]);
    expect(calls.filter(([, command]) => command === "api")).toEqual([]);
    expect(status).toBe(2);
  });

  it("says an origin on another host is not GitHub's, and does not print the address, which can hold a token", () => {
    const { status, lines } = check({ origin: "https://x-access-token:the-secret@gitlab.example.test/acme/app.git" });

    expect(lines).toEqual([`${NOTHING_READ} This folder has no GitHub repository: its \`origin\` is not an address on github.com, and \`gh repo view\` named none (no git remotes found)`]);
    expect(status).toBe(2);
  });

  it("says gh is not installed when that is why no repository was found", () => {
    const { status, lines } = check({ origin: null, gh: "missing" });

    expect(lines).toEqual([`${NOTHING_READ} ${NO_GH} (and it has no \`origin\` remote)`]);
    expect(status).toBe(2);
  });
});

describe("which repository is asked about", () => {
  it.each([
    "git@github.com:acme/app.git",
    "git@github.com:acme/app",
    "ssh://git@github.com/acme/app.git",
    "https://github.com/acme/app.git",
    "https://github.com/acme/app/",
    "https://someone@github.com/acme/app",
    "http://github.com/acme/app\n",
  ])("reads owner and name from an origin on github.com: %s", (url) => {
    expect(parseRemote(url)).toBe("acme/app");
  });

  it("keeps a dot and a dash in the name, and takes only a final .git off", () => {
    expect(parseRemote("git@github.com:acme-org/app.git.tools.git")).toBe("acme-org/app.git.tools");
  });

  it.each([
    "git@gitlab.com:acme/app.git",
    "git@work:acme/app.git",
    "https://github.com.example.test/acme/app",
    "https://example.test/github.com/acme/app",
    "https://github.com/acme",
    "https://github.com/acme/app/pulls",
    "../origin.git",
    "",
  ])("takes no name from an address that is not a repository on github.com: %j", (url) => {
    expect(parseRemote(url)).toBeUndefined();
  });

  it("asks gh which repository it is when origin is not an address on github.com", () => {
    const { status, calls, lines } = check({ origin: "git@work:acme/app.git", viewed: REPOSITORY });

    expect(calls.slice(0, 3)).toEqual([
      ["git", "remote", "get-url", "origin"],
      ["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      ["gh", "api", "--method", "GET", "repos/acme/app"],
    ]);
    expect(lines.at(-1)).toBe(`${REPOSITORY}: 9 on, 0 off, 0 not read. ${NOTHING_CHANGED}`);
    expect(status).toBe(0);
  });

  it("takes from gh only a plain owner/name, never something that would read as more of a command", () => {
    const { status, calls } = check({ origin: null, viewed: "acme/app -X DELETE" });

    expect(calls.filter(([, command]) => command === "api")).toEqual([]);
    expect(status).toBe(2);
  });
});

describe("the ruleset on the default branch", () => {
  it("fails all three, each on its own line, when no rule holds on the branch, and prints a command that makes a ruleset with all three", () => {
    const { status, lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: [] }, [`${API}/rulesets`]: { body: [] } } });

    expect(lines).toEqual(
      expected(
        {
          pullRequest: ["FAIL Ruleset on main: a pull request is required: no active ruleset requires one (`pull_request`)"],
          history: [
            "FAIL Ruleset on main: deletion and force pushes are blocked: no active ruleset blocks deletion (`deletion`); no active ruleset blocks a force push (`non_fast_forward`)",
          ],
          checks: [
            `FAIL Ruleset on main: the status checks of every pull request are required: no active ruleset requires "${CHECK}"`,
            RULESET_WHERE,
            RULESET_FIX,
            RULESET_COMMAND,
            JSON.stringify(rulesetBody([CHECK]), null, 2),
            "JSON",
          ],
        },
        "6 on, 3 off, 0 not read",
      ),
    );
    expect(status).toBe(1);
  });

  it("prints, as the body of that command, JSON that GitHub can read: between the two marks, and nothing else", () => {
    const { lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: [] } } });
    const start = lines.indexOf(RULESET_COMMAND);
    const end = lines.indexOf("JSON");

    expect(start).toBeGreaterThan(-1);
    expect(end).toBe(start + 2);
    expect(JSON.parse(lines[start + 1] ?? "")).toEqual(rulesetBody([CHECK]));
  });

  it("makes a ruleset that is active on the default branch, needs a pull request with no approval, blocks deletion and force pushes, and requires the checks it is given", () => {
    expect(rulesetBody(["a", "b · c"])).toEqual({
      name: "default branch: pull request, checks, no deletion, no force push",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
          },
        },
        { type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "a" }, { context: "b · c" }] } },
      ],
    });
  });

  it("names a ruleset that is there and not active: its rules do not count, and the list of rules does not show it", () => {
    const { status, lines } = check({
      answers: {
        [`${API}/rules/branches/main`]: { body: [] },
        [`${API}/rulesets`]: {
          body: [
            { id: 1, name: "main branch", target: "branch", enforcement: "disabled" },
            { id: 2, name: "trial", target: "branch", enforcement: "evaluate" },
            { id: 3, name: "release tags", target: "tag", enforcement: "disabled" },
            { id: 4, name: "in force", target: "branch", enforcement: "active" },
          ],
        },
      },
    });

    expect(lines.filter((line) => line.startsWith("  there: "))).toEqual([
      '  there: the ruleset "main branch" has the enforcement status "disabled", so none of its rules count. Set it to Active there',
      '  there: the ruleset "trial" has the enforcement status "evaluate", so none of its rules count. Set it to Active there',
    ]);
    expect(lines.filter((line) => line.startsWith("FAIL Ruleset on main: "))).toHaveLength(3);
    expect(status).toBe(1);
  });

  it("still prints the command when the list of rulesets cannot be read", () => {
    const { lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: [] }, [`${API}/rulesets`]: { http: 403, message: "Forbidden" } } });

    expect(lines.filter((line) => line.startsWith("  there: "))).toEqual([]);
    expect(lines).toContain(RULESET_COMMAND);
  });

  it("says the branch has a classic protection rule, which it does not read, before it sends a person to make a ruleset", () => {
    const { lines } = check({
      answers: { [`${API}/rules/branches/main`]: { body: [] }, [`${API}/rulesets`]: { body: [] }, [`${API}/branches/main`]: { body: { protected: true, protection: { enabled: true } } } },
    });

    expect(lines.filter((line) => line.startsWith("  there: "))).toEqual([
      "  there: the branch has a classic branch protection rule (Settings → Branches, https://github.com/acme/app/settings/branches). This reads rulesets only, so that rule may already hold what a line above asks for",
    ]);
  });

  it("fails only the pull request line when that rule alone is missing", () => {
    const { status, lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: [rule("deletion"), rule("non_fast_forward"), requiredChecksRule(CHECK)] } } });

    expect(lines.slice(6, 9)).toEqual([
      "FAIL Ruleset on main: a pull request is required: no active ruleset requires one (`pull_request`)",
      ...PASS.history,
      `PASS Ruleset on main: the status checks of every pull request are required: "${CHECK}"`,
    ]);
    expect(lines.at(-2)).toBe(`${REPOSITORY}: 8 on, 1 off, 0 not read. ${NOTHING_CHANGED}`);
    expect(status).toBe(1);
  });

  it("names deletion alone when force pushes are blocked and deletion is not", () => {
    const { status, lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: [rule("non_fast_forward"), PULL_REQUEST_RULE, requiredChecksRule(CHECK)] } } });

    expect(lines.slice(6, 9)).toEqual([
      ...PASS.pullRequest,
      "FAIL Ruleset on main: deletion and force pushes are blocked: no active ruleset blocks deletion (`deletion`)",
      ...PASS.checks,
    ]);
    expect(status).toBe(1);
  });

  it("names the force push alone when deletion is blocked and a force push is not", () => {
    const { status, lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: [rule("deletion"), PULL_REQUEST_RULE, requiredChecksRule(CHECK)] } } });

    expect(lines[7]).toBe("FAIL Ruleset on main: deletion and force pushes are blocked: no active ruleset blocks a force push (`non_fast_forward`)");
    expect(status).toBe(1);
  });

  it("names each check a pull request runs that the ruleset does not require, and no other", () => {
    const { status, lines } = check(
      { answers: { [`${API}/rules/branches/main`]: { body: [rule("deletion"), rule("non_fast_forward"), PULL_REQUEST_RULE, requiredChecksRule("unit tests", "a check of another tool")] } } },
      { ".github/workflows/ci.yml": workflow("unit tests", "lint", "build") },
    );

    expect(lines[8]).toBe('FAIL Ruleset on main: the status checks of every pull request are required: no active ruleset requires "lint", "build"');
    expect(status).toBe(1);
  });

  it("counts the checks of every rule together: two rulesets can each require some", () => {
    const { status, lines } = check(
      { answers: { [`${API}/rules/branches/main`]: { body: [rule("deletion"), rule("non_fast_forward"), PULL_REQUEST_RULE, requiredChecksRule("unit tests"), requiredChecksRule("lint", "build")] } } },
      { ".github/workflows/ci.yml": workflow("unit tests", "lint", "build") },
    );

    expect(lines[8]).toBe('PASS Ruleset on main: the status checks of every pull request are required: "unit tests", "lint", "build"');
    expect(status).toBe(0);
  });

  it("reads every page of the rules: a rule on the second page holds as much as one on the first", () => {
    const filler = Array.from({ length: 100 }, () => rule("required_signatures"));
    const pages: Reply = (page) => ({ body: page === 1 ? filler : page === 2 ? [rule("deletion"), rule("non_fast_forward"), PULL_REQUEST_RULE, requiredChecksRule(CHECK)] : [] });
    const { status, lines, calls } = check({ answers: { [`${API}/rules/branches/main`]: pages } });

    expect(lines).toEqual(expected({}, "9 on, 0 off, 0 not read"));
    expect(calls.map((call) => call.at(-1)).filter((path) => path?.includes("/rules/branches/"))).toEqual([
      "repos/acme/app/rules/branches/main?per_page=100&page=1",
      "repos/acme/app/rules/branches/main?per_page=100&page=2",
    ]);
    expect(status).toBe(0);
  });

  it("does not judge half a list: a page that cannot be read leaves all three lines not read", () => {
    const filler = Array.from({ length: 100 }, () => rule("deletion"));
    const pages: Reply = (page) => (page === 1 ? { body: filler } : { http: 502, message: "Server Error" });
    const { status, lines } = check({ answers: { [`${API}/rules/branches/main`]: pages } });

    expect(lines.slice(6, 9)).toEqual([
      `SKIP Ruleset on main: a pull request is required: ${NOT_READ} GitHub answered HTTP 502: Server Error`,
      `SKIP Ruleset on main: deletion and force pushes are blocked: ${NOT_READ} GitHub answered HTTP 502: Server Error`,
      `SKIP Ruleset on main: the status checks of every pull request are required: ${NOT_READ} GitHub answered HTTP 502: Server Error`,
    ]);
    expect(status).toBe(2);
  });

  it("does not read an answer that is not a list of rules as a branch with no rule", () => {
    const { status, lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: { message: "moved" } } } });

    expect(lines[6]).toBe(`SKIP Ruleset on main: a pull request is required: ${NOT_READ} GitHub answered HTTP 200: the answer is not a list`);
    expect(lines.filter((line) => line.startsWith("FAIL "))).toEqual([]);
    expect(status).toBe(2);
  });

  it("asks about the branch GitHub names as the default, written as a path", () => {
    const { status, lines, calls } = check({
      answers: {
        [API]: repository({ default_branch: "release/1#0" }),
        [`${API}/rules/branches/release/1%230`]: { body: [rule("deletion"), rule("non_fast_forward"), PULL_REQUEST_RULE, requiredChecksRule(CHECK)] },
      },
    });

    expect(calls.at(-1)).toEqual(["gh", "api", "--method", "GET", "repos/acme/app/rules/branches/release/1%230?per_page=100&page=1"]);
    expect(lines[6]).toBe("PASS Ruleset on release/1#0: a pull request is required");
    expect(status).toBe(0);
  });

  it("reads no rule when GitHub's answer names no default branch", () => {
    const { status, lines, calls } = check({ answers: { [API]: repository({ default_branch: undefined }) } });

    expect(lines[6]).toBe(`SKIP Ruleset on the default branch: a pull request is required: ${NOT_READ} GitHub's answer does not name the default branch`);
    expect(calls.filter((call) => call.at(-1)?.includes("/rules/"))).toEqual([]);
    expect(status).toBe(2);
  });

  it("does not pass the status checks of a project whose workflows name none: there is nothing to compare", () => {
    const { status, lines } = check({}, { ".github/workflows/nightly.yml": "on:\n  schedule:\n    - cron: '0 3 * * *'\njobs:\n  sweep:\n    runs-on: ubuntu-latest\n" });

    expect(lines[8]).toBe(
      `SKIP Ruleset on main: the status checks of every pull request are required: ${NOT_READ} no job in .github/workflows runs on every pull request, so there is no status check to ask for (not asked for, because a pull request can skip it or its check has no one name: "sweep")`,
    );
    expect(lines.at(-1)).toBe(`${REPOSITORY}: 8 on, 0 off, 1 not read. ${NOTHING_CHANGED}`);
    expect(status).toBe(2);
  });

  it("leaves the status checks out of the command, and says so, when the workflows name none", () => {
    const { lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: [] }, [`${API}/rulesets`]: { body: [] } } }, {});
    const body = JSON.parse(lines[lines.indexOf(RULESET_COMMAND) + 1] ?? "") as { rules: { type: string }[] };

    expect(body.rules.map(({ type }) => type)).toEqual(["deletion", "non_fast_forward", "pull_request"]);
    expect(lines).toContain("  no status check is in the command below: no job in .github/workflows runs on every pull request, so there is no status check to ask for");
  });

  it("says which jobs it does not ask for, on the line, and why, above the command", () => {
    const files = {
      ".github/workflows/ci.yml": WORKFLOW,
      ".github/workflows/pages.yml": "on:\n  pull_request:\n  push:\njobs:\n  publish:\n    name: publish the report\n    if: github.event_name == 'push'\n    runs-on: ubuntu-latest\n",
    };
    const note = '(not asked for, because a pull request can skip it or its check has no one name: "publish the report")';

    expect(check({}, files).lines[8]).toBe(`${PASS.checks[0]} ${note}`);

    const { lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: [] }, [`${API}/rulesets`]: { body: [] } } }, files);

    expect(lines[8]).toBe(`FAIL Ruleset on main: the status checks of every pull request are required: no active ruleset requires "${CHECK}" ${note}`);
    expect(lines).toContain('  left out of the status checks: "publish the report" (.github/workflows/pages.yml): it has an `if:`, so a pull request can skip it');
    expect(JSON.stringify(JSON.parse(lines[lines.indexOf(RULESET_COMMAND) + 1] ?? ""))).not.toContain("publish the report");
  });

  it("names a workflow it could not read on the line, and does not count that as a pass of its jobs", () => {
    const { lines } = check({}, { ".github/workflows/ci.yml": WORKFLOW, ".github/workflows/odd.yml": "on: { pull_request: {} }\njobs:\n  odd:\n    runs-on: ubuntu-latest\n" });

    expect(lines[8]).toBe(`${PASS.checks[0]} (not judged: .github/workflows/odd.yml, because its \`on:\` is written in braces on one line)`);
  });
});

describe("node tools/ci-security/check-settings.mts", () => {
  it("reads the project it is installed in, or the one `--root` names, and nothing else", () => {
    expect(parseArguments([], "/the/project")).toBe("/the/project");
    expect(parseArguments(["--root", "/another"], "/the/project")).toBe("/another");
    expect(parseArguments(["--root", "another"], "/the/project")).toBe(resolve("another"));
    expect(parseArguments(["--root"], "/the/project")).toBeUndefined();
    expect(parseArguments(["--root", ""], "/the/project")).toBeUndefined();
    expect(parseArguments(["--fix"], "/the/project")).toBeUndefined();
    expect(parseArguments(["--root", "/another", "--fix"], "/the/project")).toBeUndefined();
  });

  it("exits 2 with one SKIP line on a machine with no gh and no git", () => {
    const project = createProject(PROJECT);
    const result = runTool(project, [], join(project, "no-programs"));

    expect(result.stdout).toBe(`${NOTHING_READ} ${NO_GH} (and it has no \`origin\` remote)\n`);
    expect(result.status).toBe(2);
  });

  it("exits 2 on an argument it does not know, and asks nothing", () => {
    const project = createProject(PROJECT);
    const result = runTool(project, ["--fix"], stubPrograms(project));

    expect(result.stderr).toBe('repo:settings could not run: unknown arguments "--fix" (use --root <dir>)\n');
    expect(result.stdout).toBe("");
    expect(result.status).toBe(2);
  });

  it("exits 0 with every line when the programs it starts say every setting is on, in the project `--root` names", () => {
    const project = createProject(PROJECT);
    const elsewhere = createProject({});
    const result = runTool(elsewhere, ["--root", project], stubPrograms(project));

    expect(result.stdout.trimEnd().split("\n")).toEqual(expected({}, "9 on, 0 off, 0 not read"));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("exits 1 when a setting is off", () => {
    const project = createProject(PROJECT);
    const result = runTool(project, [], stubPrograms(project, { deletes: false }));

    expect(result.stdout).toContain("FAIL Merged branches are deleted: off\n");
    expect(result.status).toBe(1);
  });
});

const EVERYTHING_OFF: Record<string, Reply> = {
  [API]: repository({ delete_branch_on_merge: false }),
  [`${API}/vulnerability-alerts`]: { http: 404, message: "Vulnerability alerts are disabled." },
  [`${API}/automated-security-fixes`]: { body: { enabled: false, paused: false } },
  [`${API}/private-vulnerability-reporting`]: { body: { enabled: false } },
  [`${API}/code-scanning/default-setup`]: { body: { state: "not-configured", languages: ["actions"] } },
  [`${API}/actions/permissions/workflow`]: { body: { default_workflow_permissions: "write" } },
  [`${API}/rules/branches/main`]: { body: [] },
  [`${API}/rulesets`]: { body: [] },
  [`${API}/branches/main`]: { body: { protected: false, protection: { enabled: false } } },
};

describe("text from outside, as it is printed", () => {
  it("writes each character a terminal acts on as its escape, and leaves every other as it is", () => {
    expect(shown("a\u0007b\u009bc\u2028d\u200be é · → \"x\"")).toBe('a\\u0007b\\u009bc\\u2028d\\u200be é · → "x"');
  });

  it("writes out a space that is not the space, a soft hyphen, and a tag, which has two halves", () => {
    expect(shown("a\u00a0b\u00adc\u{e0041}d")).toBe("a\\u00a0b\\u00adc\\udb40\\udc41d");
    expect(JSON.parse(`"${shown("\u{e0041}")}"`)).toBe("\u{e0041}");
  });

  it("writes out a control character in a ruleset's name, which could clear a line and write a PASS no check gave", () => {
    const { lines } = check({
      answers: {
        [`${API}/rules/branches/main`]: { body: [] },
        [`${API}/rulesets`]: { body: [{ name: "x\u001b[2K\rPASS all\nPASS more", target: "branch", enforcement: "disabled" }] },
      },
    });

    expect(lines.filter((line) => line.startsWith("  there: the ruleset"))).toEqual([
      '  there: the ruleset "x\\u001b[2K\\u000dPASS all\\u000aPASS more" has the enforcement status "disabled", so none of its rules count. Set it to Active there',
    ]);
  });

  it("writes out a mark that turns the text round in a job's name, and still asks for that check in the command, on lines of its own", () => {
    const name = "li\u202ent";
    const { lines } = check({ answers: { [`${API}/rules/branches/main`]: { body: [] }, [`${API}/rulesets`]: { body: [] } } }, { ".github/workflows/ci.yml": workflow(name) });
    const body = lines[lines.indexOf(RULESET_COMMAND) + 1] ?? "";
    const { rules } = JSON.parse(body) as { rules: { parameters?: { required_status_checks?: { context: string }[] } }[] };

    expect(lines.join("\n")).not.toContain("\u202e");
    expect(body).toContain('"context": "li\\u202ent"');
    expect(body.split("\n").length).toBeGreaterThan(10);
    expect(rules.flatMap((rule) => rule.parameters?.required_status_checks ?? [])).toEqual([{ context: name }]);
  });
});

/** The lines of a run: the PASS line of every setting but the ones given, then the count. */
function expected(change: Partial<Record<keyof typeof PASS, string[]>>, counts: string): string[] {
  const lines = Object.values({ ...PASS, ...change }).flat();

  return [...lines, `${REPOSITORY}: ${counts}. ${NOTHING_CHANGED}`, ...(lines.some((line) => line.startsWith("FAIL ")) ? [A_PERSON_RUNS_IT] : [])];
}

/** A workflow every pull request starts, with one job of each name. */
function workflow(...names: string[]): string {
  return ["on:", "  pull_request:", "jobs:", ...names.flatMap((name, index) => [`  job-${index}:`, `    name: ${name}`, "    runs-on: ubuntu-latest"]), ""].join("\n");
}

function check(world: World = {}, files: Record<string, string> = PROJECT): { status: number; lines: string[]; calls: string[][] } {
  const { run, calls } = createGitHub(world);
  const lines: string[] = [];
  const status = checkSettings({ root: createFolder(files), run, report: (line) => lines.push(line) });

  return { status, lines, calls };
}

/** A project folder holding the add-on's tools, where a project has them. */
function createProject(files: Record<string, string>): string {
  const project = createFolder({ "no-programs/.keep": "", ...files });

  cpSync(join(ADDON, "files/tools"), join(project, "tools"), { recursive: true });

  return project;
}

/**
 * A folder to use as the PATH, holding a `git` and a `gh` that are shell
 * scripts: they answer for a repository with every setting on, in `project`
 * only, and `gh` answers a read only.
 */
function stubPrograms(project: string, { deletes = true }: { deletes?: boolean } = {}): string {
  const answers: [string, string][] = [
    ["", JSON.stringify({ default_branch: "main", delete_branch_on_merge: deletes, permissions: { admin: true } })],
    ["/vulnerability-alerts", ""],
    ["/automated-security-fixes", '{"enabled":true,"paused":false}'],
    ["/private-vulnerability-reporting", '{"enabled":true}'],
    ["/code-scanning/default-setup", '{"state":"configured","languages":["actions","javascript-typescript"]}'],
    ["/actions/permissions/workflow", '{"default_workflow_permissions":"read"}'],
    ["/rules/branches/main?per_page=100&page=1", JSON.stringify([rule("deletion"), rule("non_fast_forward"), PULL_REQUEST_RULE, requiredChecksRule(CHECK)])],
  ];
  const inProject = `[ "$(pwd -P)" = '${project}' ] || { echo "run in $(pwd -P)" >&2; exit 9; }`;
  const bin = createFolder({
    git: `#!/bin/sh\n${inProject}\n[ "$*" = "remote get-url origin" ] || exit 9\necho 'git@github.com:${REPOSITORY}.git'\n`,
    gh: [
      "#!/bin/sh",
      inProject,
      '[ "$1 $2 $3 $#" = "api --method GET 4" ] || { echo "this gh takes reads only" >&2; exit 9; }',
      'case "$4" in',
      ...answers.map(([path, body]) => `  '${API}${path}') printf '%s' '${body}' ;;`),
      "  *) printf '%s' '{\"message\":\"Not Found\",\"status\":\"404\"}'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
  });

  chmodSync(join(bin, "git"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);

  return bin;
}

function runTool(project: string, toolArguments: string[], path: string): { status: number | null; stdout: string; stderr: string } {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(project, "tools/ci-security/check-settings.mts"), ...toolArguments], { encoding: "utf8", env: { PATH: path } });

  return { status, stdout, stderr };
}
