# Status: pending work

What is not done yet. Finished work is removed from this page, not archived;
the test records in this folder and the git log say what was done.

**Last updated: 2026-10-25**

## Waiting on something outside this repository

- **`bettersoftware-io/skills-visual-proof` is still on GitHub.** It drew the
  `linux-x64` goldens of 0.20.0 on 2026-10-24
  ([the record](visual-update-2026-10-17.md#inter-and-a-stale-section-2026-10-24))
  and is public, with nothing in it but a created project. The session's
  token lacked the `delete_repo` scope. A person runs
  `gh auth refresh -h github.com -s delete_repo`, then
  `gh repo delete bettersoftware-io/skills-visual-proof --yes`.

- **The starter's server uses `rx-ws-effects`.** It is a plain imperative
  handler today. The package
  ([bettersoftware-io/rx-ws-effects](https://github.com/bettersoftware-io/rx-ws-effects))
  is on npm since 2026-10-25, 13:05 UTC, as `@better-software/rx-ws-effects`
  0.1.0 (tag `v0.1.0`). pnpm refuses a version younger than 24 hours, so this
  can start from 2026-10-26, 13:05 UTC.

## Seen on GitHub only in part

The add-ons' workflows ran in
[bettersoftware-io/skills-demo](https://github.com/bettersoftware-io/skills-demo)
on 2026-10-05, on pushes to main and on a pull request
([the record](github-run-2026-10-05.md),
[the feature run](demo-feature-2026-10-05.md)). What that did not cover:

- **`ci-security` has run on GitHub with everything passing only.** In
  skills-demo on 2026-10-06: workflow lint and `pnpm audit` on a pull request
  and on main, Dependency Review on a pull request, Scorecard on main, and
  Dependabot's update runs (four, all green, no pull request opened yet). On
  2026-10-14 Dependabot opened one for the actions (skills-demo #11, every
  check green), and its npm run failed, as under every project's Node floor.
  Not seen: Dependency Review refusing a pull request for an advisory or a
  licence, and what Scorecard's findings look like in the repository's
  code-scanning page.
- **The weekly tag workflow and the changelog writer have not run on
  GitHub.** In skills-demo on 2026-10-25
  ([the record](changelog-2026-10-24.md#on-github-2026-10-25)) the release
  workflow was skipped while `CHANGELOG_RELEASES` was unset, and on a pull
  request; once set, it waited for a tag; `changelog tag 2026-W42 --apply`
  made a tag dated 2026-10-19T00:05:00Z; a run by hand then published the
  release
  [2026-W42](https://github.com/bettersoftware-io/skills-demo/releases/tag/2026-W42).
  Not seen: `weekly-tag.yml`'s first scheduled run (Monday 2026-10-26, 00:05
  UTC: the W43 tag and its issue), a release made by a merged entry whose tag
  already exists, and a run of the writer (the headless agent with no write
  token; `CHANGELOG_WRITER` is unset).
- **The changelog reminder did not appear in Codex.** `codex exec` 0.164.0, with
  a week due, answered from the skill's description and showed no hook line.
  The hook was not trusted with `/hooks`, which is interactive, so that is the
  likely reason; whether it fires once trusted is not known. Not seen either:
  the reminder in an interactive Claude Code session.
- **Dependency Review fails until the repository's dependency graph is on.**
  Seen: "Dependency review is not supported on this repository". The add-on's
  README lists the setting; `gh api -X PUT repos/<owner>/<repo>/vulnerability-alerts`
  switches it on.
- **Seen on GitHub in skills-demo on 2026-10-06, all passing:** Node 26
  through `setup-node`, the pinned Corepack script (in the container jobs
  too), the pnpm store cache, `e2e.yml` in the Playwright container, and the
  Linux goldens unchanged by the compiler and the CSS tokens. Not run: the
  weekly tag workflow of `agent-workflow`.
- **The job that creates a project with every add-on has not run on GitHub.**
  It is new (2026-10-06): all nine together, under the long scope and under
  `@zeta`, with `gate:full` and the e2e specs. The same steps pass locally on
  macOS.
- **The `e2e` add-on's host job has not run on GitHub.** A mode that says
  `host: true` runs in a job of its own on the runner, with an `env`
  function that reads a running stack (added 2026-10-16). Proven on macOS
  arm64 only, in a project created with `--with recommended,e2e`: a host
  mode whose function read a server's address from what a script printed,
  `--where host`, `--where container` (on the Mac, not in the image) and no
  flag. Not seen: the job on `ubuntu-latest`, its
  `playwright install --with-deps chromium` (the command this repository's
  CI already runs for a created project), Docker and a real database behind
  a host mode, and the container job's `--where container` in the image.
  The first run on GitHub will be Origamic's `stack` mode against a local
  Supabase.
- **The visual add-on's browser counts of a real regression were taken on
  darwin-arm64 only.** The up colour and a one-pixel shift failed every
  scenario that shows them (108 pixels or more in Inter, 2026-10-24,
  thirteen times the budget). On linux-x64 only the noise was measured (five
  runs, byte-identical).
- **Nothing here has run on Linux outside GitHub's CI,** and nothing through
  a real `docker build`. The Dockerfile check was compared with BuildKit's own
  parser, built from source; the `e2e` workflow and its container have not run.
- **The shipped Renovate config has opened one wave.** On 2026-10-19, in
  condo-ledger and origamic: "actions" passed in condo-ledger (#17, merged),
  and pnpm installed every lockfile it wrote. "minor and patch" moved
  Playwright's package without its image, and `playwright-pin` failed it;
  0.19.1 gives Playwright a group of its own, read from the image too. The
  next wave, on 2026-10-26, is the first under that rule, in all four
  repositories: skills-demo was given the app on 2026-10-25 and has its
  Dependency Dashboard (skills-demo #16). In this repository the app ran no
  job inside "before 6am on monday" and opened nothing; the schedule is now
  the whole of Monday.
- **An update has not yet kept a bot's action versions in a real project.**
  Since 0.20.2 a workflow whose only changes are moved action commits
  (`uses: …@<commit> # <version>`) takes the add-on's new copy, at the newer
  version of each action, where it used to be refused. condo-ledger's
  `ci-security` update refused `ci-security.yml` and `scorecard.yml` on
  2026-10-24, after Renovate's actions pull request (#17); its next update
  should take both. A project installed before 0.20.2 has no record of its
  workflows without their refs, so until one update has run, a workflow
  whose template changed as well is still refused. The Playwright image of a
  workflow is not compared this way: Renovate moves it with the package, and
  an update puts back the add-on's.
- **No run where the coverage gate fails has been seen.** The report is meant
  to publish then too.
- **The motion audit had nothing to judge.** The starter has no animation, so
  the audit skipped, on GitHub as locally. Whether Chromium in the CI image
  gives the same compositing verdicts as on macOS is still unknown.

## The documenting-architecture skill

Added on 2026-10-11 ([the record](documenting-architecture-2026-10-11.md)).

- **It has been run from its first step once: two runs a side, on one
  codebase** ([the record](documenting-architecture-2026-10-25.md),
  2026-10-25). Both runs with the skill fact-checked their set unprompted,
  and a second check of the finished sets found 2.8 findings per 100 claims
  with it and 5.9 without, at about $16 a run against $3. The judge was the
  skill's own fact-check brief, which the sets with the skill had been
  through once already. Not tried: a judge by another method or a person, a
  larger codebase or one the plugin did not make, another model.
- **Three sentences were tried and left out.** A line on quotations in the
  fact-check brief, a line on re-reading a figure from a repository's own
  documents, and a line on re-counting step numbers. Agents with the skill as
  it was did each small task right, two of two. The tasks were small: the
  record says what was not tried.
- **The widths `check-diagrams.mts` names come from one Mermaid on one
  machine.** Mermaid 11.4 and 12.1 disagreed on which way three of four
  diagrams were narrower. What the page that shows the set draws is not known
  until it is looked at there.
- **Not run in Codex.** The skill starts subagents for the readers of steps 3
  and 6, and says what to do when none can be started; that branch is untried.
- **The scripts ran on one machine:** macOS arm64, Node 26.11.1, with the
  headless-only Chromium that Puppeteer had already downloaded, and once with
  the whole Google Chrome. Linux and Windows are untried, and their lists of
  browser paths in `lib/tools.mts` are not from a run.
- **This repository's CI neither fetches the tools nor starts a browser.** The
  tests give `ensureToolset` a fake `npm` and `checkDiagrams` a fake renderer.
  A job that runs `check-diagrams.mts` on a fixture would cover the real path:
  `ubuntu-latest` has Chrome, and the fetch needs the npm registry.
- **The toolset is installed with `npm`, not `pnpm`,** from a lockfile of its
  own, into a cache folder. It is the one place here that does not go through
  the pinned pnpm, and pnpm's rule against a release younger than a day is not
  applied to it. The three versions were 3 days old or more when pinned;
  nothing checks the next change.
- **Nothing tells a person that the cache holds an old toolset.** A changed
  lockfile is fetched into a new folder, and the old one (about 230 MB) stays
  until it is deleted by hand.
- **`check-cited-paths` judges by the first part of the path.** In a
  repository that has a top-level `docs/`, a chapter that writes
  `` `docs/architecture/` `` as an example of where a set goes is a finding.
  `--except` is the way out, and the skill's own text trips it in this
  repository.
- **The reading copy was looked at in Chromium only.**
- **The reading copy has no Content-Security-Policy.** What keeps a hostile
  document from running script is that its hand-written HTML is shown as text
  and its unsafe links lead nowhere. A policy would be a second wall, and
  needs the page's own script moved out of the page first; whether `'self'`
  holds for a page opened from disk in each browser is not known.
- **What is a tag in the reading copy is two lists, kept by hand:** the bare
  tags a document may write, and the tags the converter writes
  (`onlyKnownTags` in `lib/page.mts`). They were tried against one hostile
  document of 24 attacks, and have not been fuzzed. Two reviews in a row
  found a way to run script, so a third way is likely. A changed version of
  the converter that spells a tag another way would not be unsafe: its tag
  would show as text, in every page, and nothing here would say why.
- **The hostile document does not run in CI.** `hostile.test.mts` needs the
  fetched tools and a browser, and CI has neither, so there it is skipped
  (it says so in its name). The tests that do run in CI use a stand-in
  converter, which is how the three faults of 2026-10-11 were missed.
- **A link is safe by this code's reading of its scheme.** The hostile test
  asks the browser how it reads each link, in Chromium only.

## Dated

- **`ubuntu-latest` moves to Ubuntu 26 between 19 October and 19 November
  2026** ([actions/runner-images#14748](https://github.com/actions/runner-images/issues/14748)).
  Decided on 2026-10-16: the workflows move with the label, none is pinned.
  A trial on `ubuntu-26.04` the same day passed: this repository's CI,
  16 checks of 16 (skills #40), and in skills-demo every workflow a pull
  request runs (skills-demo #13). The one failure there was actionlint
  1.7.12, which does not know the label `ubuntu-26.04`; only a workflow
  that pins it meets that. Not run on Ubuntu 26: `scorecard.yml`,
  `update-visual-goldens.yml` and `weekly-tag.yml`, which no pull request
  starts. Look at the first runs after the switch.

## Next, with no plan yet

- **The React Compiler check of an explicit package does not read a build's
  `exclude`.** Since 0.20.3 an explicit package that declares
  `reactCompiler: true` is checked against every package with a
  `vite.config.ts` that depends on it, and each must run the compiler. A
  build that runs it with an `exclude` naming the package's folder (Origamic's
  web app excludes `packages/runtime` that way) still passes.

## Open decisions

- **Nothing says when a new pattern earns a row in the `AGENTS.md` table.** The
  `agent-docs` gate fails on a row that points at a file that is gone; it
  cannot know that a row is missing. In the REST run the agent built a new
  kind of port with no row to copy and nothing went wrong, so no rule is
  written yet.
- **Coverage is measured per package, by that package's own tests.** A file
  only exercised from another package's test reads 0%, and the tests in an
  integration package credit nothing (it reads `SKIP`: no file to measure).
  Merging across packages would credit them, and is not built.
- **Nothing checks that the core reaches the clock through a port.** In the
  Codex run a presenter read `new Date()` directly. A check for `Date` in the
  domain and the core is decidable from source, and does not exist.

## Not tried

- **The commands `/workflow:status`, `/workflow:docs`,
  `/workflow:worktrees` and `/workflow:perf-audit`, in a session.** They are
  text, and tests hold their form: a description, the tools they may use,
  step 0 where an add-on is needed, scripts that exist. No session has been
  run with any of the four. `pnpm worktree:audit` itself was run against two
  real projects; no agent has been watched to act on its report.

- **The shipping rules of `agent-workflow`, when something goes wrong.** One
  session read them cold and followed every step on a one-word change ([the
  add-on's README](../addons/agent-workflow/README.md#not-verified)). Two
  sessions merging at the same time, a red check, a conflict and a failure
  on main after the merge have not been watched.

- **A feature that touches more of the app:** sign-in, routing. The hardest
  test so far (users and categories with create, edit and delete, over REST)
  added a second transport and forms, but no navigation and no session.
- **`extending-a-project` in a Codex session that can write.** The other two
  are checked there ([the record](codex-test-2026-10-04.md)). Read-only runs
  load it in 12 runs of 12 since 0.16.0, 7 of 12 before
  ([the evals](../evals/README.md#results)).
- **A model between the smallest and the frontier.** Claude Haiku 4.5 has been
  tried ([the record](small-model-2026-10-05.md)). Claude Sonnet has only been
  asked which skill it loads and which command it would run
  ([the evals](../evals/README.md)); it has built nothing.
- **An eval that runs what the agent decides.** The outcome cases grade the
  command the agent names, not the project after it runs: no eval run here
  can have a shell (see Known limits).
- **A review case the skill makes a difference to.** The planted average is
  found in every run without the plugin as well.
- **The evals on Claude Opus, three runs a case.** Once a case, Opus passed
  every trigger case and, with the plugin, every outcome case.
- **The kit in a real existing project.** The script sets up the files and says
  what is left. Declaring each package's role, and deciding what to do with the
  findings on code that was never held to these rules, is judgement nobody has
  watched an agent do.

## Known limits

- **A project made before 0.20.0 draws no bold text on `linux-x64`.** In the
  pinned Playwright container `system-ui` comes out at one weight
  (skills-demo's goldens, and the shipped set of 0.19.0). The starter now
  serves Inter, and its Linux goldens are bold; an update gives an existing
  project no font, only the release note that says how to serve one. Not
  looked into: which face fontconfig picks there.
- **An eval run that grants a shell fails on this Mac.** Claude Code 2.1.296
  builds a sandbox profile of about 1,840 deny paths (1.7 MB) for every
  command, over the OS limit (E2BIG), so the shell never starts. The run ends
  with no error recorded and reads as a failed case. Seen on 2026-10-16, with
  and without a network grant; not tried on Linux, where the sandbox is
  bubblewrap ([the evals](../evals/README.md#why-no-case-gives-the-agent-a-shell)).
- **Every eval run fails in a checkout with the starter installed in it.**
  With the starter's own `node_modules`, `.turbo` and `dist` under
  `starter/`, about 13,000 git-ignored files, Claude Code 2.1.301 cannot
  start a run: `E2BIG: argument list too long, posix_spawn`, score 0, no
  cost. Installing the starter in a clean worktree made it fail, and
  `git clean -fdX starter` made it pass, on 2026-10-16; reported to Claude
  Code. `pnpm evals:trigger` and `pnpm evals:outcome` now stop first and name
  that command ([the evals](../evals/README.md#running-them)); a run started
  some other way, `claude plugin eval .` by hand, still fails.

- **No command that `pnpm repo:settings` prints has been run.** The
  `ci-security` add-on's command reads a repository's settings and prints,
  for each one that is off, the `gh api` command that switches it on. It
  never runs one, and neither did its tests or its runs against GitHub on
  2026-10-12. The body of the ruleset it prints holds the fields GitHub's
  published API description requires; GitHub has not been sent it.
- **The `agent-workflow` hook has not run in front of a person.** It ran
  headless on 2026-10-13 under Claude Code 2.1.296 and under Codex 0.162.1:
  each read its refusal of a chain, and under Claude Code its question
  stopped a push with a colon that an `allow` rule let through without it
  ([the add-on's
  README](../addons/agent-workflow/README.md#in-a-live-session-of-claude-code)).
  Not watched: the prompt of an interactive session, and Codex asking a
  person to trust the hook. Still from the documentation: that a hook that
  crashes or times out does not block.
- **The hook tells Claude Code from Codex by `turn_id`**, which only Codex
  sends, and gives its question to Claude Code only: Codex 0.162.1 calls
  `ask` unsupported. If Claude Code comes to send a `turn_id`, the hook goes
  silent there and nothing fails.
- **A project that had `Bash(git push *:*)` keeps it after an update.** The
  merge removes no rule, so Claude Code goes on warning about it at each
  start until a person deletes it. `pnpm agent-workflow:check` names it. The
  installer can retire a hook's command line and a file, and not a rule.
- **The `agent-workflow` hook and the host can still read a command
  differently.** A review on 2026-10-13 ran Claude Code 2.1.296's own
  matching against the hook and found five ways past it; all five are closed
  and tested ([the add-on's
  README](../addons/agent-workflow/README.md#a-review-against-the-hosts-own-matching)).
  What the hook looks past (`nice`, `timeout`, `xargs` and the rest) is a
  copy, by hand, of what that version of the host looks past, and so is the
  list of tools that run a shell command (`Bash`, `Monitor`). A later version
  that looks past another word, or gains another such tool, opens the gap
  again, and nothing here fails when it does. What would close it is a check
  that reads those two lists out of the installed host and compares them with
  the hook's. Not built: the host is one minified program, and the lists
  would have to be found in it by their shape.
- **A second review named the hook's reading of a command.** A security
  review of the add-on as a project got it (2026-10-12) named `outward.mts`,
  `shell.mts` and the hook for letting through a command they cannot read
  and for ways past the chain detection, with no detail. The first is the
  choice the add-on's README states. A review on 2026-10-24 gave the detail
  of the second: places where the reader read a command otherwise than bash
  (`$'…'`, an unquoted heredoc's body, `${…}`, and more of that kind found
  with them), closed in 0.20.4 ([the add-on's
  README](../addons/agent-workflow/README.md#a-review-against-the-hosts-own-matching)).
  The reader is still compared with bash by hand, case by case, and not with
  a shell's own parser over generated commands.
- **Whether that hook is registered is judged by a reading of each host's
  matcher rules** (`hook-registration.mts`, in the installer and in the
  add-on's check). A security review of the last commit named that file for a
  possible difference from the hosts, with no detail; not followed up. The
  cost of a wrong "registered" is a joined command that gets one prompt, not
  an unprompted push: the host's own permission rules are untouched.
- **`lib/outward.mts` knows git by the last part of a `/` path only.**
  `isGit` does not take `git.exe`, or a path written with backslashes, for
  git, so a push started that way is not seen as an outward step.
- **Two eval-depth mutants survive only under load.** "is refused when evals
  are nested inside one another too deep" and "… too deep (the count goes
  down the evals)" survived the full run of the add-on's 961 mutants on
  2026-10-24. Run alone the same day, both were killed.
- **The stop hook judges the checkout the session stops in.** A session that
  changed two checkouts is held to one. That `cwd` in the payload follows the
  agent into a worktree is from the documentation.
- **Two sessions that stop at the same time may each be told the gate is
  red.** Seen once, on 2026-10-13, in a project two sessions were working in.
  The stop hook's `pnpm gate:full` failed at the coverage stage with "vitest
  wrote no coverage summary" for one package of eight, on a commit that was
  green in CI. That package's tests passed when run alone, and the gate
  passed when run again with nothing changed. The likely cause, which was
  not proven: each session's stop hook runs the gate in the project's own
  checkout, and vitest empties a package's `coverage/` folder when it
  starts, so one run takes away the summary the other is about to read. The
  two runs were not caught overlapping. Nothing keeps two gates from running
  in one checkout at once, and the hook then says "red", not "run again".
- **The stop hook's nine-minute limit is tested with short limits only**, on
  the same code path.
- **The quiet gate copies the environment pnpm 12.6 gives a script.** A later
  pnpm may set more; the test that compares the two runs would show it.
- **An update says a thing once.** A changed template, a file compared with a
  template the project never had a copy of, a starting file it lacks, the
  list of all gates for a project that kept none: each is said by the update
  that finds it. `add-to-project.mts <project> --compare` shows where the
  project's own files stand at any time.
- **A project that did not start from the starter gets long differences on
  its first kit update**: its `package.json` and its workflow share little
  with the starter's. Each is cut at thirty lines.
- **The stop hook's memory of a green tree covers the files git does not
  ignore** (and the `.env` files it does). A source file that git ignores
  can change without the hook noticing: the gates do judge that file when
  they run, but the hook may not run them. CI is the check that cannot be
  talked round, as below for the record itself.
- **A file in a hidden folder at the project root is not linted** (ESLint,
  the typed lint, Biome, the CSS lint, the doc-link check; `.github`,
  `.claude`, `.codex` and `.agents` are still read where they were). And
  nothing stops a package from importing out of one: tried on 2026-10-06, a
  file in `packages/domain/src` that imports `.plugin/state.ts` from the
  project root passes `pnpm gates`, `pnpm lint` and `pnpm typecheck`.
  dependency-cruiser's rules here are about packages, and say nothing of a
  file in none.
- **Biome, the CSS lint and the doc-link check leave out what `.gitignore`
  names**, as before 2026-10-06. A file in a package that a `.gitignore`
  names is passed over by those three. ESLint, the typed lint and the gates
  judge it.
- **The `typescript-only` gate walks the whole project.** A stray `.js` file
  in a folder such as `.remember/` fails it. A `.ts` file there fails
  nothing.
- **The `performance` add-on's static check and the `visual` add-on's server
  check walk the project by their own closed lists.** Neither was looked at
  for stray root folders.
- **`e2e`'s 210 mutants were not all run again.** The 18 that the host and
  port added or rewrote were, the 44 that a mode on the host added, rewrote
  or moved were (2026-10-16), and the 14 application mutants were.
- **Without `format-lint`, nothing bans an import that climbs two folders.**
  The ban is Biome's; ESLint has no twin of it.
- **`allowBuilds` names esbuild, which nothing in the starter installs** (Vite
  8 builds with rolldown). It is there for the first dependency that brings it.

- **A new project's formatting depends on its scope's length.** The starter is
  written with `@app`; a longer scope pushes some import lines past the
  formatter's width. So `format-lint` asks for `pnpm fix` to be run once after
  installing (`firstRun`), and the scripts print it under "Next". Until it is
  run, `biome:check` fails on a project with a long scope.
- **`strict-lint`'s knip settings are held for each add-on alone and for all
  nine together, not for the combinations between.** One finding appeared
  only with `visual` and without `performance`.
- **A file with no export inside a library package is never reported as
  unused** by `strict-lint`: the package's exports map makes every source file
  an entry.

- **Where a port cannot be opened, the tests that need one are skipped, not
  run.** The gate is green there with a `SKIP` line, and the coverage of those
  packages is not judged. The stop hook and CI do run them. A test that opens a
  port and is not named `*.port.test.ts` still fails in such a sandbox, and no
  gate can tell that it should have been named so.

- **In Codex's default sandbox a project is created and not proven.** No
  network, and `.git` and `.codex` are read-only there, so `git init`,
  `pnpm install`, `gate:full` and the Codex hook file are left to the person.
  The script and the skill say so; the README gives the commands.

- **The stop hook does not run the visual tests.** `pnpm visual` is outside
  `gate:full` on purpose, so an agent can still finish with stale goldens. CI's
  `Visual goldens` job is what catches that.
- **The stop hook's memory of a green tree is a file an agent could write,**
  and its hash leaves out what is not a file in the project (an environment
  variable, a tool installed elsewhere). It guards against stopping early; it
  is not a lock. CI is the check that cannot be talked round. A security
  review of the first version found both points; the hash now also covers
  ignored `.env` files and the Node version, and a tree with a nested
  repository is never remembered.
- **The stop hook reads every file git does not ignore, on every stop,** to
  know whether the tree changed. Not measured on a large repository.
- **A stop-hook gate that is cut off at nine minutes may leave its child
  processes running.** The hook stops the command it started, not what that
  command started.
- **"The contract calls the method" is not "the contract tests it".** The gate
  finds a method the contract never calls. A call with no assertion passes.
  A port member typed with a name (`latest: Fetcher`) is not read as a method.
- **The `task-cache` gate reads `turbo.json`; it does not ask turbo.**
  `scripts/check-task-cache.mts`, which does ask, runs only in this
  repository's CI, as the proof that the rule the gate applies is the right
  one.

- **In the starter, the integration example catches nothing its neighbours
  miss.** Eight mutants in the server and the client adapter were each caught
  both by the integration tests and by that side's own tests. It is there as
  the pattern to copy; the case it exists for is a client adapter and server
  routes that are each tested against a fake of the other.
- **The integration example opens a real port**, so an agent cannot run it
  inside Codex's sandbox, like the server's own tests. The stop hook's run of
  them does pass in Codex ([the record](codex-test-2026-10-04.md)).

- **The `typescript-only` gate does not look inside `tools/coverage/`.** The
  kit's file walker skips every folder called `coverage`, since that is where
  reports go. The project's typecheck does cover the folder.
- **`ui-never-imports-adapters` sees a direct import only**, not an adapter
  re-exported through a package index. Closing it by reachability would forbid
  the UI every value import from an index that re-exports an adapter, which is
  a layout the source project relies on.
- **Two links in `tools/arch/README.md` are dead inside a project**: they point
  at files that are not copied.
- **The visual add-on has no theme matrix and no published diff site.** The
  Playwright report, as an artifact, is what shows a failure.
  `pnpm visual:coverage` lists the UI no scenario renders, and nothing gates
  on it. The job summary counts the pictures at each level; no gate holds the
  pyramid's shape.
- **No skill exists for placing logic, adding a port, streaming state or
  testing.** On purpose: one is written when a task fails in a way the gates do
  not catch, and across four feature runs none has.
