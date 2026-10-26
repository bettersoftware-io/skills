# The kit in an existing project: condo-ledger before the plugin, 2026-10-25

The first time an agent with the plugin was watched adding the architecture
gates to a project that was not made by it. The project is condo-ledger as it
was before the plugin; the owner's own adoption of the kit, on 2026-10-11, is
the reference.

## Setup

- A copy of condo-ledger at `b7a88de` (2026-06-20): about 16,000 lines of
  TypeScript in a web app (`apps/web`, React, TanStack Table) and three
  packages (`domain`, `application`, `db` on Drizzle and Postgres), on pnpm 9,
  vitest 2 and TypeScript 5. Every commit after it, and every other ref, was
  removed from the copy, so its history held nothing of the adoption. It had
  no remote.
- The repository's untracked `old/` folder, the legacy database dump the seed
  data is generated from, was not in the copy. In the owner's checkout it is
  there, untracked. This mattered (see below).
- One interactive Claude Code session: Opus 5.5 at high effort, no setting
  file loaded (`--setting-sources local`, so none of the owner's own plugins or
  rules), the plugin from a clean checkout of this repository at `b80519e`
  (0.21.4), permission prompts off, `git push` and `gh` refused. The owner
  answered its questions.
- The first message, from the owner: "I'd like this project to follow the
  bettersoftware-skills architecture rules. Add its architecture gates to
  it."

## What the session did

The test ran from 19:42 to 22:43 UTC: three hours, with six subagents for the
largest step. Each step ended with a report and a question, and the owner said
yes to each.

| Step | What it did | Asked |
|---|---|---|
| 1 | Loaded `extending-a-project`, installed the kit. 20 findings, most from the example `architecture.config.mts`. Proposed a role for each package in a table, with the reason | Roles, and whether to take the templates |
| 2 | Wrote the roles: `domain` as the domain, `application` as the core (types only), `db` as an explicit package only the web app imports, `apps/web` as the client with `src/runtime` as its composition root. Scripts, the Node floor, pnpm pinned by hash, ESLint and dependency-cruiser installed, `AGENTS.md` written for the project. 147 gate findings, 2,882 lint errors | Whether to go on with the toolchain and the lint autofix |
| 3 | vitest 2 to 5, which needed vite 7 and its React plugin; the format-lint add-on (Biome) and its fix over 266 files | Formatting: add Biome, or commit the autofix as it was |
| 4 | Restructured `apps/web` into `src/app` and `src/ui`, moved its mock store and its recompute engine into `@cl/application`, put every test id in one file, moved a toast's timer into the core. Gate findings 143 to 17 | Go-ahead for the restructure ("a design change rather than a mechanical one") |
| 5 | Broke the db schema's import cycles by regrouping the files: reference, master data, leftovers, one core file. `drizzle-kit generate` showed no schema change | Regroup, or leave the 17 findings |
| 6 | Asked to fix everything left: six subagents on disjoint files. 835 UI tests rewritten through 39 page objects, the data port declared as one 52-method `DataSourcePort` with a contract of 39 cases (which failed on 4 breaks planted in a store), braces, a `#/` import alias (which needed TypeScript 6 and 7), keyboard-reachable rows, no suppressions | TanStack's `useReactTable` against `react-hooks/incompatible-library`: replace it with a small tree table of its own, suppress the line, or leave it red |

At the end of step 6: gate findings 147 to 0, ESLint 2,882 to 1, Biome 1,397
to 0, 23 commits, 585 files, about 41,000 lines added and 11,000 removed.
After each commit every existing test gave the same result as on `main`, test
for test, compared against a fresh checkout.

`gate:full` never passed. Two things kept it red:

- The web app's typecheck, build and 38 test suites need a seed file
  generated from the untracked `old/` dump, which the copy did not have. The
  README said the file was committed; it never had been at that commit. The
  session said so, asked for the dump, and raised that it holds real
  residents' data before committing anything made from it.
- The one TanStack finding, which it put to the owner instead of switching
  the rule off, as the kit asks.

### Where the test stopped

The next morning the owner answered a question about the dump by pointing to
the real checkout. The session read it, saw that its copy was 259 commits
behind and that the kit was already installed there, and stopped. It said it
should have compared the copy with the owner's checkout before starting. From
there it worked on the real repository at the owner's request (condo-ledger
#38, an add-on update and a fix to where the dump is read from), which is not
part of this test. The copy, with its 23 commits, was deleted at the owner's
request on 2026-10-26; the transcript remains.

## Compared with the owner's adoption

| | The owner, 2026-10-11 | The session |
|---|---|---|
| The approach | Moved the project onto the starter: the starter's packages in, the prototype web app archived, `@cl/application` dropped, `domain` moved onto the starter's layout | Kept the layout it found and refactored it until the gates passed |
| The size | 18 commits in under two hours (16:45 to 18:33), after a written plan, with a merge log | 23 commits, 585 files, in three hours |
| Package roles | The starter's roles, with `db` as a leaf and a new `legacy-import` package | `application` as the core, `db` explicit, `apps/web` the client |
| The db schema cycles | Regrouped into `reference`, `masterData`, `leftovers`, `condominium` | Regrouped the same way, unprompted: reference, masterData, leftovers, core |
| The seed | Generated, pseudonymised and committed; `/old/` ignored as personal data | Could not be made; raised the personal data before committing anything |

Both are answers to the request. The session's was never offered the other:
`extending-a-project` does not say that moving onto the starter is a way to
adopt the kit, and the session did not weigh it. Whether its result was one
to keep was not decided, because the real project had moved on.

## What this shows

- **The roles were proposed with reasons and decided by the owner.** The
  skill's rule that roles are the user's held, and every large step was
  asked before it was made. No rule was switched off.
- **Adopting the kit is all or nothing.** The gates and the lint have no way
  to accept the findings an old codebase already has and hold only new code
  to the rules. The session said so ("the kit has no exemption for them"),
  and the only way to green was to fix all of it: 147 gate findings and
  about 4,300 lint findings, most of the 585 files.
- **`extending-a-project` gives one path.** It installs and lists what is
  left; it does not lay out the choices for a codebase that was never held to
  the rules (fix in place, adopt the starter and move the code in, or accept
  the findings for now) with what each costs.
- **The `package-scripts` gate forced a toolchain upgrade.** It demands
  `--no-fsModuleCache` on every vitest script, and vitest 2 rejects the
  flag, so the session moved vitest to 5 and vite to 7 before the gate could
  pass. The gate does not say what to do on a vitest without the flag.
- **Smaller:** a domain with no ports could only be declared by
  `ports: undefined`, relying on how defaults merge; the project's
  `.gitignore` excluded `.claude/`, so the hook settings would not have been
  committed; the `AGENTS.md` template describes the starter's example code,
  so it was written anew.
- **Mistakes, each caught and corrected by the session:** one commit deleted
  types nine files still used (a `git grep` pattern that does nothing on
  macOS), and two subagents wrote to one scratch folder, so the session
  regenerated its baselines from a fresh checkout before the final
  comparison.

## What this does not show

- **Whether the result was one to keep.** The copy's code was obsolete
  against the real project before anyone judged it.
- **The run without the dump.** The copy lacked an untracked folder that the
  real checkout has, so `gate:full` could not pass for a reason of the test's
  own making.
- **The test was not blind to the end.** The owner's pointer to the real
  checkout ended it at the point the session would otherwise have gone on to
  the TanStack table.
- **One project, one model, one run.** Without a second run there is no
  telling how often an agent takes the in-place path.
