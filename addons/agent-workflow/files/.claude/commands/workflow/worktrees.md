---
description: Say which worktrees are finished and can go, and which hold work someone stopped in the middle of
argument-hint: [part of a worktree's name]
allowed-tools: Bash(pnpm worktree:audit:*), Read
---

Audit the project's worktrees. Asked for: `$ARGUMENTS`, a part of a name, to
look at those worktrees only. If that is empty, or still reads as a
placeholder because this host does not fill it in, take it from the request,
and with none given audit them all.

Run each step yourself. This file runs nothing by itself.

## 1. Run the audit

```bash
pnpm worktree:audit
pnpm worktree:audit <part of a name>
```

It fetches main and reads. It removes nothing, ever.

Exit 0: every worktree was read, and judged against main as it is now. Exit
2: something was not read or not judged, and the last line, which begins
`SKIP`, says what. Report that first. When it was the fetch that failed, the
verdicts are against main as this clone last had it, and an old main makes
finished work look unfinished: say so before any verdict.

## 2. Report it

A worktree for each block of the audit, in this order:

1. **MERGED:** its name, its branch, and the commit it stands on. Say when
   the audit printed no command for it, and why: it may be a worktree a
   session has just made.
2. **MERGED, NOT CLEAN:** the files it names. Someone left them there.
3. **UNMERGED:** lead with what the work was. Read the subjects of the
   commits it lists, so that a reader who has forgotten the branch knows it
   again from one line: "two commits, a retry for the price feed" and not
   "two unmerged commits". Then how old the newest is, and whether the tree
   is clean.
4. **NOT JUDGED:** which, and what the audit could not read.
5. **Orphan branches and stray folders**, only when there are some.

Then the audit's line of counts.

## 3. Before anything is removed, ask

Never remove a worktree or delete a branch without a yes from the user, in
this conversation, that names what will go. A "clean them up" said before
the audit is not that yes: it was said before either of you knew what was
there. Show the list, then ask.

After the yes, run the commands the audit printed after `remove:`, as it
printed them, from the project's own folder. Each asks first: this command
is not let to run them unasked.

- **Only what the audit printed a command for.** Never an UNMERGED worktree
  and never one that is MERGED, NOT CLEAN, however the request is worded. If
  it seems to take one in, ask again.
- **Never `--force`.** When git refuses to remove a worktree, that is its
  answer: say what is in the way.
- **Never `git worktree prune` to be rid of a worktree that is there.**
- **A worktree may be a session's that is running now.** The audit cannot
  see sessions. If its newest commit is minutes old, say so before you ask.
- **A branch that is still on `origin`** is not removed here: that is
  `git push --delete`, which is the user's to ask for.

## 4. Work to pick up

An UNMERGED worktree is whole: its branch holds the commits, and its folder
the files. Work goes on in that folder. Say so, and do not let "no session
is using it" read as "the work is lost".
