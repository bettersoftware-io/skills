# Status: pending work

What is not done yet. Finished work is removed from this page, not archived;
the test records in this folder and the git log say what was done.

**Last updated: 2026-10-13**

## Waiting on something outside this repository

- **The starter's server uses `rx-ws-effects`.** It is a plain imperative
  handler today. The package
  ([bettersoftware-io/rx-ws-effects](https://github.com/bettersoftware-io/rx-ws-effects))
  is not on npm yet, and pnpm refuses a version younger than 24 hours, so this
  starts a day after it is published.

## Seen on GitHub only in part

The add-ons' workflows ran in
[bettersoftware-io/skills-demo](https://github.com/bettersoftware-io/skills-demo)
on 2026-10-05, on pushes to main and on a pull request
([the record](github-run-2026-10-05.md),
[the feature run](demo-feature-2026-10-05.md)). What that did not cover:

- **`ci-security` has run on GitHub with everything passing only.** In
  skills-demo on 2026-10-06: workflow lint and `pnpm audit` on a pull request
  and on main, Dependency Review on a pull request, Scorecard on main, and
  Dependabot's update runs (four, all green, no pull request opened yet). Not
  seen: a Dependabot pull request, Dependency Review refusing a pull request
  for an advisory or a licence, and what Scorecard's findings look like in the
  repository's code-scanning page.
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
- **The starter's `linux-x64` goldens were not redrawn or compared after the
  visual host changed.** No container could be run where the change was
  made. The `darwin-arm64` set matched with both knobs at 0, and the host
  delivers the same state in the same order, so no pixel should move; the
  `Visual goldens` workflow in a project is what will show it.
- **Nothing here has run on Linux outside GitHub's CI,** and nothing through
  a real `docker build`. The Dockerfile check was compared with BuildKit's own
  parser, built from source; the `e2e` workflow and its container have not run.
- **Renovate has only been through its validator.** No repository with the
  app installed has used the shipped config.
- **No run where the coverage gate fails has been seen.** The report is meant
  to publish then too.
- **The motion audit had nothing to judge.** The starter has no animation, so
  the audit skipped, on GitHub as locally. Whether Chromium in the CI image
  gives the same compositing verdicts as on macOS is still unknown.

## The documenting-architecture skill

Added on 2026-10-11 ([the record](documenting-architecture-2026-10-11.md)).

- **The skill has never been run from its first step.** It was written from
  two runs made without it. Steps 5 to 7 were then run once, on a third set
  written without it, by the session that wrote that set: 47 findings in
  about 650 checked claims. Whether an agent that has the skill does the
  fact-check of step 6 unprompted, and what is left wrong in the set
  afterwards, is not known. The test to make is the one the review skill had:
  the same request, several fresh sessions, with and without.
- **Three sentences were tried and left out.** A line on quotations in the
  fact-check brief, a line on re-reading a figure from a repository's own
  documents, and a line on re-counting step numbers. Agents with the skill as
  it was did each small task right, two of two. The tasks were small: the
  record says what was not tried.
- **What an agent says it would do is the only evidence for two sentences.**
  The index's list of where a repository's documents are wrong, and looking
  for a repository's own checks on documents before writing, were each tried
  on a handful of single-shot agents that ran nothing.
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

- **From 19 October 2026 `ubuntu-latest` means Ubuntu 26.** GitHub's notice:
  [actions/runner-images#14748](https://github.com/actions/runner-images/issues/14748).
  Every workflow here uses that label: this repository's `ci.yml`, the
  starter's `ci.yml`, and the add-ons' `coverage.yml`, `visual.yml`,
  `update-visual-goldens.yml`, `perf.yml`, `e2e.yml`, `ci-security.yml`,
  `dependency-review.yml`, `scorecard.yml` and `weekly-tag.yml`. A project
  created from the starter has the same label in every workflow it was given.
  Decide whether to pin a version (`ubuntu-24.04`) or to move with the label.
  Either way, re-run this repository's CI once the change lands. The visual
  and end-to-end tests are the least exposed, since they run inside a pinned
  Playwright container.

## Next, with no plan yet

Found while a project was set up with the plugin, on 2026-10-12 and 13.

- **Five CodeQL alerts nobody has read.** CodeQL default setup was switched
  on for this repository on 2026-10-13 and found them at once. Three of
  "incomplete multi-character sanitization", rated high:
  `scripts/architecture-docs/lib/page.mts:34`,
  `addons/repo-hygiene/files/tools/repo-hygiene/lib/markdown.mts:100` and
  `addons/ci-security/tests/addon.test.mts:138` (a test). Two of "shell
  command built from the environment", rated medium:
  `kit/gates/quiet.mts:213` and
  `addons/coverage/files/tools/coverage/mutation-check.mts:285`. Which are
  true is not known.
- **`pnpm repo:settings` prints a wrong fix while CodeQL is being set up.**
  For the minute GitHub takes to find the languages, the state is
  `configured` and the list is empty. The check says "set up without the
  `actions` language (it has: none)" and prints a command that would set the
  list to `actions` alone. Seen on this repository; the list filled in by
  itself. It should say that the setup is running, and print nothing to run.
- **`pnpm repo:settings` names no check of a job with a `strategy:`.** This
  repository's two matrix jobs make twelve checks, and the ruleset the
  command printed asked for one. A matrix whose values are written out in
  the file could be read. The twelve names were added by hand.
- **Nothing checks `docs/STATUS.md`.** That the page has its six sections,
  that its date moved with an edit, that an entry links a file that exists:
  each is decidable, and `repo-hygiene` already checks the links.
- **Six mutants of `agent-workflow` no longer apply.** The text each one
  looks for is not in its file once, so `mutation-check.mts` cannot run
  them: "creates a host's settings file that is not there", "never merges
  into a settings file that is a link out of the project", "counts a file
  that is not JSON as unmerged", "does not write over the file that took its
  place", and the two that begin "says nothing once". They went stale when
  the installer changed. Nothing fails when a mutant goes stale.
- **Renovate runs here with the default config.** Its "Configure Renovate"
  pull request was merged on 2026-10-13. It has opened two for actions.
  Nothing tells it to leave `starter/` alone, whose versions are tested
  together and held by one lockfile, or to wait a week for a release as the
  add-on's own `renovate.json5` does.

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
- **Dependabot cannot update a project's npm packages.** Its updater runs
  Node 24. The starter's root asks for `>=26` in `devEngines.runtime` with
  `"onFail": "error"`, and the `node-floor` gate holds it there, so pnpm
  stops with `ERR_PNPM_BAD_RUNTIME_VERSION`. Both runs failed in a project
  created on 2026-10-12, and every weekly run will. That project moved to
  `ci-security:renovate`. Dependabot security updates fail the same way, so
  it also switched Renovate's `vulnerabilityAlerts` on in its own file: the
  add-on's row "Security fixes: still Dependabot security updates" is not
  true under this floor. For the add-on, Renovate as the default with its
  fixes on, a floor the updater is let past, or waiting for Dependabot: not
  decided.

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
- **`extending-a-project` in a Codex session.** The other two are checked
  there ([the record](codex-test-2026-10-04.md)).
- **A model between the smallest and the frontier.** Claude Haiku 4.5 has been
  tried ([the record](small-model-2026-10-05.md)); Claude Sonnet has not.
- **The kit in a real existing project.** The script sets up the files and says
  what is left. Declaring each package's role, and deciding what to do with the
  findings on code that was never held to these rules, is judgement nobody has
  watched an agent do.

## Known limits

- **No command that `pnpm repo:settings` prints has been run.** The
  `ci-security` add-on's command reads a repository's settings and prints,
  for each one that is off, the `gh api` command that switches it on. It
  never runs one, and neither did its tests or its runs against GitHub on
  2026-10-12. The body of the ruleset it prints holds the fields GitHub's
  published API description requires; GitHub has not been sent it.
- **The `agent-workflow` hook has not run in a live session of Codex, nor
  in front of a person.** Under Claude Code 2.1.296 it ran headless on
  2026-10-13: it refused a chain, and its question stopped a push with a
  colon that an `allow` rule let through without it ([the add-on's
  README](../addons/agent-workflow/README.md#in-a-live-session-of-claude-code)).
  Still from the documentation: the reply Codex reads, how each host matches
  a hook to the shell tool, and that a hook that crashes or times out does
  not block.
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
  again, and nothing here fails when it does.
- **A second review named the hook's reading of a command.** A security
  review of the add-on as a project got it (2026-10-12) named `outward.mts`,
  `shell.mts` and the hook for letting through a command they cannot read
  and for ways past the chain detection, with no detail. The first is the
  choice the add-on's README states; the second is not followed up.
- **Whether that hook is registered is judged by a reading of each host's
  matcher rules** (`hook-registration.mts`, in the installer and in the
  add-on's check). A security review of the last commit named that file for a
  possible difference from the hosts, with no detail; not followed up. The
  cost of a wrong "registered" is a joined command that gets one prompt, not
  an unprompted push: the host's own permission rules are untouched.
- **The stop hook judges the checkout the session stops in.** A session that
  changed two checkouts is held to one. That `cwd` in the payload follows the
  agent into a worktree is from the documentation.
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
- **`e2e`'s 175 mutants were not all run again.** The 18 that the host and
  port added or rewrote were, and the 14 application mutants were.
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
- **The visual add-on has no theme matrix, no "which UI does no scenario
  render" measure, and no published diff site.** The Playwright report, as an
  artifact, is what shows a failure.
- **No skill exists for placing logic, adding a port, streaming state or
  testing.** On purpose: one is written when a task fails in a way the gates do
  not catch, and across four feature runs none has.
