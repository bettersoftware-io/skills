// A GitHub for the settings check's tests: a function that answers `git` and
// `gh` the way the real programs do. Nothing here reaches a network.
//
// Seen from GitHub and from `gh` on 2026-10-12, and copied here: every answer
// of a repository with all settings on; alerts, security updates, private
// reporting, CodeQL and branch deletion off, and no rule on the branch; the
// 404, the 403 and the missing field a login gets that can only read; and
// what `gh` prints with no login, a refused token and no network. Written
// from GitHub's API description and not seen: a `write` default for workflow
// permissions, CodeQL set up without `actions`, a ruleset that is not
// active, and a 422 or a 502.

import type { Ran, Run } from "../files/tools/ci-security/lib/settings.mts";

/**
 * What comes back from one read: a body (undefined for a 204), GitHub's
 * refusal, `gh` stopping with no answer from GitHub, or a function of the
 * page asked for.
 */
export type Reply = { body: unknown } | { http: number; message: string } | { exit: number; stderr: string } | ((page: number) => Reply);

export interface World {
  /** What `git remote get-url origin` prints. Null: the checkout has no `origin`. */
  origin?: string | null;
  /** What `gh repo view` names. Undefined: it names none. */
  viewed?: string;
  /** `missing`: no `gh` on the PATH. `logged out`: `gh` has no login. */
  gh?: "missing" | "logged out";
  /** Answers in place of the usual ones, by path with no query. */
  answers?: Record<string, Reply>;
}

export interface GitHub {
  run: Run;
  /** Every program started, with its arguments. */
  calls: string[][];
}

export const REPOSITORY = "acme/app";
export const API = `repos/${REPOSITORY}`;

/** The one job of the project the tests check: see `WORKFLOW` in the test file. */
export const CHECK = "gates · lint · typecheck · test · build";

export function rule(type: string, parameters?: Record<string, unknown>): Record<string, unknown> {
  return { type, ...(parameters === undefined ? {} : { parameters }), ruleset_source_type: "Repository", ruleset_source: REPOSITORY, ruleset_id: 24924218 };
}

export function requiredChecksRule(...contexts: string[]): Record<string, unknown> {
  return rule("required_status_checks", {
    strict_required_status_checks_policy: false,
    do_not_enforce_on_create: false,
    required_status_checks: contexts.map((context) => ({ context, integration_id: 15368 })),
  });
}

export const PULL_REQUEST_RULE = rule("pull_request", { required_approving_review_count: 0, allowed_merge_methods: ["merge"] });

/** The repository as GitHub describes it to one who may administer it. */
export function repository(change: Record<string, unknown> = {}): Reply {
  return { body: { default_branch: "main", delete_branch_on_merge: true, private: false, permissions: { admin: true, push: true, pull: true }, ...change } };
}

/** What GitHub answers a login that may not see a setting: the same 404 as for a repository that is not there. */
export const NOT_FOUND: Reply = { http: 404, message: "Not Found" };

/** Every setting on. */
const ANSWERS: Record<string, Reply> = {
  [API]: repository(),
  [`${API}/vulnerability-alerts`]: { body: undefined },
  [`${API}/automated-security-fixes`]: { body: { enabled: true, paused: false } },
  [`${API}/private-vulnerability-reporting`]: { body: { enabled: true } },
  [`${API}/code-scanning/default-setup`]: { body: { state: "configured", languages: ["actions", "javascript", "javascript-typescript", "typescript"], query_suite: "default" } },
  [`${API}/actions/permissions/workflow`]: { body: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false } },
  [`${API}/rules/branches/main`]: { body: [rule("deletion"), rule("non_fast_forward"), PULL_REQUEST_RULE, requiredChecksRule(CHECK)] },
  [`${API}/rulesets`]: { body: [{ id: 24924218, name: "main branch", target: "branch", enforcement: "active" }] },
  [`${API}/branches/main`]: { body: { name: "main", protected: true, protection: { enabled: false } } },
};

export function createGitHub({ origin = `git@github.com:${REPOSITORY}.git`, viewed, gh, answers = {} }: World = {}): GitHub {
  const calls: string[][] = [];
  const known = { ...ANSWERS, ...answers };

  return {
    calls,
    run: (program, args) => {
      calls.push([program, ...args]);

      if (program === "git") {
        return origin === null ? ran(2, "", "error: No such remote 'origin'\n") : ran(0, `${origin}\n`);
      }

      if (gh === "missing") {
        return ran(127, "", "spawnSync gh ENOENT");
      }

      if (args[0] === "repo") {
        return viewed === undefined ? ran(1, "", "no git remotes found\n") : ran(0, `${viewed}\n`);
      }

      if (gh === "logged out") {
        return ran(4, "", "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n");
      }

      const [command, flag, method, target = ""] = args;

      if (command !== "api" || flag !== "--method" || method !== "GET" || args.length !== 4) {
        return ran(1, "", "this GitHub takes reads only\n");
      }

      const [path = "", query = ""] = target.split("?");
      const page = Number(new URLSearchParams(query).get("page") ?? "1");
      const found = known[path] ?? NOT_FOUND;
      const reply = typeof found === "function" ? found(page) : found;

      if (typeof reply === "function") {
        throw new Error(`the reply for ${path} is a function of a function`);
      }

      if ("exit" in reply) {
        return ran(reply.exit, "", reply.stderr);
      }

      return "http" in reply
        ? ran(1, JSON.stringify({ message: reply.message, documentation_url: "https://docs.github.com/rest", status: String(reply.http) }), `gh: ${reply.message} (HTTP ${reply.http})\n`)
        : ran(0, reply.body === undefined ? "" : JSON.stringify(reply.body));
    },
  };
}

function ran(status: number, stdout: string, stderr = ""): Ran {
  return { status, stdout, stderr };
}
