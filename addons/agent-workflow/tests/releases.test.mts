import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkRendering, definitionMap, parseWeeks, planReleases, type RemoteState, renderReleaseBody } from "../files/tools/agent-workflow/lib/releases.mts";
import type { Ran, Run } from "../files/tools/agent-workflow/lib/system.mts";
import { syncReleases } from "../files/tools/agent-workflow/sync-releases.mts";
import { createFolder } from "./support.mts";

const W41_TITLE = "2026-W41 — 5 Oct – 11 Oct";
const W40_TITLE = "2026-W40 — 28 Sep – 4 Oct";
const REPO_URL = "https://github.com/o/r";

describe("sync-releases --body", () => {
  it("rewrites the section's links into ones a release body can resolve", () => {
    const body = renderBody("2026-W41");

    expect(body).not.toContain("## 2026-W41");
    expect(body).toContain("- **Hot swap.** It works. #964 #967");
    expect(body).toContain("([`abc123456`](https://github.com/o/r/commit/abc123456ffff))");
    expect(body).toContain("](https://github.com/o/r/blob/main/docs/x.md)");
    expect(body).toContain("](https://github.com/o/r/blob/main/CHANGELOG.md#changelog)");
    expect(body).toContain("[the site](https://example.com/)");
  });

  it("ends with a link back to the week's CHANGELOG.md anchor", () => {
    expect(renderBody("2026-W41")).toContain("[2026-W41 entry](https://github.com/o/r/blob/main/CHANGELOG.md#2026-w41--5-oct--11-oct)");
  });

  it("links relative paths at the default branch it is given", () => {
    const body = renderBody("2026-W41", ["--branch", "trunk"]);

    expect(body).toContain("](https://github.com/o/r/blob/trunk/docs/x.md)");
    expect(body).toContain("](https://github.com/o/r/blob/trunk/CHANGELOG.md#2026-w41--5-oct--11-oct)");
    expect(body).not.toContain("blob/main");
  });

  it("takes an empty --branch as none, and asks gh for the default branch: a scheduled run has none in its event", () => {
    const { status, lines, calls } = withGh(["--repo", "o/r", "--branch", "", "--body", "2026-W41"], "trunk\n");

    expect(status).toBe(0);
    expect(calls).toEqual([["api", "repos/o/r", "--jq", ".default_branch"]]);
    expect(lines.join("\n")).toContain("](https://github.com/o/r/blob/trunk/docs/x.md)");
    expect(lines.join("\n")).toContain("(https://github.com/o/r/blob/trunk/CHANGELOG.md#2026-w41--5-oct--11-oct)");
    expect(lines.join("\n")).not.toContain("blob//");
  });

  it("asks gh for the default branch when --branch is not given, and does not assume main", () => {
    const { status, lines, calls } = withGh(["--repo", "o/r", "--body", "2026-W41"], "develop\n");

    expect(status).toBe(0);
    expect(calls).toEqual([["api", "repos/o/r", "--jq", ".default_branch"]]);
    expect(lines.join("\n")).toContain("/blob/develop/docs/x.md)");
    expect(lines.join("\n")).not.toContain("blob/main");
  });

  it("does not ask gh when --branch is given", () => {
    expect(withGh(["--repo", "o/r", "--branch", "trunk", "--body", "2026-W41"], "develop\n").calls).toEqual([]);
  });

  it("says nothing was judged when gh cannot name the default branch", () => {
    for (const [stdout, status] of [["", 1], ["\n", 0]] as const) {
      const result = withGh(["--repo", "o/r", "--body", "2026-W41"], stdout, status);

      expect(result.status).toBe(2);
      expect(result.lines).toEqual([`SKIP sync-releases: gh could not name the default branch of o/r (exit ${status}). Pass --branch. Nothing was judged`]);
    }
  });

  it("fails on a cited commit with no definition, naming the week and the commit", () => {
    const root = createFolder({ "CHANGELOG.md": "# Changelog\n\n## 2026-W41 — 5 Oct – 11 Oct\n\n- x ([`deadbeef1`])\n" });
    const { status, lines } = sync(root, ["--repo", "o/r", "--branch", "main", "--body", "2026-W41"]);

    expect(status).toBe(1);
    expect(lines[0]).toContain("FAIL sync-releases: 2026-W41: commit [`deadbeef1`] has no definition");
  });

  it("does not take a pull request's definition for a commit's", () => {
    const week = { tag: "2026-W41", title: W41_TITLE, section: "- x [`abc1234`]" };

    expect(() => renderReleaseBody(week, new Map([["#1", "u"]]), REPO_URL, "main")).toThrow("commit [`abc1234`] has no definition");
  });

  it("leaves a link that already has a target, a definition head or a second bracket after it alone", () => {
    const week = { tag: "2026-W41", title: W41_TITLE, section: "[#1](https://x.test/1) and [#2]: and [#3][ref]" };

    expect(renderReleaseBody(week, new Map(), REPO_URL, "main")).toContain("[#1](https://x.test/1) and [#2]: and [#3][ref]");
  });

  it("leaves an absolute link and a protocol-relative one as they are, and strips a leading ./", () => {
    const week = { tag: "2026-W41", title: W41_TITLE, section: "[a](mailto:x@y.test) [b](//cdn.test/x) [c](./docs/y.md)" };
    const body = renderReleaseBody(week, new Map(), REPO_URL, "main");

    expect(body).toContain("[a](mailto:x@y.test) [b](//cdn.test/x) [c](https://github.com/o/r/blob/main/docs/y.md)");
  });

  it("says nothing was judged for a week that has no section", () => {
    const { status, lines } = sync(project(), ["--repo", "o/r", "--branch", "main", "--body", "2026-W99"]);

    expect(status).toBe(2);
    expect(lines).toEqual(["SKIP sync-releases: there is no 2026-W99 section in CHANGELOG.md. Nothing was judged"]);
  });
});

describe("reading the weeks", () => {
  it("takes each heading, its tag, and the text under it without the definitions at the end", () => {
    const weeks = parseWeeks(changelogText());

    expect(weeks.map(({ tag, title }) => ({ tag, title }))).toEqual([
      { tag: "2026-W41", title: W41_TITLE },
      { tag: "2026-W40", title: W40_TITLE },
    ]);
    expect(weeks[1]?.section).toBe("- Earlier. [#900]");
  });

  it("strips every line that defines a link from the notes, a trailing space or a tab included, whatever the label", () => {
    const text = "# C\n\n## 2026-W41 — x\n\n- a [#1] [the doc]\n\n[#1]: u/1 \n[the doc]:\tu/2\t\n[`abc1234`]:   u/3\n";

    expect(parseWeeks(text)[0]?.section).toBe("- a [#1] [the doc]");
    expect(definitionMap(text).get("#1")).toBe("u/1");
  });

  it("reads a heading that is the week's name alone", () => {
    const weeks = parseWeeks("# C\n\n## 2026-W41\n\n- a\n\n## 2026-W40\n\n- b\n");

    expect(weeks).toEqual([
      { tag: "2026-W41", title: "2026-W41", section: "- a" },
      { tag: "2026-W40", title: "2026-W40", section: "- b" },
    ]);
  });

  it("reads a pull request's and a commit's definition by the label the section cites", () => {
    expect(definitionMap(changelogText()).get("#964")).toBe("https://github.com/o/r/pull/964");
    expect(definitionMap(changelogText()).get("`abc123456`")).toBe("https://github.com/o/r/commit/abc123456ffff");
  });
});

describe("sync-releases plan", () => {
  it("creates a missing release, oldest first, and marks only the newest Latest", () => {
    const { lines } = plan({ tags: ["2026-W40", "2026-W41"], releases: [], latestTag: null });

    expect(lines).toEqual(["create 2026-W40", "create 2026-W41 (latest)", "sync-releases: 2 to write, 0 unchanged"]);
  });

  it("leaves a release alone when its name and body already match", () => {
    const { lines } = plan({ tags: ["2026-W40", "2026-W41"], releases: both(), latestTag: "2026-W41" });

    expect(lines).toEqual(["sync-releases: 0 to write, 2 unchanged"]);
  });

  it("updates a release whose section changed", () => {
    const releases = both().map((release) => (release.tag === "2026-W40" ? { ...release, body: "stale notes" } : release));
    const { lines } = plan({ tags: ["2026-W40", "2026-W41"], releases, latestTag: "2026-W41" });

    expect(lines).toEqual(["update 2026-W40", "sync-releases: 1 to write, 1 unchanged"]);
  });

  it("updates a release whose name changed, and ignores trailing whitespace in its body", () => {
    const releases = both().map((release) => (release.tag === "2026-W40" ? { ...release, name: "old name" } : { ...release, body: `${release.body}\n\n` }));
    const { lines } = plan({ tags: ["2026-W40", "2026-W41"], releases, latestTag: "2026-W41" });

    expect(lines).toEqual(["update 2026-W40", "sync-releases: 1 to write, 1 unchanged"]);
  });

  it("moves Latest to the newest week when another release holds it", () => {
    const { lines } = plan({ tags: ["2026-W40", "2026-W41"], releases: both(), latestTag: "2026-W40" });

    expect(lines).toEqual(["update 2026-W41 (latest)", "sync-releases: 1 to write, 1 unchanged"]);
  });

  it("writes just one week with --only, still judging Latest across all", () => {
    const { lines } = plan({ tags: ["2026-W40", "2026-W41"], releases: [], latestTag: null }, ["--only", "2026-W40"]);

    expect(lines).toEqual(["create 2026-W40", "sync-releases: 1 to write, 0 unchanged"]);
  });

  it("fails with --only for a week that has no tag or no section, and writes nothing", () => {
    for (const week of ["2026-W41", "2026-W39"]) {
      const { status, lines, calls } = plan({ tags: ["2026-W40"], releases: [], latestTag: null }, ["--only", week, "--apply"]);

      expect(status).toBe(1);
      expect(lines).toEqual([`FAIL sync-releases: no tagged week ${week} in CHANGELOG.md`]);
      expect(calls).toEqual([]);
    }
  });

  it("does not fail with --only for a tagged week that has nothing to write", () => {
    const { status, lines } = plan({ tags: ["2026-W40", "2026-W41"], releases: both(), latestTag: "2026-W41" }, ["--only", "2026-W40"]);

    expect(status).toBe(0);
    expect(lines).toEqual(["sync-releases: 0 to write, 2 unchanged"]);
  });

  it("never releases a week whose tag does not exist yet", () => {
    const { lines } = plan({ tags: ["2026-W40"], releases: [], latestTag: null });

    expect(lines).toEqual(["create 2026-W40 (latest)", "sync-releases: 1 to write, 0 unchanged, waiting for a tag: 2026-W41"]);
  });

  it("plans the same whatever order the file lists the weeks in", () => {
    const weeks = parseWeeks(changelogText());
    const state: RemoteState = { tags: ["2026-W40", "2026-W41"], releases: [], latestTag: null };

    expect(planReleases(weeks, state, () => "x").changes.map(({ tag }) => tag)).toEqual(["2026-W40", "2026-W41"]);
    expect(planReleases([...weeks].reverse(), state, () => "x").changes.map(({ tag }) => tag)).toEqual(["2026-W40", "2026-W41"]);
  });

  it("writes nothing to GitHub without --apply", () => {
    const { calls } = plan({ tags: ["2026-W40"], releases: [], latestTag: null });

    expect(calls).toEqual([]);
  });

  it("names the repository with gh when --repo is not given", () => {
    const { status, calls, lines } = plan({ tags: ["2026-W40"], releases: [], latestTag: null }, [], { dropRepo: true, named: "acme/app" });

    expect(status).toBe(0);
    expect(calls).toEqual([["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]]);
    expect(lines[0]).toBe("create 2026-W40 (latest)");
  });

  it("says nothing was judged when gh cannot name the repository", () => {
    const { status, lines } = plan({ tags: [], releases: [], latestTag: null }, [], { dropRepo: true, named: "" });

    expect(status).toBe(2);
    expect(lines[0]).toContain("SKIP sync-releases: gh could not name the repository");
    expect(lines[0]).toContain("Nothing was judged");
  });
});

describe("sync-releases --apply", () => {
  it("creates and updates through the API, oldest first, with Latest only on the newest", () => {
    const releases = [{ id: 7, tag: "2026-W40", name: W40_TITLE, body: "stale" }];
    const { status, lines, calls } = plan({ tags: ["2026-W40", "2026-W41"], releases, latestTag: "2026-W40" }, ["--apply"]);

    expect(status).toBe(0);
    expect(lines.slice(-2)).toEqual(["updated 2026-W40", "created 2026-W41"]);
    expect(calls.map((call) => call.slice(0, 4))).toEqual([
      ["api", "-X", "PATCH", "repos/o/r/releases/7"],
      ["api", "-X", "POST", "repos/o/r/releases"],
    ]);
    expect(calls[0]).toContain("make_latest=false");
    expect(calls[1]).toContain("make_latest=true");
    expect(calls[1]).toContain("tag_name=2026-W41");
    expect(calls[1]).toContain(`name=${W41_TITLE}`);
    expect(calls[1]).toContain(`body=${renderBody("2026-W41")}`);
  });

  it("stops at the first release GitHub refuses, and fails", () => {
    const { status, lines, calls } = plan({ tags: ["2026-W40", "2026-W41"], releases: [], latestTag: null }, ["--apply"], { refuse: "tag_name=2026-W40" });

    expect(status).toBe(1);
    expect(lines.at(-1)).toBe("FAIL sync-releases: GitHub did not create the release of 2026-W40 (HTTP 422)");
    expect(calls).toHaveLength(1);
  });

  it("says nothing was judged when GitHub cannot be asked what exists", () => {
    const { status, lines } = plan({ tags: [], releases: [], latestTag: null }, [], { noState: true });

    expect(status).toBe(2);
    expect(lines[0]).toContain("SKIP sync-releases: gh could not read repos/o/r/tags");
  });
});

describe("sync-releases --check", () => {
  it("checks every week renders, offline", () => {
    const calls: string[][] = [];
    const { status, lines } = sync(project(), ["--check"], (_, args) => {
      calls.push(args);

      return gone();
    });

    expect(status).toBe(0);
    expect(lines).toEqual(["PASS sync-releases: 2 week(s) render as release notes"]);
    expect(calls).toEqual([]);
  });

  it("fails naming the week and the commit that has no definition", () => {
    const text = changelogText().replace("- Earlier. [#900]", "- Earlier ([`deadbeef1`]). [#900]");
    const { status, lines } = sync(createFolder({ "CHANGELOG.md": text }), ["--check"]);

    expect(status).toBe(1);
    expect(lines).toEqual(["  2026-W40: commit [`deadbeef1`] has no definition", "FAIL sync-releases: 1 week(s) do not render. Fix CHANGELOG.md and run this again"]);
  });

  it("names every week that fails, not only the first", () => {
    const text = changelogText().replace("- Earlier. [#900]", "- a [`deadbeef1`]").replace("It works.", "It [`cafebabe1`] works.");
    const { status, lines } = sync(createFolder({ "CHANGELOG.md": text }), ["--check"]);

    expect(status).toBe(1);
    expect(lines.slice(0, 2)).toEqual(["  2026-W41: commit [`cafebabe1`] has no definition", "  2026-W40: commit [`deadbeef1`] has no definition"]);
  });

  it("skips the check on a file with no week", () => {
    const { status, lines } = sync(createFolder({ "CHANGELOG.md": "# Changelog\n\nNothing yet.\n" }), ["--check"]);

    expect(status).toBe(0);
    expect(lines).toEqual(["SKIP sync-releases: CHANGELOG.md has no week yet, so there is no release to render"]);
  });

  it("says nothing was judged with no CHANGELOG.md", () => {
    const { status, lines } = sync(createFolder(), ["--check"]);

    expect(status).toBe(2);
    expect(lines).toEqual(["SKIP sync-releases: there is no CHANGELOG.md at the project root. Nothing was judged"]);
  });

  it("returns the problems of checkRendering one line per week", () => {
    expect(checkRendering(changelogText(), REPO_URL, "main")).toEqual([]);
    expect(checkRendering("# Changelog\n\n## 2026-W41 — x\n\n[`abc1234`]\n", REPO_URL, "main")).toEqual(["2026-W41: commit [`abc1234`] has no definition"]);
  });

  it("says nothing was judged for a flag it does not know", () => {
    const { status, lines } = sync(project(), ["--nope"]);

    expect(status).toBe(2);
    expect(lines[0]).toContain("SKIP sync-releases:");
    expect(lines[0]).toContain("usage: sync-releases.mts");
  });
});

function renderBody(week: string, extra: string[] = []): string {
  const { status, lines } = sync(project(), ["--repo", "o/r", ...(extra.length === 0 ? ["--branch", "main"] : extra), "--body", week]);

  expect(status).toBe(0);

  return lines.join("\n").trimEnd();
}

function both(): { id: number; tag: string; name: string; body: string }[] {
  return [
    { id: 1, tag: "2026-W40", name: W40_TITLE, body: renderBody("2026-W40") },
    { id: 2, tag: "2026-W41", name: W41_TITLE, body: renderBody("2026-W41") },
  ];
}

interface World {
  dropRepo?: boolean;
  named?: string;
  /** A fragment of a gh call that GitHub refuses. */
  refuse?: string;
  noState?: boolean;
}

/** Plans (or applies) against a state read from a file, with gh replaced. */
function plan(state: object, extra: string[] = [], world: World = {}): { status: number; lines: string[]; calls: string[][] } {
  const root = project();
  writeFileSync(join(root, "state.json"), JSON.stringify(state));
  const calls: string[][] = [];
  const gh: Run = (_, args) => {
    calls.push(args);

    if (args[0] === "repo") {
      return { status: world.named === "" ? 1 : 0, stdout: `${world.named ?? ""}\n`, stderr: "" };
    }

    if (world.noState && args[1] === "--paginate") {
      return { status: 1, stdout: "", stderr: "HTTP 403" };
    }

    return world.refuse !== undefined && args.some((arg) => arg.includes(world.refuse as string)) ? { status: 1, stdout: "", stderr: "HTTP 422" } : { status: 0, stdout: "[[]]", stderr: "" };
  };
  const given = world.noState ? [] : ["--state", "state.json"];
  const repo = world.dropRepo ? [] : ["--repo", "o/r"];
  const branch = world.dropRepo ? [] : ["--branch", "main"];
  const lines: string[] = [];
  const status = syncReleases({ root, argv: [...repo, ...branch, ...given, ...extra], run: gh, report: (line) => lines.push(line) });

  return { status, lines, calls: calls.filter((call) => call[0] === "api" && call[1] === "-X" || call[0] === "repo") };
}

function withGh(argv: string[], stdout: string, status = 0): { status: number; lines: string[]; calls: string[][] } {
  const calls: string[][] = [];
  const result = sync(project(), argv, (_, args) => {
    calls.push(args);

    return { status, stdout, stderr: "" };
  });

  return { ...result, calls };
}

function sync(root: string, argv: string[], run: Run = () => gone()): { status: number; lines: string[] } {
  const lines: string[] = [];

  return { status: syncReleases({ root, argv, run, report: (line) => lines.push(line) }), lines };
}

function gone(): Ran {
  return { status: 127, stdout: "", stderr: "gh is not installed" };
}

function project(): string {
  return createFolder({ "CHANGELOG.md": changelogText() });
}

function changelogText(): string {
  return [
    "# Changelog",
    "",
    "Intro.",
    "",
    `## ${W41_TITLE}`,
    "",
    "A week.",
    "",
    "- **Hot swap.** It works. [#964] [#967]",
    "- A fix ([`abc123456`]), see [the doc](docs/x.md), [the intro](#changelog)",
    "  and [the site](https://example.com/).",
    "",
    `## ${W40_TITLE}`,
    "",
    "- Earlier. [#900]",
    "",
    "[#900]: https://github.com/o/r/pull/900",
    "[#964]: https://github.com/o/r/pull/964",
    "[#967]: https://github.com/o/r/pull/967",
    "",
    "[`abc123456`]: https://github.com/o/r/commit/abc123456ffff",
    "",
  ].join("\n");
}
