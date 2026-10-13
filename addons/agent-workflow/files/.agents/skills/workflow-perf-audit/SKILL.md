---
name: workflow-perf-audit
description: Use when asked to audit animations or motion in the running client, or after a change to what live data makes animate. Needs the performance add-on; the steps stop and say so without it.
---

# Performance audit

The steps are in `.claude/commands/workflow/perf-audit.md`, at the project
root. Read that file and follow it from step 0.

It is written as a Claude Code command, so two things in it do not apply
here:

- Ignore the block between the `---` lines at its top.
- `$ARGUMENTS` is not filled in. The routes to open are whatever the request
  names.
