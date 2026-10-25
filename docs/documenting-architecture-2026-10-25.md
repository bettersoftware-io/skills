# Documenting architecture: with and without the skill, 2026-10-25

The first runs of `skills/documenting-architecture` from its first step: the
same request, four fresh sessions, two with the skill and two without. A
fact-check of each finished set then measured what was left wrong in it. The
[record of 2026-10-11](documenting-architecture-2026-10-11.md) says how the
skill was written.

## Setup

- Headless Claude Code 2.1.310 (`claude -p`), Claude Opus 5.5 at high
  effort, one fresh session per run, all four started at once.
- The codebase: a copy of
  [skills-demo](https://github.com/bettersoftware-io/skills-demo) at
  `975461b`, about 35,000 lines of TypeScript, with no `docs/architecture/`
  and nothing installed. A project made with this plugin, so it has the kit
  and its instruction files.
- No setting file was loaded (`--setting-sources local`): none of the user's
  plugins, and not the project's hooks. Every tool was allowed, except
  `git push` and `gh`.
- With the skill: the plugin, from a clean checkout of this repository at
  `b668610`, given with `--plugin-dir`. Without: nothing. A check before the
  runs listed the skill in one and not in the other.
- The same request every time, which names no skill:

  > Analyse this project and write its architecture documentation: a set of
  > documents with the C4 model and the other diagrams that help, as simple
  > as possible, for someone new to the codebase. Nobody will be around to
  > answer questions, so make reasonable choices and finish the work.

## What each run did

| | With 1 | With 2 | Without 1 | Without 2 |
|---|---|---|---|---|
| Loaded the skill | yes | yes | — | — |
| Readers started (step 3) | 4 | 4 | none | none |
| Fact-checkers started (step 6) | 2 | 2 | none | none |
| Its own fact-check | about 350 claims, 12 findings, all applied | 308 claims, 20 findings, all applied | none | none |
| The three checks of step 5 | all pass | all pass | none | diagrams parsed in jsdom with Mermaid 11; the repository's link check; `pnpm install` and `gate:full` |
| Documents, lines, diagrams | 10, 1,879, 28 | 10, 1,809, 28 | 8, 1,279, 21 | 10, 1,108, 19 |
| Existing files changed | none | none | `README.md` (a link to the set) | `README.md` (a link to the set) |
| Time to its last report | about 25 minutes | 21 minutes | 9 minutes | 8 minutes |
| Cost, as the run reported it | $15.92 | $16.24 | $3.62 | $2.73 |

Both runs with the skill loaded it by themselves, worked through its steps
in order, and reported in its shape: where the set is and its commit, the
three checks with their lines, the fact-check's counts, what is unverified,
and where the repository's own documents disagree with the code. Both found
the repository's own check on documents and ran it (`check:doc-links`), and
both listed in the index the places where its documents are wrong: two
sentences of the skill that only single-shot agents had been tried on before.
Neither run without the skill started a reader of any kind.

Without the skill, both runs linked the set from `README.md`. The skill says
to edit no existing file in a repository that is not the user's own. Whose
repository this was, the request did not say.

## What was left wrong

Each finished set was given to two more fresh sessions, half the documents
each, with the fact-check brief of
[`briefs.md`](../skills/documenting-architecture/briefs.md) word for word.
They had `Read`, `Glob` and `Grep` and nothing else.

| | With 1 | With 2 | Without 1 | Without 2 |
|---|---|---|---|---|
| Claims checked | about 363 | 326 | 273 | 269 |
| Wrong | 0 | 2 | 4 | 1 |
| Misleading | 7 | 6 | 10 | 13 |
| Stale-risk | 3 | 1 | 2 | 2 |
| Findings per 100 claims | 2.8 | 2.8 | 5.9 | 5.9 |
| Cost of the check | $6.86 | $6.42 | $4.08 | $4.13 |

Four of the seven "wrong" findings were compared with the source by the
session that wrote this: both of With 2's, and one each of the two sets
without the skill. All four held:

- With 2: the overview says the client's composition root reads two
  environment variables in `buildPorts.ts`. `startApp.tsx:30` reads them and
  passes them in.
- With 2: the `package-scripts` gate is described as excusing an e2e package
  from a `test` script. It fails one that has it
  (`tools/arch/gates/lib/package-scripts.mts:120`).
- Without 1: "most of the files in the repository are those checks, in
  `tools/`". `git ls-files tools` gives 183 of 411.
- Without 2: "an agent cannot finish with the gate red". The stop hook lets
  the second stop through (`tools/arch/hooks/before-stop.mts:107-109`).

## What this shows

- **The skill's step 6 happens unprompted.** Both runs that had the skill
  started two fact-checkers after writing, applied every finding and ran the
  checks again, with nothing in the request about checking.
- **About half as much is left wrong afterwards:** 2.8 findings per 100
  claims against 5.9, in both pairs alike. Fewer are plainly wrong: two in
  about 690 claims, against five in 542.
- **It costs about four times as much and three times as long:** about $16
  and 21 to 25 minutes, against about $3 and 8 to 9 minutes. Most of it is
  the four readers and the two fact-checkers.
- **The sets with the skill are longer**, about 1,800 lines and 28 diagrams
  against 1,100 to 1,300 and about 20, so there is more in them to be wrong,
  and still less is.

## What this does not show

- **The judge is the skill's own brief.** The sets with the skill had already
  been through it once, by a session of the same model. A check by another
  method, or by a person, might find what that brief misses in both.
- **Two runs a side, one codebase, one model.** The codebase is small and was
  made by this plugin, with its own instruction files.
- **One session did not end.** With 1 gave its last report at 13:59 UTC and
  its process was still open, writing nothing, eleven minutes later. It was
  stopped. Its documents and its report were complete.
- **Steps 7 and 8 were not judged.** Both runs built the reading copy and
  reported; whether the page reads well was not looked at.

The four sets, the logs of the eight sessions and the scripts that ran them
were kept outside this repository, in the session's scratch folder, and are
not published.
