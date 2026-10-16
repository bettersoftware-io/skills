# Evals

Whether a model loads the right skill for a request, and, for three of the
four skills, whether it then does the right thing. Nothing else in this
repository can see that: the tests check the scripts a skill runs, not whether
a skill is reached for. A description that leaves out half of what its skill
covers passes every test.

These cost money and their results vary between runs, so they are run by
hand, not in CI: after a change to any `SKILL.md`, and before the plugin's
version goes up.

## Three kinds

| Command | Runs | Passes when | One full run |
|---|---|---|---|
| `pnpm evals:trigger` | The 13 trigger cases on Claude Code, with the plugin | The request loads the skill it should, and no other | 39 runs, about $3 on Sonnet |
| `pnpm evals:outcome` | The 3 outcome cases on Claude Code, with the plugin and again without it | The agent names the right command, or the review finds the planted problem | 18 runs, about $1.20 on Sonnet |
| `pnpm evals:codex` | The 13 trigger cases on Codex, with the plugin as Codex has it installed | Codex reads the skill's `SKILL.md`, and no other skill's | 39 runs, a few minutes of your Codex plan |

## Running them

You need this repository installed (`pnpm install`) and, for the first two,
Claude Code 2.1.269 or later, signed in (`claude --version`). For the third,
Codex, signed in, with `bettersoftware-skills` installed and enabled in it
(`codex plugin list`). Then, from the repository's root:

```bash
pnpm evals:trigger
pnpm evals:outcome
pnpm evals:codex
```

The first two are `claude plugin eval` with the options each kind needs;
`package.json` has the lines. Their first run in a checkout asks whether you
trust the folder as a plugin. Answer yes: it is this repository.

Anything after the script's name is passed on, so a run can be narrowed or
changed:

| Add | To |
|---|---|
| `--case 'trigger-extend-*'` | Run only the cases whose name matches |
| `--runs 1` | Run each case once: a first look, at a third of the cost |
| `-j 4` | Run four at a time. The trigger suite then takes about four minutes |
| `--model haiku` | Use another model. It replaces the script's `--model sonnet` |
| `--max-cost-usd 5` | Start no further run once that much is spent |
| `--trust-plugin` | Answer the trust question where nobody can be asked: an agent's shell, a script |

For example, one skill's cases, once each, four at a time:

```bash
pnpm evals:trigger --case 'trigger-review-*' --runs 1 -j 4
```

`pnpm evals:codex` takes `--runs <n>`, `--case <start of a name>`, `-j <n>`
and `--traces <folder>`, which keeps each run's events as
`<folder>/<case>-<run>.jsonl`.

An agent runs these only when asked to. Each run spends the person's money,
or their plan's allowance.

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
git ignores. An outcome run's table has a column with the plugin, one
without, and the difference: what the plugin added.

| You see | It means | Do |
|---|---|---|
| `✗ loads-<skill>: Skill called 0x` | The request did not load the skill it should have | Read the request beside the skill's `description`. The words the person used are missing from it. Change the description, never the request |
| `✗ leaves-<skill>: Skill called 1x` | That skill was loaded for a request that is not its own | Its description claims too much. Where the right skill was loaded too, say in each description what tells the two apart |
| `✗ names-the-…: pattern not found` in an outcome case | The skill loaded, and the command the agent gave is not the one the case expects | Compare the skill's text about that command with the case's pattern. A renamed option or add-on shows here first |
| `✗ finds-the-average: judge votes: FAIL …` | The review did not report the planted average | Read the review in the report page |
| One run of three failed | Results vary between runs | Run that case again with `--case <name> --runs 9` before changing anything |
| `error: … Reached maximum number of turns` | The agent was still reading the project when it was stopped | Nothing. The run is graded on what it did before that |
| `scaffold failed` | The project the agent starts in could not be made, and the run scored 0 | Run the case's `fixture.sh` yourself, in an empty folder, to see the error |
| `✗ <case>  1/3  did not load <skill>` from `evals:codex` | Codex answered without opening the skill | Run that case with `--traces <folder>` and read which files it opened instead |

After a change to a description, run that skill's cases and the three that
expect no skill: a description widened to catch one request can start
catching others.

## The cases

One folder each, one `case.yaml` in it. Its first tag says its kind, its
second the skill it is about, or `none`.

| Skill | Trigger cases: should load it | Outcome case |
|---|---|---|
| `creating-a-project` | A new project in the skill's own words; the same without naming ports and adapters or RxJS | Names `create-project.mts` with the scope and the name asked for |
| `extending-a-project` | End-to-end tests; CI security checks, asked for without the add-on's name; an update of the kit; an existing project that wants the gates (and `creating-a-project` must stay out) | Names `add-to-project.mts` with `ci-security:renovate` |
| `reviewing-architecture` | A review before merging, with no mention of architecture; "does this follow the architecture?" | Finds an average worked out in a component, which belongs in the core |
| `documenting-architecture` | A set of documents with C4 diagrams; a guide for a newcomer, with no mention of architecture | None: the skill starts readers of its own and fetches a 230 MB toolset, more than a run holds |
| none | A Python service; a review in a project without the kit; one diagram | |

The agent has `Read`, `Glob`, `Grep` and `Skill`, and no more: it can read
the project and load a skill. In the outcome cases it is told it cannot run
commands, so it says what it would run. A trigger run is stopped after eight
turns, an outcome run after twelve, or thirty for the review.

### Adding one

Copy a case's folder and change four things in its `case.yaml`: the `name`
(the folder's name), the second tag (the skill, or `none`), the `prompt`, and
the skill in the grader's `input_match`. Write the prompt as a person would
who has never heard of the skill, and do not name the skill in it.
`pnpm test` checks the form of every case (`scripts/evals.test.mts`), without
running one.

A new skill needs two trigger cases or more of its own, a `leaves-<skill>`
grader in each of the three cases that expect none, and an outcome case or a
reason in that test's list of skills without one. The test fails until all
three are done.

## The projects the agent starts in

- **A project with the kit** is made by `scripts/create-project.mts` as each
  run starts, so it is the project this revision produces.
- **A project without it** is the small monorepo in
  [`fixtures/plain-project`](fixtures/plain-project).
- **The review's project** is a project with the kit, then the case's
  `change.mts`. If the starter no longer has the line the change follows,
  the change fails, the run scores 0, and `pnpm test` fails too.
- The two creation cases and the Python one start in an empty folder.

`fixture.sh` is bash because the harness runs nothing else; the test allows
only the two commands above and the one that runs `change.mts`.

## Why no case gives the agent a shell

A run that grants `Bash` fails on this repository's Mac before the command
starts: "the command line plus environment exceed the OS exec argument limit
(E2BIG) … The Bash sandbox profile adds 1838 filesystem deny paths to every
command". It did so with and without a grant to reach the npm registry, on
Claude Code 2.1.296, on 2026-10-16. The run then ends with no error recorded,
so it reads as a failed case. Until a shell works, an outcome case grades the
command the agent names, not the result of running it.

## Results

| Date | Suite | Model | Result |
|---|---|---|---|
| 2026-10-13 | trigger | Claude Sonnet | 39 of 39 runs, $2.87 |
| 2026-10-16 | trigger | Claude Haiku | 39 of 39 runs, $0.24 |
| 2026-10-16 | outcome | Claude Sonnet | With the plugin 3 of 3 for each case. Without it: creating 0.11, extending 0.50, the review 1.00. $1.14 |
| 2026-10-16 | Codex trigger | Codex's default | 30 of 39 runs. See below |

**The review scores the same without the plugin.** All seven runs without it
reported the average as belonging in the core. In the one whose trace was
kept, Sonnet read the component and a few lines of the core, and never opened
the project's review questions. A starter whose code shows where things go makes this problem
easy to see. A case where the skill's questions find what reading alone does
not has not been written.

**Codex works from the project before the plugin.** Unlike a
`claude plugin eval` run, a Codex run reads the project's `AGENTS.md`. The
nine failed runs:

- **The add-on requests** (end-to-end tests, CI security checks): 4 of 6
  runs never opened the skill or the installer. All four read `AGENTS.md`,
  and planned to build the add-on themselves: a `packages/e2e` package, or
  new steps in `.github/workflows/ci.yml`. `AGENTS.md` says nothing about how
  an add-on is installed.
- **The review requests**: 4 of 6 runs read the project's own
  `tools/arch/docs/review.md` instead of the skill. That is the same seven
  questions, so the review was the same.
- **One diagram**: 1 of 3 runs loaded `documenting-architecture`.

The cases that do not start in a project with the kit passed every run.

### Proof that they can fail

Each was run against a skill made worse on purpose, then the skill was put
back:

| Change | Case | Result |
|---|---|---|
| `extending-a-project` given the description it had before 0.13.1, which named three add-ons of nine | `trigger-extend-ci-security` | Loaded in 0 runs of 3 |
| `reviewing-architecture` described as for "any code … in any project" | `trigger-none-plain-review` | Loaded in 1 run of 3, where it should load in none |
| `extending-a-project` spelling the option `ci-security --renovate` | `outcome-extend-command` | The command graded wrong in 3 runs of 3 |

The first is the fault these evals were written for, reproduced. The second
shows the cases that expect no skill are the weaker half: a description that
claims too much was caught once in three. With one grader given an
expectation no run can meet, the command exited 1.

## What these do not show

- **What happens when the command runs.** No case has a shell (see above).
- **`documenting-architecture` once loaded.** No outcome case.
- **A session in a real project on Claude Code.** A `claude plugin eval` run
  loads the plugin and nothing else: no `CLAUDE.md`, no project settings, no
  other plugin. The Codex runs show what a project's own instructions can do
  to which skill is reached for; a session where other plugins' skills
  compete for the same request is not covered.
- **Claude Opus, or any other model.** `--model <name>` runs one.
