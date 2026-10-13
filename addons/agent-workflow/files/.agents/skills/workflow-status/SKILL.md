---
name: workflow-status
description: Use when asked where the project stands, what is open, whether main is green, or what is pending, remaining or left to do. It reads and reports; it changes nothing.
---

# Status

The steps are in `.claude/commands/workflow/status.md`, at the project root.
Read that file and follow it from step 1.

It is written as a Claude Code command, so two things in it do not apply
here:

- Ignore the block between the `---` lines at its top.
- `$ARGUMENTS` is not filled in. Which half to report is whatever the request
  names, and both when it names none.
