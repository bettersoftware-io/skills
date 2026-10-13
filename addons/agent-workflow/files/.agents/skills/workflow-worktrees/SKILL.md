---
name: workflow-worktrees
description: Use when asked which worktrees are left over, can be removed or cleaned up, or hold unfinished work to pick up. It reads and reports; it removes nothing without a yes that names what goes.
---

# Worktrees

The steps are in `.claude/commands/workflow/worktrees.md`, at the project
root. Read that file and follow it from step 1. Step 3 is a stop: nothing is
removed before the user says yes to a list.

It is written as a Claude Code command, so two things in it do not apply
here:

- Ignore the block between the `---` lines at its top.
- `$ARGUMENTS` is not filled in. The part of a name is whatever the request
  gives, and every worktree when it gives none.
