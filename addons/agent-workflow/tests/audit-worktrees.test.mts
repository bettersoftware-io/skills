import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { shellWord, shown } from "../files/tools/agent-workflow/lib/shown.mts";
import { type Run, run } from "../files/tools/agent-workflow/lib/system.mts";
import { auditWorktrees, parseWorktrees } from "../files/tools/agent-workflow/lib/worktree-audit.mts";
import { commit, createFolder, createRemote, git, type Remote, TOOLS, writeFile } from "./support.mts";

/** A character a terminal acts on or turns the text round with: none may reach a line of the report as it is. */
const RAW = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const DAY = 86_400_000;

describe("a project with no linked worktree", () => {
  it("says there is none, names nothing to remove, and exits 0", () => {
    const remote = createRemote();
    const { status, lines, text } = audit(remote.clone);

    expect(status).toBe(0);
    expect(lines[0]).toBe(`worktree:audit of ${remote.clone}`);
    expect(lines).toContain("no linked worktree: this project has only its own checkout");
    expect(lines).toContain("orphan branches: none");
    expect(lines).toContain(`stray folders: none (there is no ${worktreesOf(remote)})`);
    expect(lines).toContain("count: 0 worktrees | MERGED 0 | MERGED, NOT CLEAN 0 | UNMERGED 0 | NOT JUDGED 0 | orphan branches 0 | stray folders 0");
    expect(text).not.toContain("remove:");
    expect(text).not.toContain("next:");
    expect(lines.at(-1)).toMatch(/^OK worktree:audit: everything was read, and judged against origin\/main as fetched just now/);
  });
});

describe("a worktree's verdict", () => {
  it("is MERGED when its branch reached main by a merge commit and its tree is clean, with the two commands that remove it", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "done");

    commit(path, "the work", { "work.txt": "1\n" });
    mergeOnOrigin(remote, path, "worktree-done");

    const result = audit(remote.clone);

    expect(result.status).toBe(0);
    expect(blockOf(result, "done")).toEqual([
      "MERGED  done",
      `  path:    ${path}`,
      "  branch:  worktree-done",
      `  tip:     ${git(path, "log", "-1", "--format=%h %cs")} the work`,
      "  tree:    clean: no file is changed or untracked. Files git ignores are not looked at",
      `  remove:  git worktree remove ${path}`,
      "           git branch -D worktree-done",
    ]);
  });

  it("is MERGED, NOT CLEAN when its commit is on main and the tree holds a changed and an untracked file, and prints no command", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "half");

    writeFile(path, "package.json", "{}\n");
    writeFile(path, "notes.txt", "to do\n");

    const result = audit(remote.clone);
    const block = blockOf(result, "half");

    expect(result.status).toBe(0);
    expect(block[0]).toBe("MERGED, NOT CLEAN  half");
    expect(block).toContain("  tree:    2 paths not committed: package.json (changed), notes.txt (untracked)");
    expect(block.at(-1)).toBe("  Not safe to remove without a look: removing the worktree deletes these files. No command is printed for it");
    expect(result.text).not.toContain("remove:");
    expect(result.lines).toContain("next: MERGED, NOT CLEAN: read the files it names, and commit or discard them with their owner, before it is removed");
  });

  it("names the first five paths that are not committed, and counts the rest", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "many");

    for (const name of ["a", "b", "c", "d", "e", "f", "g"]) {
      writeFile(path, `${name}.txt`, "");
    }

    expect(blockOf(audit(remote.clone), "many")).toContain(
      "  tree:    7 paths not committed: a.txt (untracked), b.txt (untracked), c.txt (untracked), d.txt (untracked), e.txt (untracked), and 2 more",
    );
  });

  it("counts a file that was renamed once, under its new name", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "moved");

    git(path, "mv", "package.json", "manifest.json");

    expect(blockOf(audit(remote.clone), "moved")).toContain("  tree:    1 path not committed: manifest.json (changed)");
  });

  it("is UNMERGED when it has commits main does not have: how many, their subjects, how old the newest is, and no command", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "wip");
    const older = commit(path, "start the filter", { "filter.txt": "1\n" }, "2026-10-01T09:00:00Z");
    const newer = commit(path, "half of the filter", { "filter.txt": "2\n" }, "2026-10-02T12:00:00Z");
    const result = audit(remote.clone, [], { now: new Date("2026-10-05T13:00:00Z") });
    const block = blockOf(result, "wip");

    expect(result.status).toBe(0);
    expect(block[0]).toBe("UNMERGED  wip");
    expect(block.slice(4)).toEqual([
      "  commits: 2 not on origin/main, the newest 3 days ago",
      `           ${newer.slice(0, 7)} half of the filter`,
      `           ${older.slice(0, 7)} start the filter`,
      "  tree:    clean: no file is changed or untracked. Files git ignores are not looked at",
      "  Live work. No removal command is printed for it",
    ]);
    expect(result.text).not.toContain("remove:");
    expect(result.text).not.toContain("git worktree remove");
    expect(result.text).not.toContain("git branch -D");
    expect(result.lines).toContain("next: UNMERGED: work someone stopped in. Finish it through a pull request, or ask its owner; the branch is whole and can be picked up");
  });

  it.each([
    [30, "under a minute ago"],
    [60, "1 minute ago"],
    [59 * 60, "59 minutes ago"],
    [60 * 60, "1 hour ago"],
    [23 * 60 * 60, "23 hours ago"],
    [24 * 60 * 60, "1 day ago"],
    [48 * 60 * 60, "2 days ago"],
  ])("gives the age of a commit made %d seconds before as %j", (seconds, age) => {
    const remote = createRemote();
    const path = addWorktree(remote, "wip");

    commit(path, "work", { "work.txt": "1\n" }, "2026-10-02T12:00:00Z");

    const result = audit(remote.clone, [], { now: new Date(Date.parse("2026-10-02T12:00:00Z") + seconds * 1000) });

    expect(blockOf(result, "wip")).toContain(`  commits: 1 not on origin/main, the newest ${age}`);
  });

  it("names the first five commits main does not have, newest first, and counts the rest", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "long");

    for (const step of [1, 2, 3, 4, 5, 6, 7]) {
      commit(path, `step ${step}`, { "work.txt": `${step}\n` }, `2026-10-0${step}T09:00:00Z`);
    }

    const block = blockOf(audit(remote.clone), "long");
    const subjects = block.filter((line) => /^ {11}\S/.test(line)).map((line) => line.trim().replace(/^[0-9a-f]+ /, ""));

    expect(block.find((line) => line.startsWith("  commits:"))).toMatch(/^ {2}commits: 7 not on origin\/main, /);
    expect(subjects).toEqual(["step 7", "step 6", "step 5", "step 4", "step 3", "and 2 more"]);
  });

  it("says so when an unmerged worktree's tree is not clean as well", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "wip");

    commit(path, "started", { "work.txt": "1\n" });
    writeFile(path, "scratch.txt", "");

    const block = blockOf(audit(remote.clone), "wip");

    expect(block[0]).toBe("UNMERGED  wip");
    expect(block).toContain("  tree:    1 path not committed: scratch.txt (untracked)");
    expect(block.at(-1)).toBe("  Live work. No removal command is printed for it");
  });

  it("reads a branch whose changes reached main by a squash as UNMERGED, and says once why", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "flat");

    commit(path, "the work", { "work.txt": "1\n" });
    mergeOnOrigin(remote, path, "worktree-flat", "squash");

    const result = audit(remote.clone);

    // The change is on main: the same file, the same content. The commit is not.
    expect(git(remote.clone, "show", "origin/main:work.txt")).toBe("1");
    expect(blockOf(result, "flat")[0]).toBe("UNMERGED  flat");
    expect(result.lines.filter((line) => line.includes("squash"))).toEqual([
      "note: a worktree is MERGED when the commit it stands on is on origin/main. A branch that reached main by a squash or a rebase reads as UNMERGED: main then holds other commits than the branch's. The rule here is a merge commit (gh pr merge --merge)",
    ]);
  });

  it("notes a merged worktree that never had a commit of its own, which one just made is, and not one whose work was merged", () => {
    const remote = createRemote();
    const merged = addWorktree(remote, "done");

    commit(merged, "the work", { "work.txt": "1\n" });
    mergeOnOrigin(remote, merged, "worktree-done");
    addWorktree(remote, "new");

    const result = audit(remote.clone);
    const note = "  note:    its commit is one main itself once stood at, so it may hold no work of its own. A worktree just made looks like this: a session may be about to work in it";

    expect(blockOf(result, "new")[0]).toBe("MERGED  new");
    expect(blockOf(result, "new")).toContain(note);
    expect(blockOf(result, "done")).not.toContain(note);
  });

  it("says a worktree is detached, and prints no command for a branch it does not have", () => {
    const remote = createRemote();
    const path = join(worktreesOf(remote), "look");

    git(remote.clone, "worktree", "add", "--quiet", "--detach", path, "origin/main");

    const block = blockOf(audit(remote.clone), "look");

    expect(block[0]).toBe("MERGED  look");
    expect(block).toContain("  branch:  none: it is detached, so the verdict is about the commit it stands on");
    expect(block.at(-1)).toBe(`  remove:  git worktree remove ${path}`);
    expect(block.join("\n")).not.toContain("git branch");
  });

  it("says a worktree is locked, with the reason when one was given, and prints no command git would refuse", () => {
    const remote = createRemote();
    const kept = addWorktree(remote, "kept");
    const held = addWorktree(remote, "held");

    git(remote.clone, "worktree", "lock", "--reason", "kept for the demo", kept);
    git(remote.clone, "worktree", "lock", held);

    const result = audit(remote.clone);

    expect(blockOf(result, "kept")[0]).toBe("MERGED  kept");
    expect(blockOf(result, "kept")).toContain("  locked:  kept for the demo");
    expect(blockOf(result, "held")).toContain("  locked:  no reason was given");
    expect(blockOf(result, "kept").at(-1)).toBe("  It is locked, so git refuses to remove it, and no command is printed. Unlocking is for whoever locked it");
    expect(result.text).not.toContain("remove:");
  });

  it("says a worktree is prunable when its folder is gone, and still judges the commit it stood on", () => {
    const remote = createRemote();
    const lost = addWorktree(remote, "lost");
    const empty = addWorktree(remote, "empty");

    commit(lost, "never pushed", { "work.txt": "1\n" });
    rmSync(lost, { recursive: true });
    rmSync(empty, { recursive: true });

    const result = audit(remote.clone);

    expect(result.status).toBe(0);
    expect(blockOf(result, "lost")[0]).toBe("UNMERGED  lost");
    expect(blockOf(result, "lost")).toContain("  prunable: gitdir file points to non-existent location");
    expect(blockOf(result, "lost")).toContain("  tree:    its folder is gone");
    expect(blockOf(result, "lost").at(-1)).toBe("  Live work, and its folder is gone: the commits are still in the repository. No removal command is printed for it");
    expect(blockOf(result, "empty")[0]).toBe("MERGED  empty");
    expect(blockOf(result, "empty").slice(-2)).toEqual([`  remove:  git worktree remove ${empty}`, "           git branch -D worktree-empty"]);
  });

  it("is NOT JUDGED, and the run exits 2, when git cannot say whether its commit is on main", () => {
    const remote = createRemote();

    addWorktree(remote, "odd");
    git(remote.clone, "branch", "worktree-left", "origin/main");

    const result = audit(remote.clone, [], { run: failing("merge-base", 128) });

    expect(result.status).toBe(2);
    expect(blockOf(result, "odd")[0]).toBe("NOT JUDGED  odd");
    expect(blockOf(result, "odd").at(-1)).toMatch(/^ {2}git could not say whether its commit \([0-9a-f]{40}\) is on origin\/main\. No command is printed for it$/);
    expect(result.lines).toContain("  NOT JUDGED  worktree-left");
    expect(result.text).not.toContain("remove:");
    expect(result.lines.at(-1)).toBe(
      "SKIP worktree:audit: 1 worktree could not be judged; 1 orphan branch could not be judged. This report is not whole, and is not to be read as one. Nothing was removed",
    );
  });

  it("is NOT JUDGED when its commit is on main and its tree cannot be read, and still UNMERGED when it is not on main", () => {
    const remote = createRemote();
    const wip = addWorktree(remote, "wip");

    addWorktree(remote, "blind");
    commit(wip, "started", { "work.txt": "1\n" });

    const result = audit(remote.clone, [], { run: failing("status", 128, "fatal: not a git repository") });

    expect(result.status).toBe(2);
    expect(blockOf(result, "blind")[0]).toBe("NOT JUDGED  blind");
    expect(blockOf(result, "blind").slice(-2)).toEqual([
      "  tree:    could not be read (fatal: not a git repository)",
      "  Its commit is on origin/main, but whether the tree is clean is not known. No command is printed for it",
    ]);
    expect(blockOf(result, "wip")[0]).toBe("UNMERGED  wip");
    expect(result.text).not.toContain("remove:");
    expect(result.lines.at(-1)).toMatch(/^SKIP worktree:audit: 1 worktree could not be judged\./);
  });

  it("says so, and exits 2, when git cannot list the commits main does not have, and gives the note where it cannot rule it out", () => {
    const remote = createRemote();
    const done = addWorktree(remote, "done");
    const wip = addWorktree(remote, "wip");

    commit(done, "the work", { "work.txt": "1\n" });
    mergeOnOrigin(remote, done, "worktree-done");

    const tip = commit(wip, "started", { "wip.txt": "1\n" });
    const result = audit(remote.clone, [], { run: failing("rev-list", 128, "fatal: broken") });

    expect(result.status).toBe(2);
    expect(blockOf(result, "wip")[0]).toBe("UNMERGED  wip");
    expect(blockOf(result, "wip")).toContain("  commits: not on origin/main; git could not list them (fatal: broken)");
    expect(blockOf(result, "done")[0]).toBe("MERGED  done");
    expect(blockOf(result, "done").filter((line) => line.startsWith("  note:"))).toHaveLength(1);
    expect(result.lines.at(-1)).toBe(
      `SKIP worktree:audit: the commits of ${tip.slice(0, 7)} that are not on origin/main could not be listed. This report is not whole, and is not to be read as one. Nothing was removed`,
    );
  });

  it("gives a commit by the start of its hash when git cannot describe it", () => {
    const remote = createRemote();
    const tip = git(remote.clone, "rev-parse", "origin/main");

    addWorktree(remote, "new");

    const result = audit(remote.clone, [], { run: failing("log", 128) });

    expect(result.lines[1]).toBe(`judged against origin/main at ${tip.slice(0, 9)}`);
    expect(blockOf(result, "new")).toContain(`  tip:     ${tip.slice(0, 9)}`);
    expect(blockOf(result, "new")[0]).toBe("MERGED  new");
  });

  it("hands git nothing as a commit that is not a full hash", () => {
    const remote = createRemote();
    const real = run("git", ["worktree", "list", "--porcelain", "-z"], remote.clone).stdout;
    const forged = `${real}worktree ${join(worktreesOf(remote), "odd")}\0HEAD --output=x\0detached\0\0`;
    const result = audit(remote.clone, [], { run: (program, args, where) => (args[0] === "worktree" ? { status: 0, stdout: forged, stderr: "" } : run(program, args, where)) });

    expect(result.status).toBe(2);
    expect(blockOf(result, "odd")[0]).toBe("NOT JUDGED  odd");
    expect(blockOf(result, "odd").at(-1)).toBe("  git could not say whether its commit (--output=x) is on origin/main. No command is printed for it");
    expect(result.asked.flat()).not.toContain("--output=x");
  });

  it("counts an untracked file though git is set to hide them", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "quiet");

    git(remote.clone, "config", "status.showUntrackedFiles", "no");
    writeFile(path, "unseen.txt", "");

    expect(git(path, "status", "--porcelain")).toBe("");
    expect(blockOf(audit(remote.clone), "quiet")[0]).toBe("MERGED, NOT CLEAN  quiet");
  });

  it("does not rewrite the index of a worktree it reads", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "busy");
    const index = git(path, "rev-parse", "--path-format=absolute", "--git-path", "index");

    // The file is as it was committed, with another time on it: a plain `git status` records the new time in the index.
    utimesSync(join(path, "package.json"), new Date("2001-01-01T00:00:00Z"), new Date("2001-01-01T00:00:00Z"));

    const before = readFileSync(index);

    expect(blockOf(audit(remote.clone), "busy")[0]).toBe("MERGED  busy");
    expect(readFileSync(index).equals(before)).toBe(true);
  });

  it("judges against the branch origin calls its default, not against one named main", () => {
    const remote = createRemote();
    const path = join(worktreesOf(remote), "next");

    git(remote.other, "checkout", "--quiet", "-b", "release");
    commit(remote.other, "on release", { "release.txt": "1\n" });
    git(remote.other, "push", "--quiet", "origin", "release");
    git(remote.clone, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/release");
    git(remote.clone, "fetch", "--quiet", "origin", "release");
    git(remote.clone, "worktree", "add", "--quiet", "--no-track", "-b", "worktree-next", path, "origin/release");

    const result = audit(remote.clone);

    expect(result.lines[1]).toMatch(/^judged against origin\/release at [0-9a-f]+ \d{4}-\d\d-\d\d on release$/);
    expect(blockOf(result, "next")[0]).toBe("MERGED  next");
  });

  it("judges the same from inside a linked worktree: the project is the first checkout git lists", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "inside");
    const result = audit(path);

    expect(result.status).toBe(0);
    expect(result.lines[0]).toBe(`worktree:audit of ${remote.clone}`);
    expect(blockOf(result, "inside")[0]).toBe("MERGED  inside");
    expect(result.lines).toContain("orphan branches: none");
    expect(result.lines).toContain("stray folders: none");
  });
});

describe("main as it is now", () => {
  it("fetches origin's main first: a worktree merged since the last fetch reads as MERGED", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "done");
    const stale = git(remote.clone, "rev-parse", "origin/main");

    commit(path, "the work", { "work.txt": "1\n" });
    mergeOnOrigin(remote, path, "worktree-done");

    // The clone has not heard of the merge.
    expect(git(remote.clone, "rev-parse", "origin/main")).toBe(stale);

    const result = audit(remote.clone);

    expect(blockOf(result, "done")[0]).toBe("MERGED  done");
    expect(result.lines[1]).toMatch(/^judged against origin\/main at [0-9a-f]+ \d{4}-\d\d-\d\d Merge worktree-done$/);
    expect(result.lines[2]).toBe("  fetched from origin just now");
    expect(git(remote.clone, "rev-parse", "origin/main")).toBe(git(remote.origin, "rev-parse", "main"));
  });

  it("names the branch to git after --end-of-options, so that git reads it as a branch whatever it is", () => {
    const remote = createRemote();

    expect(audit(remote.clone).asked).toContainEqual(["git", "fetch", "origin", "--end-of-options", "main"]);
  });

  it("still reports when the fetch fails, says first and last what it was judged against, and exits 2", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "done");

    commit(path, "the work", { "work.txt": "1\n" });
    mergeOnOrigin(remote, path, "worktree-done");
    git(remote.clone, "remote", "set-url", "origin", join(dirname(remote.clone), "gone.git"));

    const result = audit(remote.clone, [], { now: new Date(Date.now() + 3 * DAY + 60_000) });

    expect(result.status).toBe(2);
    expect(result.lines[2]).toMatch(/^SKIP fetch: could not fetch main from origin \(.*gone\.git.*\)$/);
    expect(result.lines[3]).toBe("  The verdicts below are against origin/main as this clone last had it, which last moved 3 days ago. Work merged since then reads as UNMERGED");
    // Merged on origin, and read as live work: this is why a failed fetch is not a clean run.
    expect(blockOf(result, "done")[0]).toBe("UNMERGED  done");
    expect(result.lines.at(-1)).toBe(
      "SKIP worktree:audit: main could not be fetched from origin, so every verdict is against origin/main as this clone last had it, which last moved 3 days ago. This report is not whole, and is not to be read as one. Nothing was removed",
    );
    expect(result.text).not.toContain("fetched from origin just now");
    expect(result.text).not.toContain("OK worktree:audit");
  });

  it("says git has no record of when, where the clone keeps no log of origin's main", () => {
    const remote = createRemote();

    rmSync(join(remote.clone, ".git/logs/refs/remotes/origin/main"));
    git(remote.clone, "remote", "set-url", "origin", join(dirname(remote.clone), "gone.git"));

    const result = audit(remote.clone);

    expect(result.status).toBe(2);
    expect(result.lines[3]).toBe(
      "  The verdicts below are against origin/main as this clone last had it, and git has no record of when that was. Work merged since then reads as UNMERGED",
    );
  });

  it("judges nothing in a clone that has no origin/main at all", () => {
    const project = join(createFolder(), "project");

    mkdirSync(project);
    git(project, "init", "--quiet", "--initial-branch=main");
    commit(project, "first", { "a.txt": "a\n" });
    git(project, "worktree", "add", "--quiet", "-b", "worktree-x", join(dirname(project), "project-worktrees", "x"));

    const result = audit(project);

    expect(result.status).toBe(2);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^SKIP worktree:audit: this clone has no origin\/main to judge against, and could not fetch main from origin \(.+\)\. Nothing was judged$/);
  });

  it("judges nothing when origin's recorded main branch is not a plain branch name", () => {
    const remote = createRemote();

    addWorktree(remote, "x");
    git(remote.clone, "update-ref", "refs/remotes/origin/-x", "HEAD");
    git(remote.clone, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/-x");

    const result = audit(remote.clone);

    expect(result.status).toBe(2);
    expect(result.lines).toEqual(['SKIP worktree:audit: origin\'s main branch is recorded as "-x", which is not a plain branch name. Nothing was judged']);
    expect(result.asked.map(([, command]) => command)).not.toContain("fetch");
  });

  it("judges nothing outside a git repository", () => {
    const folder = createFolder();
    const result = audit(folder);

    expect(result.status).toBe(2);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^SKIP worktree:audit: git could not list the worktrees of .*not a git repository.*Nothing was judged$/);
  });
});

describe("orphan branches", () => {
  it("lists a worktree-* branch no worktree has checked out as MERGED, with the command that deletes it", () => {
    const remote = createRemote();

    git(remote.clone, "branch", "worktree-old", "origin/main");

    const result = audit(remote.clone);
    const at = result.lines.indexOf("orphan branches: 1 (named worktree-*, checked out in no worktree)");

    expect(result.status).toBe(0);
    expect(result.lines.slice(at + 1, at + 4)).toEqual([
      "  MERGED  worktree-old",
      `    tip:     ${git(remote.clone, "log", "-1", "--format=%h %cs %s", "origin/main")}`,
      "    remove:  git branch -D worktree-old",
    ]);
    expect(result.lines).toContain("count: 0 worktrees | MERGED 0 | MERGED, NOT CLEAN 0 | UNMERGED 0 | NOT JUDGED 0 | orphan branches 1 | stray folders 0");
    expect(result.lines).toContain(
      "next: ask a person before anything is removed, and name what will go. A worktree may belong to a session that is still running, which this tool cannot see",
    );
  });

  it("lists one with commits main does not have as UNMERGED, with those commits and no command", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "lost");
    const tip = commit(path, "work nobody merged", { "work.txt": "1\n" }, "2026-10-01T09:00:00Z");

    git(remote.clone, "worktree", "remove", path);

    const result = audit(remote.clone, [], { now: new Date("2026-10-03T09:00:00Z") });
    const at = result.lines.indexOf("  UNMERGED  worktree-lost");

    expect(result.lines.slice(at + 2, at + 5)).toEqual([
      "    commits: 1 not on origin/main, the newest 2 days ago",
      `             ${tip.slice(0, 7)} work nobody merged`,
      "    Work that is on no worktree and not on main. No removal command is printed for it",
    ]);
    expect(result.text).not.toContain("remove:");
  });

  it("leaves out a branch that is checked out, in the project's own checkout too, and a branch of another name", () => {
    const remote = createRemote();

    addWorktree(remote, "live");
    addWorktree(remote, "other");
    git(remote.clone, "checkout", "--quiet", "-b", "worktree-own");
    git(remote.clone, "branch", "feature", "origin/main");
    git(remote.clone, "branch", "worktree-group/deep", "origin/main");

    // The filter leaves `other` out of the verdicts. Its branch is checked out all the same.
    const result = audit(remote.clone, ["live"]);

    expect(result.lines.filter((line) => /^ {2}[A-Z]/.test(line))).toEqual(["  MERGED  worktree-group/deep"]);
  });

  it("says so, and exits 2, when the branches cannot be listed", () => {
    const remote = createRemote();
    const result = audit(remote.clone, [], { run: failing("for-each-ref", 128, "fatal: broken") });

    expect(result.status).toBe(2);
    expect(result.lines).toContain("orphan branches: could not be listed (fatal: broken)");
    expect(result.lines.at(-1)).toMatch(/^SKIP worktree:audit: the local branches could not be listed\./);
  });
});

describe("stray folders", () => {
  it("lists a folder in the worktree folder that git does not know, with its top level, and leaves it there", () => {
    const remote = createRemote();
    const stray = join(worktreesOf(remote), "leftover");

    addWorktree(remote, "real");
    writeFile(stray, ".idea/workspace.xml", "<project/>\n");
    writeFile(stray, "notes.md", "keep?\n");

    const result = audit(remote.clone);
    const at = result.lines.indexOf(`stray folders: 1 (in ${worktreesOf(remote)}, and not a worktree git knows)`);

    expect(result.status).toBe(0);
    expect(result.lines.slice(at + 1, at + 3)).toEqual(["  STRAY  leftover: holds 2 entries: .idea/, notes.md", "  Listed only. What one holds is for a person to read before it goes"]);
    expect(result.lines.find((line) => line.startsWith("count:"))).toMatch(/stray folders 1$/);
    expect(readFileSync(join(stray, "notes.md"), "utf8")).toBe("keep?\n");
    expect(existsSync(join(stray, ".idea/workspace.xml"))).toBe(true);
  });

  it("names the first five entries and counts the rest, and says what is empty, a file or a link", () => {
    const remote = createRemote();
    const folder = worktreesOf(remote);

    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      writeFile(join(folder, "full"), name, "");
    }

    mkdirSync(join(folder, "bare"));
    writeFile(folder, "note.txt", "");
    symlinkSync(remote.other, join(folder, "elsewhere"));

    const result = audit(remote.clone);
    const at = result.lines.findIndex((line) => line.startsWith("stray folders: 4 "));

    expect(result.lines.slice(at + 1, at + 5)).toEqual([
      "  STRAY  bare: an empty folder",
      "  STRAY  elsewhere: a link, not followed",
      "  STRAY  full: holds 6 entries: a, b, c, d, e, and 1 more",
      "  STRAY  note.txt: a file, not a folder",
    ]);
  });

  it("does not call a worktree a stray, nor a folder that holds one made by hand a level down", () => {
    const remote = createRemote();

    addWorktree(remote, "real");
    git(remote.clone, "worktree", "add", "--quiet", "--no-track", "-b", "worktree-deep", join(worktreesOf(remote), "group", "deep"), "origin/main");

    const result = audit(remote.clone);

    expect(result.lines).toContain("stray folders: none");
    expect(result.lines.filter((line) => line.startsWith("MERGED  "))).toEqual(["MERGED  deep", "MERGED  real"]);
  });

  it("starts no line with a folder's name: one named like a command is read as a name", () => {
    const remote = createRemote();

    mkdirSync(join(worktreesOf(remote), "remove:  git worktree remove --force x"), { recursive: true });

    const result = audit(remote.clone);

    expect(result.lines).toContain("  STRAY  remove:  git worktree remove --force x: an empty folder");
    expect(result.lines.filter((line) => /^ *remove:/.test(line))).toEqual([]);
    expect(result.lines.filter((line) => line.startsWith("next: run"))).toEqual([]);
  });

  it("says so, and exits 2, when the worktree folder cannot be read", () => {
    const remote = createRemote();

    writeFileSync(worktreesOf(remote), "not a folder\n");

    const result = audit(remote.clone);

    expect(result.status).toBe(2);
    expect(result.lines).toContain(`stray folders: ${worktreesOf(remote)} could not be read`);
    expect(result.lines.at(-1)).toMatch(/^SKIP worktree:audit: .*project-worktrees could not be read\./);
  });
});

describe("the filter", () => {
  it("keeps the worktrees whose name holds it, and still lists every orphan branch and stray folder", () => {
    const remote = createRemote();

    addWorktree(remote, "rates-filter");
    addWorktree(remote, "rates-total");
    addWorktree(remote, "login");
    git(remote.clone, "branch", "worktree-old", "origin/main");
    mkdirSync(join(worktreesOf(remote), "leftover"));

    const result = audit(remote.clone, ["rates"]);

    expect(result.status).toBe(0);
    expect(result.lines.filter((line) => line.startsWith("MERGED  "))).toEqual(["MERGED  rates-filter", "MERGED  rates-total"]);
    expect(result.lines).toContain('filter: worktrees whose name holds "rates" (2 of 3). Orphan branches and stray folders are all listed');
    expect(result.lines).toContain("  MERGED  worktree-old");
    // A worktree the filter left out is still a worktree: it is not listed as a stray.
    expect(result.lines.filter((line) => line.startsWith("  STRAY  "))).toEqual(["  STRAY  leftover: an empty folder"]);
    expect(result.lines.find((line) => line.startsWith("count:"))).toMatch(/^count: 2 worktrees \| MERGED 2 /);
    expect(audit(remote.clone).lines.filter((line) => line.startsWith("filter:"))).toEqual([]);
  });

  it("exits 2 when no worktree's name holds it: nothing was judged", () => {
    const remote = createRemote();

    addWorktree(remote, "login");

    const result = audit(remote.clone, ["rates"]);

    expect(result.status).toBe(2);
    expect(result.lines).toContain('no worktree\'s name holds "rates"');
    expect(result.lines.at(-1)).toMatch(/^SKIP worktree:audit: no worktree's name holds "rates", so none of the 1 linked worktree was judged\./);
    expect(result.text).not.toContain("MERGED  login");
  });

  it.each([["-x"], ["--force"], ["a b"], ["../x"], ["a/b"], ["$(x)"], ["x;y"], [""], ["\u202ex"]])("is refused as %j, which is not one plain word, before git is asked anything", (filter) => {
    const remote = createRemote();

    addWorktree(remote, "x");

    const result = audit(remote.clone, [filter]);

    expect(result.status).toBe(2);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^usage: audit-worktrees\.mts \[name-filter\]/);
    expect(result.asked).toEqual([]);
  });

  it("is one word, not two", () => {
    const remote = createRemote();
    const result = audit(remote.clone, ["rates", "login"]);

    expect(result.status).toBe(2);
    expect(result.lines[0]).toMatch(/^usage: /);
    expect(result.asked).toEqual([]);
  });

  it("takes a dot, a dash and an underscore, as a worktree's name does", () => {
    const remote = createRemote();

    addWorktree(remote, "v1.2-rates_fix");

    expect(audit(remote.clone, ["1.2-rates_f"]).lines).toContain("MERGED  v1.2-rates_fix");
  });
});

describe("text that comes from outside", () => {
  it("writes out a control character and a text-direction mark in a commit's subject, so that it cannot write a line of its own", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "wip");
    const tip = commit(path, "fix\u001b[2K\rMERGED  wip\u202egnp", { "work.txt": "1\n" });
    const result = audit(remote.clone);

    expect(result.lines.filter((line) => RAW.test(line))).toEqual([]);
    expect(blockOf(result, "wip")).toContain(`           ${tip.slice(0, 7)} fix\\u001b[2K\\u000dMERGED  wip\\u202egnp`);
    expect(result.lines.filter((line) => /^MERGED {2}/.test(line))).toEqual([]);
  });

  it("writes out a text-direction mark in a branch's name, and prints no command that would name another branch", () => {
    const remote = createRemote();
    const path = join(worktreesOf(remote), "turned");

    git(remote.clone, "worktree", "add", "--quiet", "--no-track", "-b", "worktree-\u202egnp", path, "origin/main");
    git(remote.clone, "branch", "worktree-old\u200b", "origin/main");

    const result = audit(remote.clone);
    const block = blockOf(result, "turned");

    expect(result.lines.filter((line) => RAW.test(line))).toEqual([]);
    expect(block[0]).toBe("MERGED  turned");
    expect(block).toContain("  branch:  worktree-\\u202egnp");
    expect(block.at(-1)).toBe(
      "  No command is printed: its branch cannot be written as a word that names it when pasted. It holds a character that is written out above, or starts with a dash",
    );
    expect(result.lines).toContain("  MERGED  worktree-old\\u200b");
    expect(result.lines).toContain("    No command is printed: its name cannot be written as a word that names it when pasted");
    expect(result.text).not.toContain("remove:");
  });

  it("writes out a line end and an escape in a file's name: the file is one name on one line", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "half");

    writeFileSync(join(path, "a\nMERGED  fake\u001b[1A"), "");

    const result = audit(remote.clone);

    expect(result.lines.filter((line) => RAW.test(line))).toEqual([]);
    expect(blockOf(result, "half")).toContain("  tree:    1 path not committed: a\\u000aMERGED  fake\\u001b[1A (untracked)");
    expect(result.lines.filter((line) => line.startsWith("MERGED  "))).toEqual([]);
  });

  it("writes out what git said when it failed, as one line", () => {
    const remote = createRemote();
    const result = audit(remote.clone, [], { run: failing("fetch", 128, "fatal: \u001b[2Kno\nOK worktree:audit: all is well\n") });

    expect(result.status).toBe(2);
    expect(result.lines.filter((line) => RAW.test(line))).toEqual([]);
    expect(result.lines[2]).toBe("SKIP fetch: could not fetch main from origin (fatal: \\u001b[2Kno; OK worktree:audit: all is well)");
    expect(result.lines.filter((line) => line.startsWith("OK "))).toEqual([]);
  });

  it("cuts a subject that goes on, so that a line stays a line", () => {
    const remote = createRemote();
    const path = addWorktree(remote, "wip");
    const tip = commit(path, "x".repeat(300), { "work.txt": "1\n" });

    expect(blockOf(audit(remote.clone), "wip")).toContain(`           ${tip.slice(0, 7)} ${"x".repeat(120)}...`);
  });

  it("quotes a path with a space and a quote in it, and a branch with a quote: run in a shell, the commands remove that worktree and no other", () => {
    const remote = createRemote();
    const path = join(worktreesOf(remote), "it's here");
    const other = addWorktree(remote, "here");

    git(remote.clone, "worktree", "add", "--quiet", "--no-track", "-b", "worktree-it's", path, "origin/main");

    const block = blockOf(audit(remote.clone), "it's here");
    const commands = block.slice(-2).map((line) => line.replace(/^ +(?:remove: +)?/, ""));

    expect(commands).toEqual([`git worktree remove '${path.replace("'", "'\\''")}'`, "git branch -D 'worktree-it'\\''s'"]);
    // The tool removed nothing: both are there until a person runs what it printed.
    expect(existsSync(path)).toBe(true);

    for (const command of commands) {
      expect(spawnSync("sh", ["-c", command], { cwd: remote.clone, encoding: "utf8" }).status).toBe(0);
    }

    expect(existsSync(path)).toBe(false);
    expect(git(remote.clone, "branch", "--list", "worktree-it*")).toBe("");
    expect(existsSync(other)).toBe(true);
    expect(git(remote.clone, "branch", "--list", "worktree-here")).not.toBe("");
  });

  it("prints no command for a path that holds a character it wrote out", () => {
    const remote = createRemote();
    const path = join(worktreesOf(remote), "a\u202eb");

    git(remote.clone, "worktree", "add", "--quiet", "--no-track", "-b", "worktree-ab", path, "origin/main");

    const result = audit(remote.clone);
    const block = blockOf(result, "a\\u202eb");

    expect(result.lines.filter((line) => RAW.test(line))).toEqual([]);
    expect(block[0]).toBe("MERGED  a\\u202eb");
    expect(block.at(-1)).toBe(
      "  No command is printed: its path cannot be written as a word that names it when pasted. It holds a character that is written out above, or starts with a dash",
    );
    expect(result.text).not.toContain("remove:");
  });
});

describe("a line as it may be printed", () => {
  it.each([
    ["\u001b[2K", "\\u001b[2K"],
    ["a\nb", "a\\u000ab"],
    ["a\rb", "a\\u000db"],
    ["a\tb", "a\\u0009b"],
    ["a\u0000b", "a\\u0000b"],
    ["a\u007fb", "a\\u007fb"],
    ["a\u009bb", "a\\u009bb"],
    ["a\u202eb", "a\\u202eb"],
    ["a\u2066b", "a\\u2066b"],
    ["a\u200bb", "a\\u200bb"],
    ["a\ufeffb", "a\\ufeffb"],
    ["a\u2028b", "a\\u2028b"],
    ["a\u2029b", "a\\u2029b"],
    ["a\u0378b", "a\\u0378b"],
    ["a\u00a0b", "a\\u00a0b"],
    ["a\u{e0041}b", "a\\udb40\\udc41b"],
    ["a\ud800b", "a\\ud800b"],
    ["a\ue000b", "a\\ue000b"],
  ])("writes %j out as %j", (text, written) => {
    expect(shown(text)).toBe(written);
  });

  it("leaves a space, a letter of any alphabet, a sign and an emoji as they are", () => {
    const plain = "MERGED  it's — naïve 価格 → 😀 `x` $y \\u001b";

    expect(shown(plain)).toBe(plain);
  });
});

describe("a word of a printed command", () => {
  it.each([["worktree-rates"], ["/Users/a/project-worktrees/v1.2_x"], ["release/1.x"], ["a@b%c+d=e:f,g"]])("is %j as it is: nothing in it is read by a shell", (text) => {
    expect(shellWord(text)).toBe(text);
    expect(wordInShell(text)).toBe(text);
  });

  it.each([["it's here"], ["a b"], ["$(touch x)"], ["`id`"], ["a;b"], ["a&b|c"], ["a>b"], ["*"], ["~"], ['"'], ["\\"], ["a'b'c"], ["!x"], ["#x"], ["价格"]])(
    "is quoted for %j, and a shell reads that text back from it",
    (text) => {
      const word = shellWord(text);

      expect(word?.startsWith("'")).toBe(true);
      expect(wordInShell(text)).toBe(text);
    },
  );

  it.each([[""], ["-x"], ["--force"], ["a\nb"], ["a\u001bb"], ["a\u202eb"], ["a\u200bb"], ["a\u00a0b"], ["a\ufffdb"]])("is not printed for %j", (text) => {
    expect(shellWord(text)).toBeUndefined();
  });
});

describe("it only reads", () => {
  it("removes nothing: every worktree, branch and stray folder is still there after a run", () => {
    const remote = createRemote();

    createCrowd(remote);

    const before = stateOf(remote);
    const result = audit(remote.clone);

    expect(result.status).toBe(0);
    expect(stateOf(remote)).toBe(before);
    expect(before).toContain("prunable");
    expect(before).toContain("worktree-old");
    expect(before).toContain("leftover/notes.md");
  });

  it("exits 0 whatever the verdicts are: a worktree to remove and work left behind fail nothing", () => {
    const remote = createRemote();

    createCrowd(remote);

    const result = audit(remote.clone);

    expect(result.status).toBe(0);
    expect(result.lines.filter((line) => /^[A-Z][A-Z, ]+ {2}\S/.test(line))).toEqual(["MERGED  done", "MERGED, NOT CLEAN  half", "MERGED  vanished", "UNMERGED  wip"]);
    expect(result.lines).toContain("count: 4 worktrees | MERGED 2 | MERGED, NOT CLEAN 1 | UNMERGED 1 | NOT JUDGED 0 | orphan branches 2 | stray folders 1");
    expect(result.lines).toContain(
      `next: run a "remove:" command from ${remote.clone}, not from inside the worktree it names. Removing a worktree deletes the files git ignores in it too. If git refuses, that is its answer: never add --force`,
    );
    expect(result.lines.at(-1)).toBe("OK worktree:audit: everything was read, and judged against origin/main as fetched just now. Nothing was removed: this tool only reads");
  });

  it("asks git nothing but questions, lists the worktrees with one command, and fetches once", () => {
    const remote = createRemote();

    createCrowd(remote);

    const { asked } = audit(remote.clone);
    const commands = asked.map(([program, ...args]) => [program, ...args.filter((argument) => argument !== "--no-optional-locks")].slice(0, 2).join(" "));

    expect([...new Set(commands)].sort()).toEqual([
      "git fetch",
      "git for-each-ref",
      "git log",
      "git merge-base",
      "git rev-list",
      "git rev-parse",
      "git status",
      "git symbolic-ref",
      "git worktree",
    ]);
    expect(asked.filter(([, command]) => command === "worktree")).toEqual([["git", "worktree", "list", "--porcelain", "-z"]]);
    expect(asked.filter(([, command]) => command === "fetch")).toHaveLength(1);
    expect(asked.flat().filter((argument) => /^(?:-f|--force|-D|-d|--delete|--prune|remove|prune)$/.test(argument))).toEqual([]);
  });

  it("prints no command with --force in it, and none for a worktree that is not MERGED", () => {
    const remote = createRemote();

    createCrowd(remote);

    const result = audit(remote.clone);
    const commands = result.lines.filter((line) => /^ +(?:remove: +)?git /.test(line)).map((line) => line.replace(/^ +(?:remove: +)?/, ""));

    expect(commands).toEqual([
      `git worktree remove ${join(worktreesOf(remote), "done")}`,
      "git branch -D worktree-done",
      `git worktree remove ${join(worktreesOf(remote), "vanished")}`,
      "git branch -D worktree-vanished",
      "git branch -D worktree-old",
    ]);
    expect(commands.join("\n")).not.toContain("--force");
  });

  it("runs as a program, from anywhere in the project, and exits with what it found", () => {
    const remote = createRemote();

    addWorktree(remote, "login");
    mkdirSync(join(remote.clone, "packages"));

    const whole = spawnSync(process.execPath, [join(TOOLS, "audit-worktrees.mts")], { cwd: join(remote.clone, "packages"), encoding: "utf8" });
    const none = spawnSync(process.execPath, [join(TOOLS, "audit-worktrees.mts"), "rates"], { cwd: remote.clone, encoding: "utf8" });

    expect(whole.status).toBe(0);
    expect(whole.stdout).toContain("MERGED  login\n");
    expect(whole.stdout.trimEnd().split("\n").at(-1)).toMatch(/^OK worktree:audit: /);
    expect(none.status).toBe(2);
    expect(none.stdout.trimEnd().split("\n").at(-1)).toMatch(/^SKIP worktree:audit: no worktree's name holds "rates"/);
  });
});

describe("what git lists", () => {
  it("is read field by field: a path with a line end in it is one path, and a lock's reason is its own", () => {
    const listed = parseWorktrees(
      [
        "worktree /p/project\0HEAD 1111111111111111111111111111111111111111\0branch refs/heads/main\0",
        "worktree /p/project-worktrees/a\nbranch refs/heads/main\0HEAD 2222222222222222222222222222222222222222\0detached\0locked two\nlines\0",
        "worktree /p/project-worktrees/b\0HEAD 3333333333333333333333333333333333333333\0branch refs/heads/worktree-b\0locked\0prunable gone\0",
        "",
      ].join("\0"),
    );

    expect(listed).toEqual([
      { path: "/p/project", head: "1111111111111111111111111111111111111111", branch: "main", locked: undefined, prunable: undefined },
      { path: "/p/project-worktrees/a\nbranch refs/heads/main", head: "2222222222222222222222222222222222222222", branch: undefined, locked: "two\nlines", prunable: undefined },
      { path: "/p/project-worktrees/b", head: "3333333333333333333333333333333333333333", branch: "worktree-b", locked: "", prunable: "gone" },
    ]);
  });
});

interface Audit {
  status: number;
  lines: string[];
  /** The lines as one text. */
  text: string;
  /** Every program the tool started, with its arguments, in order. */
  asked: string[][];
}

interface AuditWith {
  now?: Date;
  run?: Run;
}

/** Runs the tool with the real git, unless `run` stands in for it. */
function audit(cwd: string, argv: string[] = [], { now = new Date(), run: runGit = run }: AuditWith = {}): Audit {
  const lines: string[] = [];
  const asked: string[][] = [];
  const status = auditWorktrees({
    cwd,
    argv,
    now,
    run: (program, args, where) => {
      asked.push([program, ...args]);

      return runGit(program, args, where);
    },
    report: (line) => lines.push(line),
  });

  return { status, lines, text: lines.join("\n"), asked };
}

/** The real git, but for one of its commands, which fails with `status` and says `stderr`. */
function failing(command: string, status: number, stderr = ""): Run {
  return (program, args, where) => (args.filter((argument) => !argument.startsWith("--no-optional"))[0] === command ? { status, stdout: "", stderr } : run(program, args, where));
}

/** The lines about one worktree: its verdict line and what stands under it. */
function blockOf({ lines }: Audit, name: string): string[] {
  const start = lines.findIndex((line) => /^[A-Z][A-Z, ]+ {2}/.test(line) && line.endsWith(`  ${name}`));

  return start === -1 ? [] : lines.slice(start, lines.indexOf("", start));
}

function worktreesOf(remote: Remote): string {
  return join(dirname(remote.clone), "project-worktrees");
}

/** A worktree as `pnpm worktree <name>` makes it. */
function addWorktree(remote: Remote, name: string): string {
  const path = join(worktreesOf(remote), name);

  git(remote.clone, "worktree", "add", "--quiet", "--no-track", "-b", `worktree-${name}`, path, "origin/main");

  return path;
}

/** Someone merges the branch on origin: with a merge commit, as the rule is, or as one squashed commit. The first clone has not heard. */
function mergeOnOrigin(remote: Remote, worktree: string, branch: string, how: "merge" | "squash" = "merge"): void {
  git(worktree, "push", "--quiet", "origin", branch);
  git(remote.other, "pull", "--quiet", "--ff-only", "origin", "main");
  git(remote.other, "fetch", "--quiet", "origin", branch);

  if (how === "merge") {
    git(remote.other, "merge", "--quiet", "--no-ff", "-m", `Merge ${branch}`, `origin/${branch}`);
  } else {
    git(remote.other, "merge", "--quiet", "--squash", `origin/${branch}`);
    commit(remote.other, `${branch} as one commit`, {});
  }

  git(remote.other, "push", "--quiet", "origin", "main");
}

/** One of everything: a merged worktree, one that is merged and not clean, live work, one whose folder is gone, two orphan branches and a stray folder. */
function createCrowd(remote: Remote): void {
  const done = addWorktree(remote, "done");
  const wip = addWorktree(remote, "wip");

  commit(done, "the work", { "work.txt": "1\n" });
  mergeOnOrigin(remote, done, "worktree-done");
  writeFile(addWorktree(remote, "half"), "notes.txt", "to do\n");
  commit(wip, "started", { "wip.txt": "1\n" });
  rmSync(addWorktree(remote, "vanished"), { recursive: true });
  git(remote.clone, "branch", "worktree-old", "origin/main");
  git(remote.clone, "branch", "worktree-lost", "worktree-wip");
  writeFile(join(worktreesOf(remote), "leftover"), "notes.md", "keep?\n");
}

/** What a run must leave as it was: the worktrees git knows, every local branch, and every file in the worktree folder. */
function stateOf(remote: Remote): string {
  return [
    git(remote.clone, "worktree", "list", "--porcelain"),
    git(remote.clone, "for-each-ref", "refs/heads/"),
    readdirSync(worktreesOf(remote), { recursive: true, encoding: "utf8" }).sort().join("\n"),
  ].join("\n--\n");
}

/** What a real shell takes the printed word to be. */
function wordInShell(text: string): string {
  return spawnSync("sh", ["-c", `printf %s ${shellWord(text)}`], { encoding: "utf8" }).stdout;
}
