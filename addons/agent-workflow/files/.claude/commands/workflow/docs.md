---
description: Write what this session worked out into the project's documents: find where it belongs, propose it, then ship it as a pull request
argument-hint: [topic words]
allowed-tools: Bash(ls:*), Bash(grep:*), Bash(git ls-files:*), Bash(pnpm worktree:*), Bash(pnpm gate:full:*), Read, Write, Edit
---

Write down what this session established, in the project's own documents.
Topic: `$ARGUMENTS`. If that is empty, or still reads as a placeholder because
this host does not fill it in, take the topic from the request, and with none
given it is what the session found out.

Run each step yourself. This file runs nothing by itself.

## 1. See what documents there are

```bash
ls docs
git ls-files docs
grep -r -l -i "<a topic word>" docs AGENTS.md README.md
```

Run the last line once for each word of the topic. A project with no `docs`
folder has its documents at the root: look there.

## 2. Decide where it belongs

Decide before you write. A finding in the wrong document is worse than one
not written, because the right document then looks complete.

| What was found | Where it goes |
|---|---|
| Work that is not done, or the end of work that was pending | `docs/STATUS.md`, by "What is left" in `AGENTS.md` |
| An idea nobody has committed to | `docs/IDEAS.md` |
| A decision, with what else was weighed and what follows from it | A new decision record beside the project's others. If it has none, ask where they should go |
| How the project is built: its layers, its packages, what may import what | The project's architecture document |
| How one tool or one part behaves, and its traps | A document of its own under `docs/`, named for the topic |
| A rule every session must follow | `AGENTS.md`, and only if it truly is every session: that file is read at the start of each one |
| A preference of one person, or a fact about one machine | Not in the project |

In `AGENTS.md`, write outside the blocks between `<!-- add-on: … -->` and
`<!-- /add-on: … -->`. An update of the add-on replaces what is inside them.

## 3. Read the nearest document in full

Not a skim. It shows whether the finding is already there, and it is the
model for the new text: its voice, its headings, how long a section is.

## 4. Propose, then stop

```
Related:   <file>, which covers …
Proposal:  CHANGE <file>: <what changes>
           NEW <file>: <what it covers>, linked from <file>
Model:     <the document whose form it follows>
```

Wait for a yes. When the finding belongs in several documents, list them all
and let the user take some out.

## 5. Write it, in a worktree

```bash
pnpm worktree docs-<topic> --ready
```

- Write what is true now. Give a date to what was measured or seen
  ("measured 2026-10-13"), so a reader can tell how old it is.
- Say what was not verified. A document that reads as complete and is not
  costs the next reader more than a gap they can see.
- Link, do not copy. A second copy of a fact is the one that goes stale.
- A new document is linked from one a reader already starts at: the
  project's list of documents if it has one, or the README.
- If what you are writing is a rule a check could hold, say so in the
  report. A check keeps a rule; a sentence asks for it.

## 6. Ship it

Run `pnpm gate:full`. Then one pull request, by "Agent workflow" in
`AGENTS.md`: each outward step in a call of its own, merged when it is green,
the worktree removed, main watched.
