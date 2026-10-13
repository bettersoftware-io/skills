# Add-on: agent-workflow

How an agent ships work from a project created from the starter: every
change started in a fresh worktree, each push and pull request step in a
tool call of its own, a green pull request merged and followed onto main,
each finished week tagged, and a changelog whose completeness is checked. The hook refuses and never says yes: every push and
pull request step still asks a person.

```bash
node scripts/add-to-project.mts <project> agent-workflow
cd <project> && pnpm install && pnpm agent-workflow:check
```

It is recommended: `create-project.mts --with recommended` adds it. It
assumes the project is on GitHub, uses pull requests, and lets an agent push.
Leave it out of a project where one of the three is not so.

## What it adds

| Part | Where | What it does |
|---|---|---|
| The hook | `tools/agent-workflow/hooks/split-outward-commands.mts` | Before each shell command: refuses one that joins an outward step to anything else, and of Claude Code asks about a push that is not written plainly. It says nothing about any other command |
| Its registration | `.claude/settings.json`, `.codex/hooks.json` | Merged in under `hooks.PreToolUse`, matcher `Bash`, beside the kit's hooks. For Claude Code a second group, matcher `Monitor`: that tool runs a shell command too |
| Permission rules | `.claude/settings.json` | Merged in: twelve `ask` rules for a forced or destructive push and an `--admin` merge, and one for an edit of the hook. No `allow` rule |
| `pnpm worktree <name> [--ready]` | `tools/agent-workflow/new-worktree.mts` | A worktree beside the project on `worktree-<name>`, cut from `origin`'s main by name |
| `pnpm changelog weeks\|prs\|check` | `tools/agent-workflow/changelog.mts` | The weeks with no entry, a week's merged pull requests, and the proof that each is cited |
| Weekly tag | `.github/workflows/weekly-tag.yml`, `tools/agent-workflow/close-week.mts` | Monday 00:05 UTC: tags the finished ISO week, opens "Changelog: write `<week>`" |
| `CHANGELOG.md` | project root | A starting file: the format, no week yet. The project owns it |
| `docs/STATUS.md` | `docs/` | A starting file: the six sections of what is left, no entry yet. The project owns it |
| `docs/IDEAS.md` | `docs/` | A starting file: what nobody has committed to. The project owns it |
| Six commands | `.claude/commands/workflow/*.md` | `/workflow:status`, `/workflow:docs`, `/workflow:changelog`, `/workflow:coverage-backfill`, `/workflow:visual-tolerance-audit`, `/workflow:perf-audit` |
| The same for Codex | `.agents/skills/workflow-*/SKILL.md` | One small skill per command, which points at the command file |
| `node tools/agent-workflow/requires.mts <add-on>` | same | Exit 0 when the add-on is installed, exit 2 with what to do when not |
| `pnpm agent-workflow:check` | `tools/agent-workflow/check.mts` | The add-on's `verify`: runs the hook on three commands as each host starts it, and reads both settings files |

Nothing joins `gate:fast` or `gate:full`. A host's settings file is the
project's to change: a gate that failed when someone removed a permission
rule would fight the owner of the file. The check is run by hand.

## The shipping rules

The hook decides one thing: an outward step is a call of its own. The rest is
judgement, so it is text: the add-on's section of `AGENTS.md` tells an agent
how a change gets from the first edit to main, in this order.

| Step | The rule | Why |
|---|---|---|
| Isolate | `pnpm worktree <name> --ready` before the first edit | Several sessions work on one project at once, and a local main is stale by default |
| One pull request | What a reviewer accepts or rejects together | Each split costs a run of the checks and a merge |
| Wait for green | Every run whose `headSha` is the pushed commit is `completed` with `success` | A green run of an earlier push proves nothing about this one |
| Read main | Compare what landed with what the branch changed; bring main in only on an overlap | Green is against the main the branch was cut from; catching up every time costs a run each |
| Merge | `gh pr merge <number> --merge`, at once, without asking whether to | A person's say is the host's prompt. A squash or a rebase puts other commits on main than the ones that were checked |
| Clean up | Only after `git merge-base --is-ancestor` finds the commit on main | Removing a worktree deletes its ignored files too, with no warning |
| Watch main | The runs for the merge commit, until each is `completed`; a failure the change caused is fixed forward unasked | Some workflows run only after the merge |

Each step says what to do when it goes wrong (a red run, no run at all, a run
that hangs, a check that fails for a reason outside the diff), and when to
skip it.

The section opens with what the rules are for, in the order that decides when
two of them pull apart: main is never red, many sessions work at the same
time, and a green change is on main within minutes. "Read main" is where the
first and the third meet. Bringing main in before every merge keeps main
green and costs a run of the checks each time, and on a busy project main has
moved again before that run ends. Never bringing it in is fast and lets
through the break git cannot see. So the section asks one question (can the
two changes break each other?) and names the cases: plainly apart and prose
merge as they are; the lockfile, a config, a fixture or an exported name
bring main in first. It ends with a list of moments to stop at, each of them
a way the source project saw one of the rules skipped.

What makes "merge at once" safe is in the repository, not in the section: a
ruleset on main that requires the checks. `ci-security` lists it among the
settings a person switches on.

Differences from the source:

- **Nothing is approved in advance.** The source lets a push of a work
  branch, `gh pr create` and `gh pr merge` run with no prompt, by `allow`
  rules in its settings. Here each one asks ([why](#why-the-hook-does-not-approve-anything)).
  The rule "merge at once" is about the agent not stopping to ask in words;
  the prompt stays.
- **No numbers of one project.** The source gives its own run times and
  counts of merges. The section says "twice its usual time".
- **A branch left on `origin` is reported, not removed.** The source relies
  on the repository setting that deletes a merged branch.

## What is left

The steps above end at main. What a piece of work leaves behind had no place:
it was said in a session's closing report, and gone with the session. In the
project these rules were first followed in, one day's work left a setting
only a person could switch on, five alerts nobody had read, two open
decisions and three things not verified, and all of it lived in one
conversation.

`docs/STATUS.md` is that place. It holds only what is not done; an entry is
removed in the pull request that finishes it, so the page shrinks.
`docs/IDEAS.md` comes before it and holds what nobody has committed to. The
section of `AGENTS.md` says when an entry is added, moved and removed, and
that what is left is written there in the pull request of the work that left
it.

From the source, with three differences:

- **Two more sections.** The source's page has four, by how far a planned
  piece of work has come. "Waiting on a person" and "Known limits" are added,
  for what is left that is not a piece of work.
- **Plain headings.** The source marks each with a coloured sign.
- **No command and no check yet.** The source has a command that reports the
  live position (branch, open pull requests, the last run on main) beside the
  page's headings. Nothing here checks that the page has its sections or
  that its date moved. Both are in this repository's `docs/STATUS.md`.

## The hook

An outward step sends something off the machine or changes shared state.

| Outward | Not outward |
|---|---|
| `git push`, also `--dry-run`, also behind `git -C dir` or `-c key=value` | `git add`, `commit`, `fetch`, `merge`, `pull` |
| `gh pr create`, `merge`, `edit`, `comment`, `close`, `reopen`, `ready`, `review` | `gh pr view`, `list`, `checks`, `diff` |
| `gh workflow run`, `enable`, `disable`; `gh run rerun`, `cancel`, `delete` | `gh run list`, `view`, `watch` |
| `gh api` with `-X`/`--method` POST, PATCH, PUT or DELETE, or with a field (`-f`, `-F`, `--field`, `--raw-field`, `--input`) and no method | `gh api` reads, also `-X GET -f …` |
| `gh issue create`, `comment`, `edit`, `close`, `reopen`; `gh release create`, `delete`, `edit`, `upload`; `gh repo create`, `delete`, `edit`, `fork` | every other `gh issue`, `release`, `repo` call |

A command is refused when it holds an outward step and anything else beside
it: joined by `&&`, `;`, `||`, `&` or a new line, in a subshell or a `{ }`
group, in an `if` or a loop, inside `$(…)` or backticks of another command
(`git commit -m "$(git push)"`), behind a pipe from another command
(`git commit -qam wip | git push`), or as the text given to `bash -c` or
`eval`. Two outward steps in one command are refused however they are
joined.

A step is read behind a program that only runs it: `time`, `command`,
`exec`, `nohup`, `env`, `timeout`, `nice`, `stdbuf`, `builtin`, `noglob` and
`xargs`, each with its own options (`nice -n 5`, `timeout 30s`). Claude Code
looks past the same words when it matches a permission rule to a command, so
`nice git push` runs under an `allow` rule for `git push`.

It is let through when the outward step is alone: with a pipe into a filter
(`git push 2>&1 | tail -2`), with redirections, with a `$(cat <<'EOF' … EOF)`
that only feeds it, or with variables set in front. Let through means only
that it is not refused: the host asks about it as it always does.

**A push that is not written plainly is asked about.** `git push origin
worktree-a:main` names a work branch and writes to main, `git push origin
:worktree-a` deletes a branch, and `git push origin worktree-a -"f"` forces
one past every rule that looks for `-f`. For a `git push` that stands alone,
the hook answers `ask` unless it is plain, and Claude Code then puts the
question to a person whatever `allow` rule matches the command. Plain is:

- `git`, with no option of its own before `push` but `-C <folder>`,
  `--no-pager` or `-P`;
- options of `push` from one list: `-u`, `--set-upstream`, `-v`,
  `--verbose`, `-q`, `--quiet`, `--progress`, `--porcelain`, `-n`,
  `--dry-run`, `--atomic`;
- every other word made of letters, digits and `. _ - /`;
- no quote and no backslash anywhere in the command;
- nothing set in front of `git`, and no `xargs`.

What that asks about, and why a list of plain forms and not of dangerous
ones:

- A colon: `source:target`, `:target`, and also a remote written as a URL.
- An option not on the list. Git reads one cut short (`--de` for
  `--delete`, `--mir`) and several joined (`-uf`), and no permission rule can
  say either. An option of `git` itself, as in `-c remote.origin.push=a:b`.
- A quote or a backslash. The shell takes it out, so `-"f"` and `--forc''e`
  are `-f` and `--force` to git, and not to a rule, which reads the text as
  written.
- A word the shell turns into another: `"$BRANCH"`, `$(…)`, a backtick,
  braces, a pattern for file names (`*`, `?`, `[`).
- A value set in front of `git`: git takes `GIT_CONFIG_VALUE_0=a:b` there as
  a setting that says where a push goes.
- `xargs`, which adds words from what it is fed.

Not seen: a setting made by an earlier command (`git config
remote.origin.push a:b`, then a plain `git push`), and a variable the session
already holds that git reads by itself (`GIT_CONFIG_VALUE_0` exported
before). And the question is about how a push is written, not about where it
goes: `git push origin main`, a second branch after the first, another
remote and `HEAD` are plain words, and an `allow` rule of the project's own
decides them, with branch protection behind it. [Why this is the hook's and not a rule's](#the-ask-rules).

**The refusal is not a lock.** Each host gives the hook five seconds. When a
`PreToolUse` hook runs out of time, or ends with an error that is not a
refusal, both hosts record that and let the call go ahead to their own
permission rules: a hook that fails does not block. So the hook is built not
to fail (above), and it is quick: a command of a million characters, the
longest it reads, is answered in about a tenth of a second here, and a test
holds it under half the time limit. What stops a push is still the host's
prompt and the remote's branch protection.

### Not covered

- Aliases and functions: `gp` for `git push`, a shell function that pushes.
- A script that pushes (`./release.sh`, `pnpm release`).
- `find -exec`, `ssh host 'git push'`, `sudo`, and any other program that
  runs a command and is not in the list above.
- A tool of the host that runs a shell command and is neither `Bash` nor
  Claude Code's `Monitor`. The hook is registered by tool name, and sees no
  other.
- Other programs that write to a remote: `glab`, `hub`, `curl` to an API,
  `npm publish`.
- `gh api graphql -f query=…` counts as a write even when the query reads,
  as in the source. It only has to be a call of its own.

## The settings merge

`.claude/settings.json` and `.codex/hooks.json` are written once by the kit's
setup, and then belong to the project. An add-on could not touch them before.
This add-on needed to, so the installer gained one feature, `hostSettings` in
`addon.json` ([the contract](../README.md)): entries to merge into a host's
settings file.

- A key the project has keeps the project's value.
- A list gains the entries it lacks, after the ones it has.
- A hook counts as there only when the host would run it before a shell
  command, read by each host's own rules (`lib/hook-registration.mts`): the
  group's matcher covers `Bash`, and the entry is of type `command` with
  exactly the registered command line, no `if`, not `async`, and a timeout
  above 0 or none. A longer timeout or a wider matcher changes nothing, and
  the hook is not added a second time. Any other copy (under `Edit`, with
  `|| true` after it, with another type) does not count: the add-on's own
  group is added beside it, and the check fails until it is.
- For Claude Code a matcher is every tool (left out, `""`, `*`), a list of
  exact names split at `|` or `,`, or else a regular expression tested
  anywhere in the name. For Codex it is a regular expression whose anchoring
  its documentation does not give, so only a list of plain names split at
  `|` is read, and any other pattern counts as not registered.
- `disableAllHooks` in the settings file switches every hook off. The merge
  leaves the project's value and says the add-on is not whole (exit 3).
- Nothing is removed. One command line is rewritten: that of a hook this
  add-on registered under an older form. See
  [below](#updating-a-project-that-had-it) and `retiredHookCommands` in
  [the contract](../README.md).
- When nothing is missing the file is not written at all, so its layout and
  its bytes stay as the project left them.
- A file that is not JSON is left alone, and the note says what to add by
  hand. A file the host keeps read-only (Codex's sandbox does that for
  `.codex` and `.agents`) is left, and the note says to run the script again
  outside it.

**Limit: a removed entry comes back.** The merge cannot tell a rule the
project took out from a rule that was never there. Adding the add-on again
(an update) puts back a rule or the hook that was removed by hand. To keep
one out, remove it again after an update.

## Why the hook does not approve anything

Earlier versions let a routine push, pull request and merge run unasked:
first by `allow` rules, then by the hook answering `allow` for an exact form.
Three security reviews each found a way round it:

- an `allow` pattern ending in `*` also matched `worktree-a main` and `--mirror`;
- a heredoc body was read as text, and bash 3.2 runs what such a body holds;
- git configuration sent a push that named a work branch to `main`.

A hook reads words and cannot vouch for effects, so the feature was removed.
A question is another matter: when the hook reads a push wrongly and asks,
a person is asked once more than was needed, and when it reads one wrongly
and says nothing, the host's own rules decide as they did before.
A project that wants a step unasked writes its own `permissions.allow` rule
in its settings, knowing that a pattern ending in `*` cannot say "one word",
and keeps branch protection on. The hook has still not been run in a live
session of either host.

### Updating a project that had it

- A project that got the add-on before 2026-10-13 runs the hook before
  `Bash` alone. The update adds the group for `Monitor` beside it, and until
  then `pnpm agent-workflow:check` fails and says so.
- `tools/agent-workflow.config.json`, or the older `.mts`, is no longer
  read. The update and the check say so until the file is deleted.
- `.claude/settings.json` may start the hook with `--host=claude-code` and a
  timeout of 30. The update takes the argument off that command line where
  it stands and changes nothing else: the entry's timeout, its group, the
  matcher and the hooks beside it stay, and no group is taken out. Only when
  that leaves the same entry twice in one group, equal in every field, does
  the later one go. A
  command line that is not the old one letter for letter is left alone and
  named. Until the update runs, the old line still works: the hook ignores
  its arguments.
- The ask rule `Edit(/tools/agent-workflow.config.json)` stays, since a merge
  removes no rule. It does no harm.

The setting file and that rule can be deleted by hand.

### The ask rules

Twelve `ask` rules for commands are merged into `.claude/settings.json`.
For the add-on alone they change nothing: without an `allow` rule those
commands ask anyway. They are a backstop for a project that adds an `allow`
rule of its own: `ask` wins over `allow`.

| Rule | Catches |
|---|---|
| `Bash(git push *--force*)` | `--force`, `--force-with-lease`, `--force-if-includes` |
| `Bash(git push -f*)`, `Bash(git push * -f*)` | `-f`, first or later |
| `Bash(git push * +*)` | a `+refspec` |
| `Bash(git push *--delete*)`, `Bash(git push -d*)`, `Bash(git push * -d*)` | deleting a branch on the remote |
| `Bash(git push *--mirror*)`, `*--all*`, `*--tags*`, `*--prune*` | pushing or pruning more than one branch |
| `Bash(gh pr merge *--admin*)` | merging past the branch's protections |

**No rule catches `source:target`.** An older version merged in
`Bash(git push *:*)` for it. Claude Code reads a rule that ends in `:*` as
its older prefix form, in which what stands before is literal, the `*`
included: that rule matched a command that begins `git push *` and no push
anyone writes, and the host warned about it at each start. No spelling
mends it. `*` is the only wildcard, so "a colon, then anything" always holds
`:*`, and the host warns about that pair in the middle of a rule as well.
The hook asks about such a push in the rule's place
([above](#the-hook)), under Claude Code only. A merge removes no rule, so a
project that had the old one still has it: `pnpm agent-workflow:check` names
it until it is deleted by hand.

One more `ask` rule is merged in: `Edit(/tools/agent-workflow/**)`. The hook
is what refuses a chain, so an editing tool asks before it changes the hook
or the files beside it. It covers the editing tools and not a shell command:
`sed -i`, a redirection or `git checkout` writes the same files and no rule
here sees it. The installer writes those files itself, so an update does not
ask. `pnpm agent-workflow:check` notes it when the project took the rule out.

`pnpm agent-workflow:check` notes any `allow` rule with a `*` for
`git push`, `gh pr create` or `gh pr merge`, and fails when such a rule is
there and one of these is not.

## The worktree script

`pnpm worktree <name>` fetches `origin`'s main and runs
`git worktree add --no-track -b worktree-<name> <path> origin/<main>`. The
start is named; HEAD and the local branches are never read. If the fetch
fails it makes nothing, since `origin/<main>` would then be whatever it was
at the last fetch.

Differences from the source:

- The worktree goes in `<project>-worktrees/<name>`, a folder beside the
  project. The source put it inside the project, under a folder its
  `.gitignore` named; an add-on does not edit `.gitignore`, and a worktree
  inside the project is read by every tool that walks the tree.
- The main branch is the one `origin/HEAD` points at, `main` when the clone
  records none, or `--base <branch>`.
- `--no-track`: the new branch does not track main, so a bare `git push`
  can never go there.
- The name and `--base` are each one plain word: letters, digits and
  `. _ -` (and `/` in a base), starting with a letter or a digit. Both
  are handed to git, and a word that starts with `-` is an option to it:
  `--base "--upload-pack=touch x;git-upload-pack"` once ran that command.
  What `origin/HEAD` names is checked the same way. The fetch also says
  `--end-of-options`, which git has had since 2.24 (2019). An older git
  fails on that word: the script then stops at "could not fetch" and makes
  nothing.
- `--ready` proves the worktree with `pnpm gate:fast`, not with a build: the
  starter compiles nothing. With no `gate:fast` script it says `INSTALLED,
  NOT PROVEN` and exits 1.

## The weekly tag and the changelog

The workflow's shell became `close-week.mts`, so its dates and its order of
steps are tested. It is plain Node with nothing installed: no package's code
runs where the token that can write is. It passes actionlint and zizmor as
the `ci-security` add-on runs them on a laptop (offline), and zizmor's
`auditor` and `pedantic` levels with no finding.

Differences from the source:

- It checks out the default branch, whatever its name.
- It ends the week one second before Monday 00:00 UTC. `git rev-list
  --before` includes the instant it is given, so the source's bound took a
  commit made at 00:00:00 exactly into the week before.
- "No such tag" is told from "could not ask". The source read any failure of
  the lookup as "no tag" and went on to create one.
- A `concurrency` group, so two runs cannot both create the tag.

The command's checkable half is `pnpm changelog check <week>`. It is
stricter than the source's two `grep`s: a merged pull request must be cited
in its own week's section, a definition must point at that number, and the
definitions must be in ascending order. It asks `gh` for the week's merged
pull requests and keeps those merged inside the week to the second.

## Commands, and the three that need another add-on

All six commands are always installed. The three that need another add-on
start with step 0, `node tools/agent-workflow/requires.mts coverage` (or
`visual`, or `performance`), and tell the agent to stop if it does not exit
0. The script
reads `tools/installed.json`, the installer's own record.

Why not install them only when that add-on is present: the order of adding
would then matter. A project that took `agent-workflow` first and `coverage`
a month later would never get the command, with nothing to say why.
`pnpm agent-workflow:check` prints which commands are usable now.

Nothing was added to the other two add-ons. `coverage` already ranks gaps
per file from a fresh run (`pnpm coverage:gaps`), and `visual` already
measures the noise floor with the tier's own comparison and judges both
knobs (`pnpm visual:jitter`). The two commands are the judgement around
those scripts, with the source project's own numbers and file names left out.
`performance` has the audit (`pnpm perf:motion-audit`) and the guide; its
command is the reading of the report and the verdict on each finding. The
source's own audit command was for its levels of power saving and its two
clients, and none of that is here.

Two commands need nothing else:

- **`/workflow:status`** reports where the project stands: the checkout, the
  open pull requests, the last runs on main, and the headings of
  `docs/STATUS.md`. It is allowed `git`, `gh`, `grep` and reading, and no
  tool that writes. A red main is the first line of its report. The source's
  runs its commands before the command is read; here they are steps, as for
  every command (below).
- **`/workflow:docs`** writes what a session worked out into the project's
  documents. Its core is a table of where each kind of finding goes (work
  that is pending, an idea, a decision, how the project is built, how one
  part behaves, a rule for every session, and what does not belong in the
  project at all) and a stop: it proposes the place and waits for a yes.
  The source's table names its own folders; this one names the two pages the
  add-on gives a project and describes the rest.

### What a command may run unasked

A command's `allowed-tools` line is a grant: in Claude Code, what it lists
runs with no prompt while that command is the one running. So the line is
held to the add-on's own rule, that every outward step asks:

- Each grant names a program by its first words (`git worktree list`,
  `pnpm coverage:gaps`), never a whole program (`git`, `gh`, `pnpm`).
- What is granted is on a closed list of reads and of the project's own
  scripts, is not an outward step by the hook's own reading, and is used in
  the command's text.
- No command is granted a push, a pull request step, a merge, a workflow
  run or `gh api`. Nor `git fetch` and `git grep`, which read and can also
  be told to start a program (`--upload-pack`, `--open-files-in-pager`):
  each asks, as it would with no command running.

Until 2026-10-13 it was not so. The three commands the add-on began with
granted all of `git` and `gh`, as the source's do, so while one of them ran
a push or a merge did not ask. A security review of the commit that added
three more named it. `/workflow:status` is where it matters most: it reads
the titles of pull requests, which anyone who can open one writes.

Not brought over: the source's command that runs a copy of the CI steps and
looks for a step CI has and the copy lacks. A project from the starter runs
`pnpm gate:full` on a laptop and in CI, one command, so there are not two
lists to drift apart.

No command has a block that runs before the command is read (`` !`…` ``).
In a project-scoped command such a block is parsed and matched against
`allowed-tools` first, and one the host will not analyse yields an error in
place of data while the command carries on. The steps name each command for
the agent to run. That also lets Codex use the same file.

## Claude Code and Codex

| | Claude Code | Codex |
|---|---|---|
| The hook | `PreToolUse`, two groups, matchers `Bash` and `Monitor`, in `.claude/settings.json` | `PreToolUse`, matcher `Bash`, in `.codex/hooks.json` |
| The refusal | `permissionDecision: "deny"` | The same shape |
| The question about a push not written plainly | `permissionDecision: "ask"` | Not given. Codex calls that answer unsupported, so the hook says nothing to a payload that holds a `turn_id`, which Codex sends with every call |
| Permission rules | `permissions.ask` in the project | None in the project. Codex's approval mode and sandbox decide |
| Commands | `/workflow:changelog` and the two others | No project slash commands. The skills `$workflow-changelog` and the two others point at the same files |
| `$ARGUMENTS` | Filled in | Not filled in; each command says to take the arguments from the request |
| `allowed-tools` | Read: what the command may run with no prompt while it runs. Each command names only what it uses, and nothing outward ([below](#what-a-command-may-run-unasked)) | Ignored |
| Inside the host's sandbox | — | `.codex` and `.agents` are read-only, so the installer leaves the hook registration and the three skills, and its notes say so |

## How it was tested

`pnpm vitest run addons/agent-workflow scripts`. Git behaviour is tested
against real repositories made in a temporary folder, with another folder as
`origin`. GitHub is a function that answers; no test reaches a network.

- `tests/outward.test.mts`: what is outward, how steps are joined, text that
  only mentions a push, commands inside commands, a push that holds a colon
  and what the hook answers each host for one, commands that cannot be read,
  and the hook run as a program.
- `tests/new-worktree.test.mts`: a local main behind `origin`, a local main
  ahead of it, HEAD on another branch, a failed fetch, `--ready`.
- `tests/week.test.mts`, `tests/changelog.test.mts`,
  `tests/close-week.test.mts`: week arithmetic across years, the three
  checks, the tag on the right commit (first parent, the second before
  Monday), each refusal by GitHub.
- `tests/never-allows.test.mts`, with its tables in `tests/shapes.mts`: the
  30 commands an earlier version let run unasked, each piped to the hook as
  each host starts it and as an old registration starts it, in a real
  repository that still holds the old setting with everything on. Then the
  same 30 and 222 commands one step away from them, joined by nine
  separators in both orders and wrapped ten ways: over forty thousand
  commands, in three shapes of payload. The answer is nothing, `deny` or
  `ask` for every one in Claude Code's two shapes, and nothing or `deny` in
  Codex's. The type of the answer is tested too: it has no other decision.
  The same file holds the bounds: a command too deep or too long to read,
  and a payload that is not JSON.
- `tests/check.test.mts`: the verify command and `requires.mts`.
- `tests/hook-registration.test.mts`: whether a host would run a hook, by
  matcher and by entry, put to both copies of the file that decides it, and
  that the two copies are one text.
- `tests/new-worktree.test.mts` also holds the base that ran a command,
  and sixteen other words that are not a branch name.
- `tests/addon.test.mts`: the manifest, the workflow's standards, the
  commands, the ask rules against a model of the host's matching, and
  the add-on installed into a project with the real kit: merged, unchanged
  the second time, nothing of the project's dropped. Also the update of a
  project that had the old setting files and the old registration: one hook
  after it, started as it is now, the rest of its entry kept, each leftover
  named.
- `scripts/host-settings.test.mts`, `scripts/add-to-project.test.mts`: the
  merge and the installer.

Every test was turned red by a mutant of its own and restored: 467 mutants
in `tests/mutants.json`, run with the coverage add-on's `mutation-check.mts`,
all killed. Two of them are judged by the type checker, not by a test run. Each of its test commands was first seen green and selecting at
least one test, since a filter that matches no test exits 0 and would read
as a mutant that survived.

Three tests judge a table and not code, and were turned red by hand: no
`.sh` file is shipped; no near-miss is given twice; the sweep is over five
thousand commands.

### In a live session of Claude Code

Run on 2026-10-13 with Claude Code 2.1.296, headless (`claude -p`, where a
question nobody can answer is a refusal), in a scratch repository with a
folder as `origin`. Only the project's settings were in force
(`--setting-sources project`), and `Bash(git push *)` was allowed on the
command line: a headless session drops a project's own `allow` rules until
the folder is trusted.

| The project's settings | Command | What happened |
|---|---|---|
| The hook | `git push origin main:other` | Not run. The hook's reason reached the session |
| The hook | `git push origin main` | Ran |
| No hook | `git push origin main:other` | Ran, and made `other` on the remote |
| The hook | `git status --short && git push origin main` | Refused by the hook. The session ran the two as calls of their own |
| No hook, the ask rule `Bash(git push *--force*)` | `git push --force origin main` | Not run |
| The same | `git push origin main` | Ran |
| The hook, for `Bash` alone | The Monitor tool given `git push origin main:viamonitor1` | Ran, and made the branch on the remote |
| The hook, for `Bash` and `Monitor` | The Monitor tool given `git push origin main:viamonitor2` | Not run. The hook's reason reached the session |

So in that version a hook's `ask` and an `ask` rule each win over an `allow`
rule, the hook's refusal is read, and an `allow` rule for `Bash` lets the
Monitor tool run the same command. Not seen: the prompt a person gets in an
interactive session, any other version, and Codex.

### A review against the host's own matching

On 2026-10-13 a reviewer was given the hook, the reader and the binary of
Claude Code 2.1.296, and asked for commands that an `allow` rule for a push
lets run, that no `ask` rule matches, and that the hook neither refuses nor
asks about. It ran the host's own matching functions, cut out of the binary,
against each candidate. Five kinds were found, and each is a test now:

| Found | Example | Now |
|---|---|---|
| A program the host looks past and the hook did not | `nice git push origin a:b`; a chain ending in `timeout 30 git push` | Read as the push it runs |
| `xargs` fed by a pipe | `echo :main \| xargs git push origin worktree-a` | Refused as a chain; asked about without the pipe |
| An option hidden by a quote | `git push origin worktree-a -"f"` | Asked about |
| An option cut short or joined | `-uf`, `--de`, `--mir` | Asked about |
| The Monitor tool | A push given to it, with the hook registered for `Bash` | The hook is registered for `Monitor` too |

Two more, of the refusal and not of the question: an outward step inside
`$(…)` of another command or behind a pipe from one was not a chain, and
hundreds of thousands of words in front of a command took the hook past its
five seconds. Both are fixed and tested. The review also lists what it tried
and found closed; it is not a proof that nothing is left.

## Not verified

- **The shipping rules, more than once.** They were read cold by one session
  (2026-10-12), in a project created from the starter. It was given a
  one-word change and nothing about shipping but the section, and went from
  the worktree to the runs on main with no step missed and nothing refused:
  `READY`, the gate, one pull request, green for the pushed commit, nothing
  landed on main, a merge commit, the clean-up after the ancestor test, the
  runs for the merge commit. It reported twelve things it had to guess. Six
  are in the section now: ask for runs by the commit, name the place in an
  outward command, look at main before the first edit, a run not yet listed,
  the name of a removed branch, and the project's own checkout after the
  merge. One session on one change is not the next one. Not watched: two
  sessions merging at the same time, a red check, a conflict, and a failure
  on main after the merge.
- **The hook in a live session of Codex.** It was run by hand with Codex's
  payload. That side rests on its documentation and on the schemas in the
  0.160.0 binary (`PreToolUse`, tool name `Bash`, `tool_input.command` as
  text, `permissionDecision: "deny"`). Under Claude Code it ran in a headless
  session ([above](#in-a-live-session-of-claude-code)); the prompt of an
  interactive one was not watched.
- **Codex finding the skills** in `.agents/skills`. That is the documented
  place for a repository's skills; no session was run.
- **What a host does with a hook that times out or crashes.** That the call
  then goes ahead is from each host's documentation; no session was run to
  see it. The same holds for the `Edit(/path)` rule form.
- **Each ask rule in Claude Code itself.** One was run against an `allow`
  rule ([above](#in-a-live-session-of-claude-code)), and it won. The other
  eleven are matched in tests with a model of the pattern syntax: the
  documented one, and for a rule that ends in `:*` the code of version
  2.1.296, read on 2026-10-13.
- **How the hook tells the hosts apart, over time.** That Codex sends
  `turn_id` with every call and calls `ask` unsupported is from the schema
  and the messages in its 0.162.1 binary. If Claude Code comes to send a
  `turn_id`, the hook goes silent there and no test here sees it.
- **How each host reads a matcher and a hook entry.** From their
  documentation, read on 2026-10-06; no session was run. Codex's does not say
  whether a pattern must match the whole tool name, which is why only a list
  of plain names is read for it.
- **Settings the check does not read.** A person's own settings and managed
  settings can add hooks and can switch the project's off; so can the
  `--settings` flag. Codex runs a project's hook only after a person has
  reviewed and trusted it, and no file in the project records that. The
  check reads the project's two files, and `.claude/settings.local.json` for
  `disableAllHooks` only.
- **The workflow on GitHub.** It was linted, and its script was tested with
  a stand-in for `gh`. No tag or issue was created anywhere. The lint ran
  with no token, so zizmor's checks that ask GitHub (an action with a known
  advisory) did not run, and actionlint did not check the shell, since
  shellcheck was not installed. The `CI security` workflow runs both.
