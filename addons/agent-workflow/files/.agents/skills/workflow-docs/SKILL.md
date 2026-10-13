---
name: workflow-docs
description: Use when asked to document, write up or record what a session found out, in the project's own documents. Do not use for a person's own notes outside the project.
---

# Docs

The steps are in `.claude/commands/workflow/docs.md`, at the project root.
Read that file and follow it from step 1. Step 4 is a stop: propose where
the text goes, and wait for a yes before you write.

It is written as a Claude Code command, so two things in it do not apply
here:

- Ignore the block between the `---` lines at its top.
- `$ARGUMENTS` is not filled in. The topic is whatever the request names.
