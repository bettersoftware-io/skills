import { describe, expect, it } from "vitest";

import { closeWeek } from "../files/tools/agent-workflow/close-week.mts";
import { type Ran, type Run, run } from "../files/tools/agent-workflow/lib/system.mts";
import { tagDate } from "../files/tools/agent-workflow/lib/tag.mts";
import { parseWeek } from "../files/tools/agent-workflow/lib/week.mts";
import { commit, createFolder, git, mergeAt } from "./support.mts";

// Monday 5 October 2026, 00:05 UTC: the moment the workflow runs. The week
// that has just ended is 2026-W40, 28 September to 4 October.
const NOW = "2026-10-05T00:05:00Z";

describe("closing the week that has just ended", () => {
  it("tags the last commit that reached the branch before Monday 00:00 UTC", () => {
    const { repository, shas } = createHistory();
    const { status, tagged, lines } = close(repository);

    expect(status).toBe(0);
    expect(tagged).toEqual({ tag: "2026-W40", object: shas.lastOfWeek, type: "commit" });
    expect(lines).toContain(`Tagged ${shas.lastOfWeek} as 2026-W40`);
  });

  it("leaves a commit made at Monday 00:00:00 exactly to the next week", () => {
    const repository = createRepository();
    const sunday = commit(repository, "sunday", { a: "1" }, "2026-10-04T23:59:59Z");

    commit(repository, "the first second of monday", { a: "2" }, "2026-10-05T00:00:00Z");

    expect(close(repository).tagged?.object).toBe(sunday);
  });

  it("follows the branch itself: a commit that came in by a later merge is not the week's, however old it is", () => {
    const repository = createRepository();
    const onMain = commit(repository, "on main, in the week", { a: "1" }, "2026-09-30T10:00:00Z");

    git(repository, "checkout", "--quiet", "-b", "side");
    commit(repository, "on a side branch, later in the week", { b: "1" }, "2026-10-02T10:00:00Z");
    git(repository, "checkout", "--quiet", "main");
    mergeAt(repository, "side", "merge side", "2026-10-05T09:00:00Z");

    expect(close(repository, "2026-10-12T00:05:00Z", "2026-W41").tagged).toBeDefined();
    expect(close(repository).tagged?.object).toBe(onMain);
  });

  it("creates the tag through the API, as an annotated tag and then a ref to it", () => {
    const { repository, shas } = createHistory();
    const { calls } = close(repository);

    expect(calls.filter(([program]) => program === "gh").slice(0, 3)).toEqual([
      ["gh", "api", "repos/acme/app/git/ref/tags/2026-W40", "--silent"],
      [
        ...["gh", "api", "repos/acme/app/git/tags", "-f", "tag=2026-W40"],
        ...["-f", "message=2026-W40 - the default branch at the end of 2026-09-28 .. 2026-10-04 (UTC). See CHANGELOG.md."],
        ...["-f", `object=${shas.lastOfWeek}`, "-f", "type=commit"],
        ...["-f", "tagger[name]=github-actions[bot]", "-f", "tagger[email]=41898282+github-actions[bot]@users.noreply.github.com"],
        ...["-f", "tagger[date]=2026-10-05T00:05:00Z", "--jq", ".sha"],
      ],
      ["gh", "api", "repos/acme/app/git/refs", "-f", "ref=refs/tags/2026-W40", "-f", "sha=sha-of-the-tag-object", "--silent"],
    ]);
    expect(calls.some(([program, command]) => program === "git" && command === "push")).toBe(false);
  });

  it("opens an issue that asks for the week's entry, with the number merged and how to write it", () => {
    const { repository } = createHistory();
    const { status, issue, calls } = close(repository, NOW, "2026-W40", { merged: 7 });

    expect(status).toBe(0);
    expect(issue?.title).toBe("Changelog: write 2026-W40");
    expect(issue?.body).toContain("**7 pull request(s)** were merged in 2026-W40 (2026-09-28 to 2026-10-04, UTC)");
    expect(issue?.body).toContain("/workflow:changelog 2026-W40");
    expect(issue?.body).toContain("$workflow-changelog 2026-W40");
    expect(issue?.body).toContain("pnpm changelog check 2026-W40");
    expect(calls.find(([, command, action]) => command === "pr" && action === "list")).toEqual([
      ...["gh", "pr", "list", "--repo", "acme/app", "--state", "merged", "--limit", "500"],
      ...["--search", "merged:2026-09-28..2026-10-04", "--json", "number"],
    ]);
  });

  it("dates the tag at Monday 00:05 UTC after its week, even on a late run", () => {
    const { repository } = createHistory();
    const { tagger } = close(repository, "2026-10-07T15:00:00Z");

    expect(tagger).toEqual({
      name: "github-actions[bot]",
      email: "41898282+github-actions[bot]@users.noreply.github.com",
      date: "2026-10-05T00:05:00Z",
    });
    expect(tagDate(parseWeek("2026-W53"))).toBe("2027-01-04T00:05:00Z");
  });

  it("lists every week still due in the issue", () => {
    const repository = createRepository();

    commit(repository, "the changelog", { "CHANGELOG.md": createChangelog({ "2026-W38": [3] }) }, "2026-09-01T10:00:00Z");
    mergePullRequest(repository, 3, "2026-09-16T10:00:00Z");
    mergePullRequest(repository, 4, "2026-09-23T10:00:00Z");
    mergePullRequest(repository, 5, "2026-09-30T10:00:00Z");

    const { issue } = close(repository);

    expect(issue?.title).toBe("Changelog: write 2026-W40");
    expect(issue?.body).toContain(
      [
        "Still due:",
        "- 2026-W39  1 merged, no entry: write it with /workflow:changelog 2026-W39",
        "- 2026-W40  1 merged, no entry: write it with /workflow:changelog 2026-W40",
      ].join("\n"),
    );
  });

  it("titles the issue extend when the week already has an entry", () => {
    const repository = createRepository();

    commit(repository, "the changelog", { "CHANGELOG.md": createChangelog({ "2026-W40": [5] }) }, "2026-09-01T10:00:00Z");
    mergePullRequest(repository, 5, "2026-09-29T10:00:00Z");
    mergePullRequest(repository, 6, "2026-09-30T10:00:00Z");

    const { issue, lines } = close(repository);

    expect(issue?.title).toBe("Changelog: extend 2026-W40");
    expect(issue?.body).toContain("- 2026-W40  2 merged, 1 not cited (#6): extend it with /workflow:changelog 2026-W40");
    expect(lines.at(-1)).toMatch(/^Opened "Changelog: extend 2026-W40" /);
  });

  it("opens no issue when the week's entry already cites every merge", () => {
    const repository = createRepository();

    commit(repository, "the changelog", { "CHANGELOG.md": createChangelog({ "2026-W40": [5] }) }, "2026-09-01T10:00:00Z");
    mergePullRequest(repository, 5, "2026-09-29T10:00:00Z");

    const { status, issue, tagged, lines } = close(repository);

    expect(status).toBe(0);
    expect(tagged).toBeDefined();
    expect(issue).toBeUndefined();
    expect(lines.at(-1)).toBe("2026-W40 already has a complete entry: no issue opened.");
  });

  it("still opens the issue when it cannot tell what else is due", () => {
    const { repository } = createHistory();
    const { status, issue } = close(repository);

    expect(status).toBe(0);
    expect(issue?.title).toBe("Changelog: write 2026-W40");
    expect(issue?.body).toContain("(Could not tell which other weeks are due: there is no CHANGELOG.md at the project root.)");
    expect(issue?.body).not.toContain("Still due:");
  });

  it("opens no issue for a week in which nothing was merged", () => {
    const { repository } = createHistory();
    const { status, issue, tagged, lines } = close(repository, NOW, "2026-W40", { merged: 0 });

    expect(status).toBe(0);
    expect(tagged).toBeDefined();
    expect(issue).toBeUndefined();
    expect(lines.at(-1)).toBe("No pull request was merged in 2026-W40: there is nothing to write up.");
  });

  it("does nothing at all when the week's tag exists", () => {
    const { repository } = createHistory();
    const { status, calls, lines } = close(repository, NOW, "2026-W40", { tagExists: true });

    expect(status).toBe(0);
    expect(calls).toEqual([["gh", "api", "repos/acme/app/git/ref/tags/2026-W40", "--silent"]]);
    expect(lines.at(-1)).toBe("The tag 2026-W40 exists: this week is already closed.");
  });

  it("creates nothing when it cannot tell whether the tag exists", () => {
    const { repository } = createHistory();
    const { status, calls, lines } = close(repository, NOW, "2026-W40", { lookup: "gh: Bad credentials (HTTP 401)" });

    expect(status).toBe(1);
    expect(calls).toHaveLength(1);
    expect(lines.at(-1)).toMatch(/^FAIL close-week: could not ask GitHub whether 2026-W40 exists \(gh: Bad credentials/);
  });

  it("tags nothing, and does not fail, when the branch has no commit that old", () => {
    const repository = createRepository();

    commit(repository, "the first commit, this week", { a: "1" }, "2026-10-05T09:00:00Z");

    const { status, tagged, issue, lines } = close(repository, "2026-10-06T00:00:00Z");

    expect(status).toBe(0);
    expect(tagged).toBeUndefined();
    expect(issue).toBeUndefined();
    expect(lines.at(-1)).toBe("No commit reached the default branch before the end of 2026-W40: there is nothing to tag.");
  });

  it.each([
    ["the tag object", { refuse: "git/tags" }, /GitHub did not create the tag object \(gh: Resource not accessible/, false],
    ["the tag", { refuse: "git/refs" }, /GitHub did not create the tag \(gh: Resource not accessible/, false],
    ["the count of merged pull requests", { refuse: "pr list" }, /the week is tagged, but gh could not count/, true],
    ["the issue", { refuse: "issue create" }, /the week is tagged, but the issue was not opened/, true],
  ])("fails, and says how far it got, when GitHub refuses %s", (_name, world, message, isTagged) => {
    const { repository } = createHistory();
    const { status, lines, tagged, issue } = close(repository, NOW, "2026-W40", world);

    expect(status).toBe(1);
    expect(lines.at(-1)).toMatch(message);
    expect(tagged !== undefined).toBe(isTagged);
    expect(issue).toBeUndefined();
  });

  it.each([undefined, "", "acme", "acme/app/extra", "acme/app --repo other/app"])("does not start without a repository name: %j", (repository) => {
    const lines: string[] = [];
    const calls: string[][] = [];
    const status = closeWeek({
      root: createFolder(),
      repository,
      now: new Date(NOW),
      run: (program, args) => {
        calls.push([program, ...args]);

        return { status: 0, stdout: "", stderr: "" };
      },
      report: (line) => lines.push(line),
    });

    expect(status).toBe(2);
    expect(calls).toEqual([]);
    expect(lines).toEqual(["SKIP close-week: GITHUB_REPOSITORY is not set to owner/name. Nothing was done"]);
  });
});

interface GitHub {
  tagExists?: boolean;
  /** What the lookup of the tag prints when it fails for another reason than "no such tag". */
  lookup?: string;
  merged?: number;
  /** A call GitHub refuses, named by a part of its arguments. */
  refuse?: string;
}

interface Closed {
  status: number;
  lines: string[];
  calls: string[][];
  tagged?: { tag: string; object: string; type: string };
  issue?: { title: string; body: string };
  tagger?: { name: string; email: string; date: string };
}

/** Runs the tool with the real git and a GitHub that answers as `world` says. */
function close(repository: string, now = NOW, week = "2026-W40", world: GitHub = {}): Closed {
  const closed: Closed = { status: -1, lines: [], calls: [] };
  let tagObject: Closed["tagged"];
  const answer = (args: string[]): Ran => {
    const line = args.join(" ");
    const field = (name: string): string => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";

    if (world.refuse !== undefined && line.includes(world.refuse)) {
      return { status: 1, stdout: "", stderr: "gh: Resource not accessible by integration (HTTP 403)" };
    }

    if (line.includes(`git/ref/tags/${week}`)) {
      return world.tagExists ? ok("") : { status: 1, stdout: "", stderr: world.lookup ?? "gh: Not Found (HTTP 404)" };
    }

    if (line.includes("git/tags")) {
      closed.tagger = { name: field("tagger[name]"), email: field("tagger[email]"), date: field("tagger[date]") };
      tagObject = { tag: field("tag"), object: field("object"), type: field("type") };

      return ok("sha-of-the-tag-object\n");
    }

    if (line.includes("git/refs")) {
      closed.tagged = field("ref") === `refs/tags/${tagObject?.tag}` && field("sha") === "sha-of-the-tag-object" ? tagObject : undefined;

      return ok("");
    }

    if (line.startsWith("pr list")) {
      return ok(JSON.stringify(Array.from({ length: world.merged ?? 3 }, (_, index) => ({ number: index + 1 }))));
    }

    if (line.startsWith("issue create")) {
      closed.issue = { title: args[args.indexOf("--title") + 1] ?? "", body: args[args.indexOf("--body") + 1] ?? "" };

      return ok("https://github.com/acme/app/issues/31\n");
    }

    throw new Error(`the fake GitHub was asked something it does not know: gh ${line}`);
  };
  const runProgram: Run = (program, args, cwd) => {
    closed.calls.push([program, ...args]);

    return program === "gh" ? answer(args) : run(program, args, cwd);
  };

  closed.status = closeWeek({
    root: repository,
    repository: "acme/app",
    now: new Date(now),
    run: runProgram,
    report: (line) => closed.lines.push(line),
  });

  return closed;
}

function createChangelog(weeks: Record<string, number[]>): string {
  const sections = Object.entries(weeks).map(([name, cited]) => `## ${name} — a week\n\n${cited.map((number) => `- change [#${number}]`).join("\n")}\n`);

  return ["# Changelog\n", ...sections].join("\n");
}

/** Merges a side branch into main as pull request `number`, at `date`. */
function mergePullRequest(repository: string, number: number, date: string): void {
  git(repository, "checkout", "--quiet", "-b", `pr-${number}`);
  commit(repository, `change ${number}`, { [`file-${number}`]: "1" }, date);
  git(repository, "checkout", "--quiet", "main");
  mergeAt(repository, `pr-${number}`, `Merge pull request #${number} from acme/pr-${number}`, date);
}

function ok(stdout: string): Ran {
  return { status: 0, stdout, stderr: "" };
}

function createRepository(): string {
  const repository = createFolder();

  git(repository, "init", "--quiet", "--initial-branch=main");

  return repository;
}

/** A branch with commits before, in and after 2026-W40. */
function createHistory(): { repository: string; shas: { lastOfWeek: string } } {
  const repository = createRepository();

  commit(repository, "the week before", { a: "1" }, "2026-09-25T10:00:00Z");
  commit(repository, "early in the week", { a: "2" }, "2026-09-29T10:00:00Z");

  const lastOfWeek = commit(repository, "late on sunday", { a: "3" }, "2026-10-04T22:00:00Z");

  commit(repository, "monday morning", { a: "4" }, "2026-10-05T00:01:00Z");

  return { repository, shas: { lastOfWeek } };
}
