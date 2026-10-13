#!/usr/bin/env node
// Says which worktrees of this project are finished and which hold work.
//
//   node tools/agent-workflow/audit-worktrees.mts [name-filter]
//
// Every change starts in a worktree, and one is removed when its commit is
// on main. With several sessions on one project some are left behind: merged
// and forgotten, or stopped in the middle. This tells the two apart. Each
// linked worktree gets one verdict, judged against `origin/<main>`:
//
//   MERGED             its commit is on main and its tree is clean. The
//                      commands that remove it are printed, unless it may
//                      hold no work of its own: a worktree just made does
//   MERGED, NOT CLEAN  its commit is on main, and the tree holds files that
//                      are changed or untracked. No command is printed
//   UNMERGED           it has commits main does not have. No command is
//                      printed, ever
//   NOT JUDGED         git could not say. Not a pass
//
// After them: local branches named `worktree-*` that no worktree has checked
// out, and what is in `<project>-worktrees/` that git does not know as a
// worktree.
//
// It only reads. It removes no worktree, deletes no branch, prunes nothing
// and deletes no folder: a command that does is printed for a person. The
// one thing it changes is what `git fetch origin <main>` changes, so that
// the verdicts are against main as it is now. When the fetch fails the
// report still comes, says so first and last, and exits 2.
//
// "On main" is `git merge-base --is-ancestor`. A branch that reached main by
// a squash or a rebase is not an ancestor of it, and reads as UNMERGED.
//
// The filter keeps the worktrees whose name holds it. It is one plain word,
// as a worktree's name is.
//
// Exit 0: everything was read, and judged against origin's main as fetched
// just now, whatever the verdicts are. Exit 2: something was not (the fetch
// failed, a worktree could not be judged, the filter matched nothing, this
// is not a git repository, a wrong argument); the last line says what. There
// is no exit 1: this is a report, and a worktree left behind fails nothing.

import { isMainModule } from "./lib/main.mts";
import { run } from "./lib/system.mts";
import { auditWorktrees } from "./lib/worktree-audit.mts";

if (isMainModule(import.meta.url)) {
  process.exitCode = auditWorktrees({ cwd: process.cwd(), argv: process.argv.slice(2), now: new Date(), run, report: (line) => console.log(line) });
}
