# Evals

Whether a model loads the right skill for a request. Nothing else in this
repository can see that: the tests check the scripts a skill runs, not whether
a skill is reached for. A description that leaves out half of what its skill
covers passes every test.

These cost money and their results vary between runs, so they are run by
hand, not in CI: after a change to any `SKILL.md`, and before the plugin's
version goes up.

## Running them

You need Claude Code 2.1.269 or later, signed in (`claude --version`), and
this repository installed (`pnpm install`). Then, from the repository's root:

```bash
pnpm evals:trigger
```

That runs every case three times on Claude Sonnet: 39 runs, one after
another, about $3 at list price. It is `claude plugin eval` with the options
this suite needs; `package.json` has the line.

The first run in a checkout asks whether you trust the folder as a plugin.
Answer yes: it is this repository.

Anything after the script's name is passed on, so a run can be narrowed or
changed:

| Add | To |
|---|---|
| `--case 'trigger-extend-*'` | Run only the cases whose name matches |
| `--runs 1` | Run each case once: a first look, at a third of the cost |
| `-j 4` | Run four at a time. The whole suite then takes about four minutes |
| `--model haiku` | Use another model. It replaces the script's `--model sonnet` |
| `--max-cost-usd 5` | Start no further run once that much is spent |
| `--trust-plugin` | Answer the trust question where nobody can be asked: an agent's shell, a script |

For example, one skill's cases, once each, four at a time:

```bash
pnpm evals:trigger --case 'trigger-review-*' --runs 1 -j 4
```

An agent runs these only when asked to. Each run spends the person's money.

## Reading the result

Each run prints a line with its score and cost, and under it one line for
each thing graded:

```text
  trigger-extend-e2e run 1/3: score 1.00  $0.05
    ✓ loads-extending-a-project (weight 1): Skill called 1x (expected 1..∞)
```

A table of the cases follows, then the total. The command exits 0 when every
case scored 1.00 and 1 when any did not. The same result, with each prompt
beside it, is written as a page to `evals/results/<time>/report.html`, which
git ignores.

| You see | It means | Do |
|---|---|---|
| `✗ loads-<skill>: Skill called 0x` | The request did not load the skill it should have | Read the request beside the skill's `description`. The words the person used are missing from it. Change the description, never the request |
| `✗ leaves-<skill>: Skill called 1x` | That skill was loaded for a request that is not its own | Its description claims too much. Where the right skill was loaded too, say in each description what tells the two apart |
| One run of three failed | Results vary between runs | Run that case again with `--case <name> --runs 9` before changing anything |
| `error: … Reached maximum number of turns (8)` | The agent was still reading the project when it was stopped | Nothing. The run is graded on what it did before that |
| `scaffold failed` | The project the agent starts in could not be made, and the run scored 0 | Run the case's `fixture.sh` yourself, in an empty folder, to see the error |

After a change to a description, run that skill's cases and the three that
expect no skill: a description widened to catch one request can start
catching others.

## The cases

One folder each, one `case.yaml` in it. A case is a request and the skill it
should load, or `none`.

| Skill | Should load it |
|---|---|
| `creating-a-project` | A new project in the skill's own words; the same without naming ports and adapters or RxJS |
| `extending-a-project` | End-to-end tests; CI security checks, asked for without the add-on's name; an update of the kit; an existing project that wants the gates (and `creating-a-project` must stay out) |
| `reviewing-architecture` | A review before merging, with no mention of architecture; "does this follow the architecture?" |
| `documenting-architecture` | A set of documents with C4 diagrams; a guide for a newcomer, with no mention of architecture |
| none | A Python service; a review in a project without the kit; one diagram |

The agent has `Read`, `Glob`, `Grep` and `Skill`, and no more: it can look at
the project and load a skill, and cannot act on it. Each run is stopped after
eight turns.

### Adding one

Copy a case's folder and change four things in its `case.yaml`: the `name`
(the folder's name), the second tag (the skill, or `none`), the `prompt`, and
the skill in the grader's `input_match`. Write the prompt as a person would
who has never heard of the skill, and do not name the skill in it.
`pnpm test` checks the form of every case (`scripts/evals.test.mts`), without
running one.

A new skill needs two cases or more of its own, and a `leaves-<skill>` grader
in each of the three cases that expect none. The same test fails until both
are done.

## The projects the agent starts in

- **A project with the kit** is made by `scripts/create-project.mts` as each
  run starts, so it is the project this revision produces.
- **A project without it** is the small monorepo in
  [`fixtures/plain-project`](fixtures/plain-project).
- The two creation cases and the Python one start in an empty folder.

Each `fixture.sh` is one line of bash because the harness runs nothing else.

## What a run cost, and proof that it can fail

On 2026-10-13, Claude Code 2.1.296, Claude Sonnet: 13 cases, 39 runs, all
passed, $2.87 at list price, under four minutes with four runs at a time.
The cases that load the documenting and reviewing skills cost about $0.14 a
run, because the agent goes on reading the project after the skill loads; the
rest cost about $0.05.

Two cases were then run against a skill made worse on purpose:

| Change | Case | Result |
|---|---|---|
| `extending-a-project` given the description it had before 0.13.1, which named three add-ons of nine | `trigger-extend-ci-security` | Loaded in 0 runs of 3 |
| `reviewing-architecture` described as for "any code … in any project" | `trigger-none-plain-review` | Loaded in 1 run of 3, where it should load in none |

The first is the fault these evals were written for, reproduced. The second
shows the cases that expect no skill are the weaker half: a description that
claims too much was caught once in three.

The three cases that expect no skill then got one grader for each skill, so
that a failed run says which skill was loaded, and were run again: 9 runs of
9 passed. With one grader given an expectation no run can meet, the command
exited 1.

## What these do not show

- **What a skill does once loaded.** No case here grades an outcome. Those
  need a shell and file writes, and have not been written.
- **Codex.** `claude plugin eval` runs Claude Code only.
- **A session in a real project.** A run loads the plugin and nothing else:
  no `CLAUDE.md`, no project settings, no other plugin. A created project's
  `AGENTS.md` sends every review to the same seven questions, so in use a
  review reaches them with or without the skill. A session where other
  plugins' skills compete for the same request is not covered.
- **Any model but Claude Sonnet.** One case has been run once on Claude
  Haiku, to see that `--model` is passed on.
