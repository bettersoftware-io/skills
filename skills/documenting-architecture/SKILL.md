---
name: documenting-architecture
description: Use when asked to document, map or explain the architecture of a codebase as a set of documents with diagrams (C4 context, containers and components, sequence, state and class diagrams) written from its source — a newcomer's guide to how a repository works, in any language or stack.
---

# Documenting architecture

A document about a codebase is written from what was read a while ago, and it
reads as fluent whether or not it is true. Three things can be checked by a
machine: every diagram renders, every link leads somewhere, every cited file
exists. None of them says a sentence is right.

On two real sets, each of which passed all three, readers who had not written
them then found 31 wrong or misleading claims in about 870, and 52 in about
860. So the set is checked against the source by someone else before it is
called finished. That step is the point of this skill.

## Skip it when

- The user wants one diagram, or an answer in the conversation. Give that.
- The repository already has such a set and the task is a change to it. Make
  the change, then run steps 5 and 6 on the chapters that changed.
- The codebase is a few files. A section in its README is enough.

## 1. Settle where the set goes

- The set is one folder, `docs/architecture/`, unless the repository already
  uses another: `README.md` as the index, then numbered chapters
  (`01-overview.md`, `02-c4-model.md`). One folder is what the checks and the
  reading copy take.
- It is additive. In a repository that is not the user's own, edit no existing
  file and link the set from nowhere; say so in the report and let the owner
  decide.
- Write down the commit the facts are read from (`git rev-parse --short HEAD`).
  The index names it, and says that where the set and the code disagree the
  code wins.
- Read what the repository already documents, so the set points to it instead
  of repeating it. Where a document says what the code no longer does, keep
  the claim and the file that settles it. The index will list them (step 4).
- Find what the repository checks its own documents with, and read each rule
  before a chapter is written: the scripts in its package manifest, its hooks,
  its CI jobs, a documentation site's ignore file. A rule can settle the
  folder (which documents are published) and forbid what a set is otherwise
  full of. One repository's check, required to merge, refused every
  hand-written count such as "37 domains"; it was found after the set was
  written, in twenty lines and three headings.

## 2. Read the spine yourself

Before delegating anything, read the few hundred lines everything hangs off:
the entry point, where the parts are wired together, the central types or
state machine. Whoever writes the set needs that in their own context to judge
what the readers of step 3 report.

## 3. Have each area read by a separate reader

One subagent per area, in parallel, read-only. The brief that worked is in
[`briefs.md`](briefs.md): a narrow slice with its folders named, what the
other readers cover, numbered questions shaped like the diagrams to be drawn,
a file and line for every claim that is not obvious, and "could not verify"
said out loud.

If no subagent can be started, read each area yourself, one at a time, and
take notes with file and line.

## 4. Write

| Chapter | Holds |
|---|---|
| Overview | What it is, the mental model in one picture, principles, terms |
| C4 model | Context, containers, components; where each runs |
| Types, sequences, states | The notation-first views of the whole |
| One chapter per area | What a newcomer to that area needs |
| Decisions | Each choice with what it buys and what it costs |
| Codebase map, trailheads | Where things are; "to change X, open these" |

- Open each chapter with a table of the words it uses, in plain language.
- Name things as the code names them: a box in a diagram is a file, a function
  or a type a reader can search for.
- One colour scheme for every flowchart, with fixed colours that read on a
  light and a dark page. [`mermaid.md`](mermaid.md) has it, and the mistakes
  that cost time.
- **Measure what can be measured.** Count imports between folders with a
  script. Do not describe the dependency graph from memory.
- **To say who does something, open the function.** The commonest error is
  naming the module that triggers an action in place of the one that performs
  it.
- Say "only", "never" and "every" when a search proved it, and not otherwise.
- A count is stamped with the commit it was taken at. It will drift.
- Mark the decisions chapter as reconstruction: reasons were read off the
  code's shape and its comments, not stated by its authors, unless quoted.
- The index lists where the repository's own documents and the code disagree:
  what the document says, what the code does, the file that shows it. In a
  repository that is not the user's no existing file is edited, so this list
  is how its owner hears of it.

## 5. Run the three checks

The scripts are in the plugin this skill ships in, whose root is two folders
above this file.

```bash
node <plugin root>/scripts/architecture-docs/check-diagrams.mts docs/architecture
node <plugin root>/addons/repo-hygiene/files/tools/repo-hygiene/check-doc-links.mts --root docs/architecture
node <plugin root>/scripts/architecture-docs/check-cited-paths.mts docs/architecture
```

Each prints `PASS` with how much it judged, `SKIP` with the reason, or `FAIL`
with a file and line, and exits 2 when it could not run. A `SKIP` judged
nothing: it is not a pass.

- `check-diagrams` draws every mermaid block in one browser with no window.
  The first run fetches its tools into a cache folder outside the repository
  (about 230 MB, once per machine). On a machine with no Chromium-based
  browser it says so and stops; report that the diagrams were not checked.
- `check-cited-paths` fails a path in backticks that is not in the repository.
  When a chapter says a file is missing, name it: `--except docs/old-plan.md`.
- Run the checks the repository applies to its own documents (step 1), then
  `check-diagrams` again: a formatter rewrites tables and may touch a block.
- After its verdict `check-diagrams` names each diagram drawn wider than
  1,800 px. Those have passed. A page shows them at half size or less, so
  they are the ones to look at first; [`mermaid.md`](mermaid.md) says what
  narrows one.
- Render the dense diagrams and look at them (`--keep <dir>`). A diagram that
  parses can still be unreadable.

If the scripts are not there (the skill was copied on its own), clone
`https://github.com/bettersoftware-io/skills` into a temporary folder and run
them from the clone.

## 6. Have it checked against the source by readers who did not write it

**Do not report the set as finished before this step.** Spot-checking
constants yourself is not this step: numbers copied from a reader's notes are
the part that is already right. The errors are in who does what, in step
order, and in "only" and "never".

Start two fresh subagents, half the chapters each, with the brief in
[`briefs.md`](briefs.md). They get the documents and the code, and nothing of
what the documents are meant to say. A diagram's labels and arrows are claims
like any sentence.

Apply every finding. Change text with a script that refuses to write unless
each old string matches exactly once. Then run step 5 again.

If no second reader can be started, the set is "not fact-checked". Say so in
the index and in the report. Not checked is not passed.

## 7. Give the reader a way to read it

An editor's preview may not draw mermaid, or may stop after a few dozen
diagrams. Build the copy that opens in a browser:

```bash
node <plugin root>/scripts/architecture-docs/build-site.mts docs/architecture
```

It writes outside the repository and prints the page to open. It is a
snapshot: build it again after the documents change.

## 8. Report

1. Where the set is, the commit it was read from, and what was added to the
   repository (and that nothing else was touched).
2. The three checks, each with its line of output.
3. The fact-check: claims checked, findings by kind, that all were applied; or
   "not fact-checked" and why.
4. What is still unverified: what no reader could confirm, and how the set
   looks on the host that will show it, if it was not pushed.
5. Where the repository's own documents disagree with the code, if anywhere:
   how many places, and that the index lists them.
6. The page to open.
