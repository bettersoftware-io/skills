# The weekly changelog: due in the session, complete by proof, released by choice

Date: 2026-10-18, revised 2026-10-24. Status: design, for review.

## Why

ReactiveTraderCloudClone (RTC) keeps a `CHANGELOG.md` with one entry per ISO
week. A Monday workflow tags each finished week and opens a reminder issue.
A command writes the entry, and a script publishes each tagged week as a
GitHub Release. The `agent-workflow` add-on already carries most of that to
projects made from the starter: the weekly tag (`close-week.mts`), `pnpm
changelog weeks|prs|check`, `/workflow:changelog` and its Codex skill, and
`CHANGELOG.md` as a starting file. `repo-hygiene`'s link check reads every
markdown file git does not ignore, so `CHANGELOG.md` is already inside it.

RTC then ran the system for real and paid for five lessons the add-on does
not carry yet:

1. **Writing the entry is the step that rots.** Two reminder issues went
   unanswered for two weeks. An issue on GitHub is not where the people who
   would write the entry are working. They are in Claude Code or Codex
   sessions.
2. **An entry written before its week ends misses pull requests, silently.**
   W40 was written at 13:08 UTC on its last day and missed 30. The add-on has
   the same hole: `weeksToWrite` lists only the weeks after the newest heading,
   so a week that has a heading is never looked at again.
3. **The proof of completeness must be mechanical, both ways.** Today `check`
   proves that every merged pull request is cited. It does not prove that
   everything cited under a week was merged in that week. The link
   definitions are kept by hand.
4. **GitHub orders releases by the tag's date, not by the week.** Tags made
   later for past weeks list above the real ones.
5. **Merging the release script triggers the release workflow.** Every tagged
   week is published at once unless one is published first, by hand.

RTC also found a way to backfill a history that had no changelog: one agent
per week from one shared brief. In the era before pull requests, entries are
shorter, cite key commits, and link to the full commit list between tags.

## Goals

1. **The reminder reaches the session.** When a finished week has no entry,
   or an entry that misses pull requests, a Claude Code or Codex session in
   the project is told so when it starts. Every new session says it again
   until the entry is written.
2. **A week written early is extended later.** The tools treat an entry
   written before its week ended as partial, and list it again once the week
   is over if it misses pull requests.
3. **Completeness is a proof, both ways.** For a week, the set of pull
   requests merged in it equals the set cited in its section. The link
   definitions are generated from the citations, never written by hand.
   Commit citations (``[`abc1234`]``) are supported, for weeks before a
   project used pull requests.
4. **Tags sort by their week.** A tag carries the date its week ended, whether
   the Monday workflow made it on time, a person ran it late, or it was made
   for a past week.
5. **GitHub Releases, for a project that wants them.** `agent-workflow`
   ships a workflow that publishes one release per tagged week from
   `CHANGELOG.md`, the only source. It does nothing until the project
   switches it on.
6. **Backfill is a runbook.** The command explains how to write past weeks,
   with RTC's method.
7. **An entry written in CI, for a project that pays for it.** `agent-workflow`
   ships a workflow that runs the changelog command headless and opens a pull
   request with the entry. It does nothing until the project switches it on
   and gives it an `ANTHROPIC_API_KEY` secret. The session-start reminder
   stays the main way an entry gets written.

## Non-goals

- **A repair command for tags that already carry the wrong date.** Fixing
  one means deleting a tag on GitHub and making it again, and perhaps its
  release too. RTC did that once, by hand, for its 28 past tags. New tags are
  dated right from the start, so the add-on never needs it.
- **A CI writer that merges.** It opens a pull request. A person merges it.
- **A gate that fails when a week is overdue.** A check that goes red because
  time passed would fail every unrelated change on Monday morning, and fight
  everyone working on the project.
- **Release notes for a published package.** This is a log of what landed on
  the main branch, by week.
- **Moving the changelog out of `agent-workflow`.** It stays there, with
  both new workflows.

## Anti-goals

These would make it a failure even if everything ran:

- **A reminder that derails the session.** The agent mentions the due week to
  the person when it fits. It does not drop the task it was given to write a
  changelog.
- **A slow or fragile session start.** The reminder reads only local files and
  git. It never asks the network, and it never fails or blocks a session.
- **A pass that judged nothing.** A check that could not run says `SKIP` and
  exits 2, as the rest of the kit does.
- **A release, or a paid run, in a project that did not ask.** Both
  workflows are skipped until the project sets their switch. The writer is
  also skipped when its secret is missing. A skipped run writes nothing and
  spends nothing.
- **A tag moved, or a release edited by hand.** The workflow owns the tags,
  and `CHANGELOG.md` owns the releases.

## Constraints

- **The add-on contract** (`addons/README.md`). An add-on only adds. Tooling
  lives in `tools/<name>/` as `.mts` that plain `node` runs. CI is a workflow
  of the add-on's own, with actions pinned by commit and the narrowest
  permissions. Everything checkable is a script that fails with what to do.
  `AGENTS.section.md` carries only judgement. Every script has tests, and each
  test is shown able to fail by a mutant in `tests/mutants.json`.
- **TypeScript only.** No `.js`, `.mjs` or `.cjs`.
- **Both hosts.** Every hook is registered for Claude Code
  (`.claude/settings.json`) and Codex (`.codex/hooks.json`) through
  `hostSettings`. Every command has a Codex skill that points at it.
- **The plugin's version.** Bump `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json` if it carries the version, and
  `.codex-plugin/plugin.json` together. `scripts/plugin-manifests.test.mts`
  holds the rules.
- **No outward step without the person.** Nothing in this work pushes, opens a
  pull request, creates a tag or a release on GitHub until the person says so.
- **Write tokens and outside code.** `close-week.mts` runs on plain Node with
  nothing installed, so no package's code runs where the token can write.
  The release workflow keeps that rule. The CI writer cannot: it runs Claude
  Code through Anthropic's action. It therefore gets the narrowest token that
  can push a branch and open a pull request, and it is off by default.

## The design

### Part 1: `agent-workflow` learns when a week is due

**`pnpm changelog due`** (new subcommand of `tools/agent-workflow/changelog.mts`).

- Offline. It reads `CHANGELOG.md` and the first-parent history of the
  remote-tracking default branch (`origin/HEAD`, else `origin/main`), as of
  the last fetch.
- It finds the pull requests merged in each week from the merge commits.
  GitHub's merge commit subject is `Merge pull request #N from …`, and its
  committer date is the merge time. Two more subjects are recognised. A
  squash merge's subject ends in `(#N)`. `Merge PR #N: …` is the subject RTC
  gives with `gh pr merge --subject`, and RTC merged 885 of about 980 pull
  requests that way. A pull request whose first-parent subject carries no
  number is invisible to `due`. `check`, which asks GitHub, still catches it
  when the entry is written.
- A week counts as written when either copy of `CHANGELOG.md` cites all its
  pull requests: the working tree's, or the one at the remote-tracking
  branch. The working tree's copy stops the session that is writing the entry
  from being reminded about it. The remote copy stops a worktree cut before
  the entry merged from being reminded about a week main already has.
- It judges the finished weeks only, never the current one. These are the
  newest week that has a heading, when that week is finished, and every
  finished week after it. A file with no week at all is judged on the last
  finished week only, so a project that just took the add-on is not told
  about its whole history.
- A week is due when pull requests were merged in it and its section is
  missing, or does not cite them all. Each due week is one line: its name, how
  many pull requests were merged, how many are not cited, and the command that
  writes it.
- Exit 0: nothing due. Exit 1: something due. Exit 2 (`SKIP`): no
  `CHANGELOG.md`, or no remote-tracking branch to read.

**The session-start hook** (`tools/agent-workflow/hooks/changelog-due.mts`).

- It is registered under `SessionStart` for both hosts in `hostSettings`. In
  Claude Code, the matcher is `startup|resume|clear`. In Codex, it is whatever
  that host's matcher grammar allows for the same events.
- It runs the same function as `due`, in process. When something is due it
  gives the host one short block of context. Claude Code takes the hook's
  stdout. For Codex, see the next point.
- The text names the due weeks, says "as of the last fetch", and tells the
  agent two things. First, mention it to the person at a natural point.
  Second, it is written with `/workflow:changelog <week>` in Claude Code, or
  `$workflow-changelog <week>` in Codex.
- It says nothing when nothing is due, when there is no `CHANGELOG.md`, or
  when there is no remote-tracking branch. It never exits non-zero. Its
  timeout is 5 seconds.
- Codex runs a command hook only after the person trusts it with `/hooks`.
  The README says so.

**`weeks` re-checks the newest week.** It also lists the newest week that has
a heading when that week is finished and `due` finds it incomplete, marked
"extend". This closes lesson 2 for a person who asks, as the hook closes it
for a person who does not.

**The Monday issue says everything that is due.** `close-week.mts` already
opens "Changelog: write `<week>`". Its body now lists every week `due` finds,
with "extend" for a week whose entry exists but misses pull requests. The
issue stays as the backup reminder.

### Part 2: `agent-workflow` proves completeness both ways

**`check <week>`** gains two things:

- Everything cited in the week's section was merged in that week. A pull
  request cited under the wrong week fails, and is named.
- The definitions block equals what `defs` would write. This takes the place
  of today's three checks on definitions: present, pointing at the right
  number, ascending.

**`pnpm changelog defs [--write]`** (new). It generates the definitions block
from every citation in the file:

- `[#N]` becomes `<repo>/pull/N`.
- ``[`sha`]`` becomes `<repo>/commit/<sha>`.
- PRs come first in ascending number, then commits in alphabetical order of
  their label. RTC's 263 commit definitions are already in that order.
- A commit definition that already exists keeps its address when that
  address is a commit link of this repository that begins with the label.
  RTC links 9-character labels to full SHAs, and adopting `defs` must not
  rewrite them all.
- The repository's address comes from the `origin` remote, so it works
  offline.

Without `--write` it prints the difference and exits 1 when there is one.
Step 5 of the command becomes this one command.

### Part 3: `agent-workflow`'s tags carry their week's date

- `close-week.mts` creates the tag object with a `tagger` whose `date` is the
  Monday 00:05 UTC after the week. A late run by hand then sorts as if it had
  run on time.
- **`pnpm changelog tag <week> [--apply]`** (new) is for past weeks. It finds
  the last first-parent commit before the week ended, and creates the tag
  with the same backdated date. Without `--apply` it prints what it would do.
  It refuses a week that already has a tag, and never moves one. It is an
  outward step: the command text says to ask the person before `--apply`.

### Part 4: the command learns partial weeks and backfill

`.claude/commands/workflow/changelog.md` (judgement only):

- **Partial weeks.** An entry written before the week ends is partial. Say so
  in its summary line. `due` and the hook will bring it back once the week is
  over, and it is then extended in place, never given a second heading.
- **Link definitions.** Run `pnpm changelog defs --write`. Never edit the
  block by hand.
- **Backfill.**
  - Write one agent's brief from the file's introduction and two finished
    weeks, then give one agent one week each.
  - In the era of pull requests, cite every one.
  - Before them, cite the key commits. Prove with a list that every commit is
    accounted for, and end the week with a compare link between its tags.
  - Make missing tags with `pnpm changelog tag`, and ask the person before
    `--apply`.
  - Rewrite labels from plans ("Phase 6b") in plain words.
- The add-on's `AGENTS.md` section gains one paragraph: what the session-start
  reminder means, and that it is mentioned, not obeyed.

### Part 5: releases, switched on by the project

Ported from RTC's `scripts/changelog/sync-releases.mts` and its workflow, in
this repository's style. The style is a function with injected
`run`/`report`/`now`, exit 0/1/2, and `SKIP` with a reason. It ships in
`agent-workflow`, because it reads the `CHANGELOG.md` that add-on owns. A
project switches it on with a repository variable:

```bash
gh variable set CHANGELOG_RELEASES --body true
```

- **`tools/agent-workflow/sync-releases.mts`**, run as `pnpm changelog:releases`.
  - It plans by default. `--apply` writes. `--only <week>` writes one week.
    `--body <week>` prints one week's notes. `--state <file>` reads tags and
    releases from JSON in place of GitHub.
  - It makes one release per week that has both a section and a tag, titled
    like the heading. Only the newest is marked latest.
  - The notes are the section, rewritten for a page that has no definitions
    block:
    - `[#N]` becomes `#N`;
    - a commit citation becomes an inline link;
    - a relative link points at `blob/<default branch>`;
    - `#anchor` becomes `CHANGELOG.md#anchor`;
    - a footer links back to the week's heading.
  - Idempotent: an unchanged name and body write nothing.
- **`.github/workflows/sync-releases.yml`.**
  - It runs on a push to the default branch that touches `CHANGELOG.md` or
    the script. It also runs Monday at 00:30 UTC, after the tag, and by hand.
  - Its job has `if: vars.CHANGELOG_RELEASES == 'true'`. Without the
    variable, GitHub shows the run as skipped, and no step runs.
  - It uses a sparse checkout, `persist-credentials: false`, plain Node with
    nothing installed, and `contents: write` only. A `concurrency` group keeps
    two runs from writing the same release.
- **No gate of its own.** The one way a section fails to render is a commit
  citation with no definition, and `pnpm changelog check` already fails on
  that. The add-on's `verify` renders every week's notes offline
  (`--body` for each week), so a project that just took it sees the renderer
  work.
- **The add-on's `AGENTS.md` section and README.**
  - Never edit a release: change the section.
  - To switch it on: plan, publish one week with `--only <week> --apply`,
    look at it on GitHub, then set the variable. Setting the variable, or the
    next change to `CHANGELOG.md`, publishes every tagged week.
  - Tags that already carry the wrong date list out of order. The add-on does
    not repair them. The README says what RTC did by hand.

### Part 6: the CI writer, switched on by the project

`.github/workflows/changelog-writer.yml`, in `agent-workflow`. It is off
unless the project sets both switches:

```bash
gh variable set CHANGELOG_WRITER --body true
gh secret set ANTHROPIC_API_KEY
```

- **When it runs:** Monday at 01:00 UTC, after the weekly tag, and by hand.
- **What it does:**
  1. It checks out the default branch with its history, then runs
     `pnpm changelog due`, which is plain Node and needs nothing installed.
     Nothing due ends the job before anything is installed or paid for.
  2. Otherwise it runs Claude Code through Anthropic's action (pinned by
     commit), told to follow `.claude/commands/workflow/changelog.md` for
     the due weeks, in its headless form (below).
  3. Claude Code commits on a branch `changelog/<week>` and opens one pull
     request with `Closes #<n>` for the reminder issue. It never merges.
- **Guards:**
  - The job has `if: vars.CHANGELOG_WRITER == 'true'`.
  - Its first step stops with a clear message when the secret is empty.
  - A `concurrency` group allows one run at a time.
  - A cap on turns bounds the cost of one run.
  - The tools Claude Code may use are listed: `pnpm changelog` subcommands,
    `gh pr view`, `gh pr create`, `gh issue list`, `git` for the branch, and
    file edits.
  - Permissions: `contents: write` (the branch), `pull-requests: write`, and
    `issues: read`.
  - A pull request opened with the workflow's own token does not start other
    workflows, so its checks would not run. The README says how to give it a
    token that does, or to close and reopen the pull request.
- **The command learns a headless form.** When the prompt says it runs in CI:
  - skip the worktree (the runner is fresh);
  - stop after the pull request is opened;
  - if `pnpm changelog check` does not pass, open the pull request as a draft
    that names what is missing, rather than nothing.
- **The README** says what it costs in plain terms (one run per due week,
  bounded by the cap), and that a project which will not pay leaves it off.
  RTC leaves it off.

## Decided by the person

- Releases and the CI writer are both opt-in, and both live in
  `agent-workflow`. (Their answer reached this session through the session
  working on RTC, on 2026-10-24.)
- The main way an entry gets written is a Claude Code or Codex session,
  reminded at its start.
- Every new session repeats the reminder until the entry is written. (They
  answered "Yes" to a question with two options. The first was read as meant,
  and they were told so.)

## Calls made in writing this

- Both opt-ins are repository variables, read by the workflow's `if`. They
  are not starting files, and not a `choice`, which the contract keeps for
  starting files. A project that never sets them sees skipped runs and
  nothing else.
- The release script is named `changelog:releases`, beside `changelog`, to
  show it belongs to the same file.
- No repair command for tags that already carry the wrong date.
- The reminder reads git as of the last fetch, never the network.
- Squash-merge subjects `(#N)` and RTC's `Merge PR #N:` count, as well as
  GitHub's merge commits. There is no per-project setting for other forms
  yet.
- A week is written when either the working tree's or the remote branch's
  `CHANGELOG.md` cites it all.
- `defs` keeps RTC's layout: commits in alphabetical order, and existing
  full-SHA addresses kept. RTC can adopt the add-on without a rewrite of its
  file. Moving RTC to the add-on is not part of this work.
- A project with no week yet is told about the last finished week only.
- The agent is told to mention a due week, not to write it unasked.
- The CI writer opens a pull request and never merges, and it checks `due`
  before it spends anything.
- The release workflow's push paths keep RTC's, so a fix to the script
  republishes.
- The version moves to 0.20.0, a minor bump: new commands, two new
  workflows, and a new hook.

## Left to the builder

- The exact output format of a Codex `SessionStart` hook: stdout or a JSON
  `additionalContext`. Check it against the official hooks page, and try it
  in a real Codex session if one can be run. The matcher for each host comes
  from the same check.
- Anthropic's action for the CI writer: its current version, its inputs for
  the prompt, the allowed tools and the cap on turns, and the commit to pin.
  Read from its repository, not from memory.
- How `due` and `check` share the week's merged set. `check` keeps asking
  GitHub (`gh`), which is exact. `due` uses git, which is offline. A
  disagreement between them for a week is worth a test.
- Where the definitions block begins in a file that has other reference
  definitions. Only definitions of citation form are regenerated, and others
  stay where they are.
- The names of subcommands and flags, if a clearer one comes up.
- The wording of the reminder, the issue and the command text, in the plain
  style of the files around it.

## How it is proven

- **Tests for every new script and branch, each with a mutant** in the
  add-on's `tests/mutants.json`. RTC's 12 mutants of the release script come
  along in the new form. The kinds of tests:
  - fixture histories made with real `git` in a temporary folder, for `due`;
  - fixture changelogs, for `check`, `defs` and the release notes;
  - JSON remote state, for the release plan;
  - the two workflows' `if` and the writer's secret guard.
- **The repository's own tests stay green:**
  - `addons-listed`;
  - `workflows`, for pinned actions and permissions;
  - `host-settings` and `hook-registration`, for the new `SessionStart`
    entries in both files;
  - `plugin-manifests`;
  - `project-paths`;
  - `dependency-order`;
  - `mutants.test.mts`.
- **In `skills-demo`, locally, with no push.**
  - Install `agent-workflow` with `add-to-project.mts`, then run
    `pnpm install`, its `verify`, and `pnpm gate:full`.
  - Run `pnpm changelog due` against its real history, and run the hook
    script as each host starts it.
  - Run `pnpm changelog:releases --state <fixture>` and `--body <week>` after
    one week's entry is written there.
  - Start one Claude Code session in it, to see the reminder arrive.
- **The two workflows lint clean** under actionlint and zizmor, as the
  `ci-security` add-on runs them.
- **What is not seen** goes into `docs/STATUS.md`, with a test record in
  `docs/`. That covers:
  - the workflows on GitHub;
  - a real release;
  - a run of the CI writer;
  - a Codex session, if none could be run;
  - a backdated tag created through the API.
- **Real tags, releases and paid runs** on GitHub only when the person says
  so.
