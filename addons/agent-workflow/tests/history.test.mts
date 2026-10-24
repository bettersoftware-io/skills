import { describe, expect, it } from "vitest";

import { HistoryError, parseHistory, readHistory, remoteBranch, repositoryUrl } from "../files/tools/agent-workflow/lib/history.mts";
import { run } from "../files/tools/agent-workflow/lib/system.mts";
import { commit, createFolder, createRemote, git, mergeAt } from "./support.mts";

function repository(): string {
  const folder = createFolder();

  git(folder, "init", "--quiet", "--initial-branch=main");
  commit(folder, "first", { a: "0" }, "2026-10-01T09:00:00Z");

  return folder;
}

/** Merges a side branch holding one commit called `side`, as a merge commit called `subject`. */
function mergeSide(folder: string, branch: string, subject: string, date: string, side = `work on ${branch}`): void {
  git(folder, "checkout", "--quiet", "-b", branch);
  commit(folder, side, { [branch]: "1" }, date);
  git(folder, "checkout", "--quiet", "main");
  mergeAt(folder, branch, subject, date);
}

describe("reading the pull requests merged into a branch", () => {
  it("reads GitHub's merge subject, a squash's trailing number and RTC's Merge PR subject", () => {
    const folder = repository();

    mergeSide(folder, "one", "Merge pull request #12 from acme/one", "2026-10-02T10:00:00Z");
    commit(folder, "Add two (#13)", { two: "1" }, "2026-10-03T10:00:00Z");
    mergeSide(folder, "three", "Merge PR #14: Add three", "2026-10-04T10:00:00Z");

    expect(readHistory(folder, "main", run)).toEqual([
      { number: 12, mergedAt: "2026-10-02T10:00:00.000Z" },
      { number: 13, mergedAt: "2026-10-03T10:00:00.000Z" },
      { number: 14, mergedAt: "2026-10-04T10:00:00.000Z" },
    ]);
  });

  it("takes the last number of a revert of a squash", () => {
    expect(parseHistory('abc\t2026-10-02T10:00:00Z\tRevert "Add x (#12)" (#15)')).toEqual([{ number: 15, mergedAt: "2026-10-02T10:00:00.000Z" }]);
  });

  it("follows the first parent only", () => {
    const folder = repository();

    mergeSide(folder, "side", "Merge pull request #5 from acme/side", "2026-10-02T10:00:00Z", "inner work (#99)");

    expect(readHistory(folder, "main", run).map((merge) => merge.number)).toEqual([5]);
  });

  it("drops a subject that names no pull request", () => {
    expect(parseHistory("abc\t2026-10-02T10:00:00Z\tfix a typo\ndef\t2026-10-03T10:00:00Z\tAdd y (#7)")).toEqual([
      { number: 7, mergedAt: "2026-10-03T10:00:00.000Z" },
    ]);
  });

  it("turns a committer offset into UTC and lists the oldest first", () => {
    expect(parseHistory("b\t2026-10-03T01:00:00+02:00\tB (#2)\na\t2026-10-02T10:00:00Z\tA (#1)").map((merge) => merge.mergedAt)).toEqual([
      "2026-10-02T10:00:00.000Z",
      "2026-10-02T23:00:00.000Z",
    ]);
  });

  it("throws HistoryError for a date that is not one", () => {
    expect(() => parseHistory("abc\tyesterday\tAdd x (#1)")).toThrow(HistoryError);
  });

  it("throws HistoryError when git cannot read the ref", () => {
    expect(() => readHistory(repository(), "nowhere", run)).toThrow(HistoryError);
  });
});

describe("finding the remote's default branch", () => {
  it("finds origin/HEAD, else origin/main, else nothing", () => {
    const { clone } = createRemote();

    expect(remoteBranch(clone, run)).toBe("origin/main");

    git(clone, "remote", "set-head", "origin", "main");
    expect(remoteBranch(clone, run)).toBe("origin/HEAD");

    git(clone, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
    expect(remoteBranch(clone, run)).toBe("origin/main");

    git(clone, "update-ref", "-d", "refs/remotes/origin/main");

    expect(remoteBranch(clone, run)).toBeUndefined();
  });
});

describe("the repository's address", () => {
  it("turns each way of writing a GitHub origin into its https address", () => {
    const folder = repository();

    expect(repositoryUrl(folder, run)).toBeUndefined();

    git(folder, "remote", "add", "origin", "git@github.com:acme/app.git");

    const urls = [
      "git@github.com:acme/app.git",
      "git@github.com:acme/app",
      "https://github.com/acme/app.git",
      "https://github.com/acme/app",
      "ssh://git@github.com/acme/app.git",
      "ssh://git@github.com/acme/app",
    ];

    for (const url of urls) {
      git(folder, "remote", "set-url", "origin", url);
      expect(repositoryUrl(folder, run), url).toBe("https://github.com/acme/app");
    }

    for (const url of ["https://gitlab.com/o/n", "git@gitlab.com:o/n.git", "ssh://git@gitlab.com/o/n.git"]) {
      git(folder, "remote", "set-url", "origin", url);
      expect(repositoryUrl(folder, run), url).toBeUndefined();
    }
  });
});
