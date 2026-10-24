import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { changelog } from "../files/tools/agent-workflow/changelog.mts";
import { ASK_RULES } from "../files/tools/agent-workflow/lib/host.mts";
import { type Ran, type Run, run } from "../files/tools/agent-workflow/lib/system.mts";
import { ADDON, commit, createFolder, git, mergeAt } from "./support.mts";

// Monday 12 October 2026: 2026-W40 (28 September to 4 October) is over, and
// 2026-W42 is running.
const NOW = new Date("2026-10-12T09:00:00Z");

describe("changelog tag", () => {
  it("plans without --apply, naming the commit's date and subject, and writes nothing", () => {
    const { repository, shas } = createHistory();
    const { status, lines, calls } = tag(repository, ["tag", "2026-W40"]);

    expect(status).toBe(0);
    expect(lines).toEqual([`would tag ${shas.lastOfWeek} (2026-10-04T22:00:00Z, "late on sunday") as 2026-W40, dated 2026-10-05T00:05:00Z`]);
    expect(calls.filter((call) => call.includes("git/tags") || call.includes("git/refs"))).toEqual([]);
  });

  it("refuses a week that has a tag", () => {
    const { repository } = createHistory();
    const { status, lines, calls } = tag(repository, ["tag", "2026-W40", "--apply"], { tagExists: true });

    expect(status).toBe(1);
    expect(lines).toEqual(["FAIL changelog tag: the tag 2026-W40 exists. This never moves a tag"]);
    expect(calls.filter((call) => call.includes("git/tags") || call.includes("git/refs"))).toEqual([]);
  });

  it("creates the tag on the week's last first-parent commit, dated by its week", () => {
    const { repository, shas } = createHistory();
    const { status, lines, created } = tag(repository, ["tag", "2026-W40", "--apply"]);

    expect(status).toBe(0);
    expect(created).toEqual({ tag: "2026-W40", object: shas.lastOfWeek, date: "2026-10-05T00:05:00Z", ref: "refs/tags/2026-W40" });
    expect(lines).toEqual([`Tagged ${shas.lastOfWeek} as 2026-W40, dated 2026-10-05T00:05:00Z`]);
  });

  it("takes the commit from the remote branch, not from the checkout", () => {
    const { repository, shas } = createHistory();

    commit(repository, "local only, in the week", { a: "5" }, "2026-10-04T23:00:00Z");

    expect(tag(repository, ["tag", "2026-W40"]).lines).toEqual([`would tag ${shas.lastOfWeek} (2026-10-04T22:00:00Z, "late on sunday") as 2026-W40, dated 2026-10-05T00:05:00Z`]);
  });

  it("follows the branch itself: a commit that came in by a later merge is not the week's", () => {
    const repository = createFolder();

    git(repository, "init", "--quiet", "--initial-branch=main");

    const onMain = commit(repository, "on main, in the week", { a: "1" }, "2026-09-30T10:00:00Z");

    git(repository, "checkout", "--quiet", "-b", "side");
    commit(repository, "on a side branch, later in the week", { b: "1" }, "2026-10-02T10:00:00Z");
    git(repository, "checkout", "--quiet", "main");
    mergeAt(repository, "side", "merge side", "2026-10-05T09:00:00Z");
    git(repository, "update-ref", "refs/remotes/origin/main", "HEAD");

    expect(tag(repository, ["tag", "2026-W40"]).lines).toEqual([`would tag ${onMain} (2026-09-30T10:00:00Z, "on main, in the week") as 2026-W40, dated 2026-10-05T00:05:00Z`]);
  });

  it("refuses a week that is not over, naming the weekly workflow", () => {
    const { repository } = createHistory();
    const { status, lines, calls } = tag(repository, ["tag", "2026-W42", "--apply"]);

    expect(status).toBe(1);
    expect(lines).toEqual(["FAIL changelog tag: 2026-W42 is not over yet: its tag is made by the weekly workflow"]);
    expect(calls).toEqual([]);
  });

  it("does not take a failed question for a missing tag", () => {
    const { repository } = createHistory();
    const { status, lines, created } = tag(repository, ["tag", "2026-W40", "--apply"], { lookup: "gh: Bad credentials (HTTP 401)" });

    expect(status).toBe(1);
    expect(lines).toEqual(["FAIL changelog tag: could not ask GitHub whether 2026-W40 exists (gh: Bad credentials (HTTP 401))"]);
    expect(created).toBeUndefined();
  });

  it("names the step that failed", () => {
    const { repository } = createHistory();
    const { status, lines } = tag(repository, ["tag", "2026-W40", "--apply"], { refuse: "git/refs" });

    expect(status).toBe(1);
    expect(lines).toEqual(["FAIL changelog tag: GitHub did not create the tag (gh: Resource not accessible by integration (HTTP 403))"]);

    const object = tag(repository, ["tag", "2026-W40", "--apply"], { refuse: "git/tags" });

    expect(object.status).toBe(1);
    expect(object.lines).toEqual(["FAIL changelog tag: GitHub did not create the tag object (gh: Resource not accessible by integration (HTTP 403))"]);
  });

  it("fails, planning or applying, when no commit reached the branch before the week ended", () => {
    const repository = createFolder();

    git(repository, "init", "--quiet", "--initial-branch=main");
    commit(repository, "after the week", { a: "1" }, "2026-10-06T10:00:00Z");
    git(repository, "update-ref", "refs/remotes/origin/main", "HEAD");

    for (const argv of [["tag", "2026-W40"], ["tag", "2026-W40", "--apply"]]) {
      const { status, lines, created } = tag(repository, argv);

      expect(status).toBe(1);
      expect(lines).toEqual(["FAIL changelog tag: no commit reached the default branch before the end of 2026-W40: there is nothing to tag"]);
      expect(created).toBeUndefined();
    }
  });

  it("says nothing was judged when there is no remote branch, or gh cannot name the repository", () => {
    const { repository } = createHistory();

    git(repository, "update-ref", "-d", "refs/remotes/origin/main");

    expect(tag(repository, ["tag", "2026-W40"])).toMatchObject({ status: 2, lines: [expect.stringContaining("SKIP changelog: ")] });

    const { repository: other } = createHistory();
    const noGh = tag(other, ["tag", "2026-W40"], { noRepository: true });

    expect(noGh.status).toBe(2);
    expect(noGh.lines[0]).toMatch(/^SKIP changelog: .*Nothing was judged$/);
  });

  it("says nothing was judged for a name that is no week", () => {
    expect(tag(createHistory().repository, ["tag", "next-week"]).status).toBe(2);
  });
});

describe("the ask rules for --apply", () => {
  const RULES = [
    ...["Bash(pnpm changelog tag *--apply*)", "Bash(pnpm run changelog tag *--apply*)", "Bash(node tools/agent-workflow/changelog.mts tag *--apply*)"],
    ...["Bash(pnpm changelog:releases *--apply*)", "Bash(pnpm run changelog:releases *--apply*)", "Bash(node tools/agent-workflow/sync-releases.mts *--apply*)"],
  ];
  const manifest = JSON.parse(readFileSync(join(ADDON, "addon.json"), "utf8")) as { hostSettings: Record<string, { permissions: { ask: string[] } }> };

  it("asks before either --apply, in the manifest and in host.mts", () => {
    for (const rule of RULES) {
      expect(ASK_RULES).toContain(rule);
      expect(manifest.hostSettings[".claude/settings.json"]?.permissions.ask).toContain(rule);
    }
  });
});

interface World {
  tagExists?: boolean;
  /** What `gh api …/git/ref/tags/<week>` says when it fails. */
  lookup?: string;
  /** A fragment of a gh call that GitHub refuses. */
  refuse?: string;
  noRepository?: boolean;
}

interface Tagged {
  status: number;
  lines: string[];
  calls: string[];
  created?: { tag: string; object: string; date: string; ref: string };
}

function tag(repository: string, argv: string[], world: World = {}): Tagged {
  const tagged: Tagged = { status: -1, lines: [], calls: [] };
  const made: { tag?: string; object?: string; date?: string } = {};
  const answer = (args: string[]): Ran => {
    const line = args.join(" ");
    const field = (name: string): string => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";

    if (line.startsWith("repo view")) {
      return world.noRepository ? { status: 1, stdout: "", stderr: "no git remotes found" } : ok("acme/app\n");
    }

    if (world.refuse !== undefined && line.includes(world.refuse)) {
      return { status: 1, stdout: "", stderr: "gh: Resource not accessible by integration (HTTP 403)" };
    }

    if (line.includes("git/ref/tags/")) {
      return world.tagExists ? ok("") : { status: 1, stdout: "", stderr: world.lookup ?? "gh: Not Found (HTTP 404)" };
    }

    if (line.includes("git/tags")) {
      Object.assign(made, { tag: field("tag"), object: field("object"), date: field("tagger[date]") });

      return ok("sha-of-the-tag-object\n");
    }

    if (line.includes("git/refs")) {
      tagged.created = { tag: made.tag ?? "", object: made.object ?? "", date: made.date ?? "", ref: field("ref") };

      return ok("");
    }

    throw new Error(`the fake GitHub was asked something it does not know: gh ${line}`);
  };
  const runProgram: Run = (program, args, cwd) => {
    if (program === "gh") {
      tagged.calls.push(args.join(" "));

      return answer(args);
    }

    return run(program, args, cwd);
  };

  tagged.status = changelog({ root: repository, argv, now: NOW, run: runProgram, report: (line) => tagged.lines.push(line) });

  return tagged;
}

function ok(stdout: string): Ran {
  return { status: 0, stdout, stderr: "" };
}

/** A branch with commits before, in and after 2026-W40, all of them on `origin/main`. */
function createHistory(): { repository: string; shas: { lastOfWeek: string } } {
  const repository = createFolder();

  git(repository, "init", "--quiet", "--initial-branch=main");
  commit(repository, "the week before", { a: "1" }, "2026-09-25T10:00:00Z");
  commit(repository, "early in the week", { a: "2" }, "2026-09-29T10:00:00Z");

  const lastOfWeek = commit(repository, "late on sunday", { a: "3" }, "2026-10-04T22:00:00Z");

  commit(repository, "monday morning", { a: "4" }, "2026-10-05T00:01:00Z");
  git(repository, "update-ref", "refs/remotes/origin/main", "HEAD");

  return { repository, shas: { lastOfWeek } };
}
