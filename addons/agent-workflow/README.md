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
| Permission rules | `.claude/settings.json` | Merged in: eighteen `ask` rules (twelve for a forced or destructive push and an `--admin` merge, six for the spellings of `--apply` on `changelog tag` and `changelog:releases`), and one for an edit of the hook. No `allow` rule |
| `pnpm worktree <name> [--ready]` | `tools/agent-workflow/new-worktree.mts` | A worktree beside the project on `worktree-<name>`, cut from `origin`'s main by name |
| `pnpm worktree:audit [filter]` | `tools/agent-workflow/audit-worktrees.mts` | One verdict for each linked worktree, against `origin`'s main: merged, merged with files not committed, or work main does not have. Then orphan branches and stray folders. It only reads |
| `pnpm changelog weeks\|due\|prs\|check\|defs\|tag` | `tools/agent-workflow/changelog.mts` | The weeks with no entry, the finished weeks still due (offline), a week's merged pull requests, the proof that each is cited, the link definitions (`defs --write` writes them), and a week's tag, dated by its week (`tag <week> --apply`; it plans without `--apply`) |
| The session-start reminder | `tools/agent-workflow/hooks/changelog-due.mts` | Under `hooks.SessionStart`: names the finished weeks that are due as context for the session ([below](#the-session-start-reminder)) |
| Weekly tag | `.github/workflows/weekly-tag.yml`, `tools/agent-workflow/close-week.mts` | Monday 00:05 UTC: tags the finished ISO week, and opens "Changelog: write `<week>`", or "Changelog: extend `<week>`" when the week has a heading. No issue when the entry already cites every pull request GitHub lists for the week |
| `pnpm changelog:releases [--apply]` | `.github/workflows/sync-releases.yml`, `tools/agent-workflow/sync-releases.mts` | One GitHub Release for each tagged week, made from that week's section of `CHANGELOG.md`. Off until the repository variable `CHANGELOG_RELEASES` is `true` ([Releases](#releases)). `--check` renders every week offline, and `pnpm agent-workflow:check` runs it too |
| Changelog writer | `.github/workflows/changelog-writer.yml` | Monday 01:00 UTC: Claude Code writes the due weeks and a pull request is opened. Off until `CHANGELOG_WRITER` is `true`, and it costs money ([The writer in CI](#the-writer-in-ci)) |
| `CHANGELOG.md` | project root | A starting file: the format, no week yet. The project owns it |
| `docs/STATUS.md` | `docs/` | A starting file: the six sections of what is left, no entry yet. The project owns it |
| `pnpm check:status` | `tools/agent-workflow/check-status.mts` | Joins `gate:fast`. The page has the six sections, each once, in order, one "Last updated" line with a real date that is not after today, and each entry starts with its name in bold. A page that differs from the last commit's has today's date |
| `docs/IDEAS.md` | `docs/` | A starting file: what nobody has committed to. The project owns it |
| Seven commands | `.claude/commands/workflow/*.md` | `/workflow:status`, `/workflow:docs`, `/workflow:worktrees`, `/workflow:changelog`, `/workflow:coverage-backfill`, `/workflow:visual-tolerance-audit`, `/workflow:perf-audit` |
| The same for Codex | `.agents/skills/workflow-*/SKILL.md` | One small skill per command, which points at the command file |
| `node tools/agent-workflow/requires.mts <add-on>` | same | Exit 0 when the add-on is installed, exit 2 with what to do when not |
| `pnpm agent-workflow:check` | `tools/agent-workflow/check.mts` | The add-on's `verify`: runs the hook on three commands as each host starts it, reads both settings files, and renders each week of `CHANGELOG.md` as release notes, offline |

Only `pnpm check:status` joins a gate, `gate:fast`. The hook check does
not: a host's settings file is the project's to change, and a gate that
failed when someone removed a permission rule would fight the owner of the
file. It is run by hand. The status page's form is the add-on's own rule,
written in its section of `AGENTS.md`, so its check is a gate.

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
- **A check of the page's form.** `pnpm check:status` holds the sections,
  the date and the shape of an entry. The date is judged against the last
  commit only while the page has changes not committed yet, so CI, which
  checks out a commit, never judges it: the gate run before a session ends
  does.

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
(`git commit -m "$(git push)"`) or beside another `$(…)` that runs
something (`A=$(git add -A) B=$(git push)`), behind a pipe from another command
(`git commit -qam wip | git push`), or as the text given to `bash -c` or
`eval`. Two outward steps in one command are refused however they are
joined.

A step is read behind a program that only runs it: `time`, `command`,
`exec`, `nohup`, `env`, `timeout`, `nice`, `stdbuf`, `builtin`, `noglob` and
`xargs`, each with its own options (`nice -n 5`, `timeout -s KILL 30s`). Claude Code
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

Eighteen `ask` rules for commands are merged into `.claude/settings.json`.
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
| `Bash(pnpm changelog tag *--apply*)`, `Bash(pnpm run changelog tag *--apply*)`, `Bash(node tools/agent-workflow/changelog.mts tag *--apply*)` | creating a week's tag, by each way to run it |
| `Bash(pnpm changelog:releases *--apply*)`, `Bash(pnpm run changelog:releases *--apply*)`, `Bash(node tools/agent-workflow/sync-releases.mts *--apply*)` | writing GitHub Releases, by each way to run it |

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

## The worktree audit

Several sessions work on one project, and worktrees are left behind: some
merged and forgotten, some holding work someone stopped in. Nothing told
them apart. `pnpm worktree:audit` fetches `origin`'s main and gives each
linked worktree one verdict against `origin/<main>`. The project's own
checkout is not judged. The main branch is found as the worktree script
finds it.

```
MERGED  rates-filter
  path:    /work/app-worktrees/rates-filter
  branch:  worktree-rates-filter
  tip:     96d419b 2026-10-12 Grey out a stale price
  tree:    clean: no file is changed or untracked. Files git ignores are not looked at
  remove:  git worktree remove /work/app-worktrees/rates-filter
           git branch -D worktree-rates-filter

UNMERGED  login
  path:    /work/app-worktrees/login
  branch:  worktree-login
  tip:     5c1e2aa 2026-10-09 Half of the form
  commits: 2 not on origin/main, the newest 4 days ago
           5c1e2aa Half of the form
           0b7d913 Start the login form
  tree:    1 path not committed: notes.txt (untracked)
  Live work. No removal command is printed for it
```

| Verdict | When | A command that removes it |
|---|---|---|
| `MERGED` | The commit it stands on is an ancestor of `origin/<main>` (`git merge-base --is-ancestor`), and `git status` names no changed and no untracked file | `git worktree remove <path>`, then `git branch -D <branch>`. Never `--force`. None when it may hold no work of its own, when it is locked, or when its path or branch cannot be printed as one word; the lines under the verdict say which |
| `MERGED, NOT CLEAN` | The commit is on main, and the tree holds changed or untracked files: how many, and the first five | None |
| `UNMERGED` | It has commits main does not have: how many, the first five subjects, how old the newest is, and what the tree holds | None, ever |
| `NOT JUDGED` | git could not say whether the commit is on main, or it is on main and the tree could not be read | None |

Under a verdict the report says what else git knows about the worktree:

- **Detached.** No branch is checked out, so the verdict is about the commit
  it stands on, and no command is printed for a branch.
- **Locked**, with the reason when one was given. No command is printed: git
  refuses to remove a locked worktree, and unlocking is for whoever locked it.
- **Prunable.** Its folder is gone. It is judged by the commit it stood on,
  and `UNMERGED` then says the commits are still in the repository.

After the worktrees:

- **Orphan branches**: local branches named `worktree-*` that no worktree
  has checked out, the project's own checkout included. Each is `MERGED` or
  `UNMERGED` by the same test. A merged one gets `git branch -D <branch>`.
- **Stray folders**: what is in `<project>-worktrees/` and is no worktree git
  knows, each with the first five entries of its top level. A link is named
  and not followed. They are listed and left where they are.
- A `count:` line, a `next:` line for each kind of thing the report holds,
  and a last line that is `OK` or `SKIP`. `MERGED` does not mean that a
  command was printed. When a `MERGED` worktree has none, the count says for
  how many there is one (`MERGED 3 (a command for 1)`), and a `next:` line
  says not to write the missing command by hand.

`[filter]` keeps the worktrees whose name holds it. It is one plain word, as
a worktree's name is, and is refused before git is asked anything. Orphan
branches and stray folders are all listed whatever the filter.

| Exit | Means |
|---|---|
| `0` | Everything was read, and judged against `origin`'s main as fetched in this run. The verdicts do not change it: a worktree to remove and work left behind fail nothing |
| `2` | Something was not read or not judged, and the last line says what: the fetch failed, a worktree or an orphan branch is `NOT JUDGED`, the filter matched no worktree, the branches or the worktree folder could not be read, the clone has no `origin/<main>`, this is not a git repository, a wrong argument. Not a pass |

There is no exit 1. This is a report, and it has no finding that fails.

**It only reads.** It removes no worktree, deletes no branch, prunes nothing
and deletes no folder. A command that does is printed for a person. What it
changes is what `git fetch origin <main>` changes: `origin/<main>`,
`FETCH_HEAD`, and a tag the fetch follows. Every other call to git asks a
question, and a test holds the list of them. A tree is read with
`git --no-optional-locks status`, so the index of a worktree a session is
working in is not rewritten under it. Untracked files are asked for by name
(`--untracked-files=normal`): a person's git can be set to hide them, and a
tree that hides them would read as clean.

**It joins no gate.** It reports on one machine, not on the project: two
clones of the same commit give two reports.

**A failed fetch is said first and last.** The report still comes, judged
against `origin/<main>` as the clone last had it, with how long ago that
last moved when the clone's reflog says. Its last line is `SKIP` and the
exit is 2, because a main that is behind makes merged work read as
`UNMERGED`. A clone with no `origin/<main>` at all is not judged.

**A squash reads as `UNMERGED`.** The test is whether the branch's commit is
on main. After a squash or a rebase main holds other commits, and the
branch's own are on no other branch. The report says so once, with the rule:
a merge commit.

**A worktree just made reads as `MERGED`, and gets no command.** It stands
on a commit of main and its tree is clean, which is also what
`pnpm worktree` leaves. The tool cannot see a session, so it reads what it
can: the commit is on main's own line (a merge's first parent each time),
where the tip of a branch merged by a merge commit is not. For a worktree on
that line the verdict stays `MERGED`, and under it stand two lines and no
`remove:`:

```
  note:    its commit is one main itself once stood at, so it may hold no work of its own. A worktree just made looks like this: a session may be about to work in it
  No command is printed for it. Ask whose it is first: it is finished only if nobody is about to use it
```

Several sessions work on one project at once, and a worktree another
session made a minute ago is exactly this case: a pasted removal takes the
ground from under that session. In two runs against real checkouts
(2026-10-13) two of four worktrees were this case, and both belonged to
sessions that were still running. Three things follow:

- A worktree that was made and never used gets no command either. A person
  who knows it is nobody's removes it by hand.
- A branch that was fast-forwarded onto main stands on that line too, and
  reads the same. The rule here is a merge commit.
- When git cannot say which line the commit is on, it is taken as this case.

**Printed text is written out, and a printed command is safe to paste.** A
branch's name, a path, a file's name, a commit's subject and what git said
on a failure all come from outside the tool:

- Every line goes out through one function (`lib/shown.mts`), which writes
  a control character, a mark that turns the text round or has no width, a
  line end and a space that is not the space as its escape (`\u001b`), by
  Unicode's classes. A subject cannot clear a line and write a verdict, and
  a file's name with a line end in it is one name on one line.
- No line starts with text from outside. A stray folder named like a command
  is printed after the word `STRAY`.
- A path or a branch in a printed command is one word for a POSIX shell: as
  it is when it holds only letters, digits and `_ @ % + = : , . / -`, in
  single quotes otherwise, a quote inside written `'\''`. No command is
  printed for a name that holds a character the report writes out (the word
  on the screen would not be that name), for one that starts with `-`, or
  for one Node could not read as text. The report says so, and whether it
  is the path or the branch.
- A commit is handed to git only as a full hash, and the main branch only
  after the check the worktree script makes. git lists worktrees and files
  with `-z`, so a name with a line end in it is one field.

**git is started by its name**, as this add-on's other tools start it: the
first `git` on the PATH. The settings check of `ci-security` looks for it
only in a folder no project fills. Nothing here does.

Differences from the source:

- **No sessions.** The source names the Claude Code sessions that drove a
  worktree, with the command that resumes each. It reads one host's files
  under a person's home and needs a tool of its owner's, and this add-on
  serves Codex too. So the tool cannot say that a session is running in a
  worktree, and says so.
- **Nothing is deleted.** The source removes a stray folder that holds only
  editor state, by a standing permission of its owner. Here every stray
  folder is listed.
- **It fetches.** The source judges against the clone's `origin/main` as it
  is and tells the reader to fetch first.
- **Only `origin/<main>` is judged against.** The source falls back to a
  local `main`, `master` or `HEAD`.
- **One worktree folder.** The source also looks for strays under
  `.claude/worktrees` inside the project. This add-on makes none there.
- **No size on disk.** The source runs `du` on every worktree.
- **`NOT JUDGED`, locked and prunable** are added, and so is the worktree
  with no commit of its own, which gets a note and no command. The source
  reads git's failure as `UNMERGED`, and prints the commands for every
  worktree that is merged and clean.

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
in its own week's section, a pull request cited there must have been merged
in that week, and the link definitions must be exactly the ones
`pnpm changelog defs --write` writes. It asks `gh` for the week's merged pull
requests and keeps those merged inside the week to the second.

## The session-start reminder

A `SessionStart` hook, `changelog-due.mts`, runs when a session starts (in
both hosts on `startup`, `resume` and `clear`). When a finished week has no
entry, or its entry does not cite every pull request merged in it, it gives
the agent this as context:

```text
Changelog: as of the last fetch of the default branch, these weeks are due in CHANGELOG.md:
2026-W41  7 merged, no entry: write it with /workflow:changelog 2026-W41
Mention this to the person at a natural point; do not drop the task you were given to write it. In Codex the command is $workflow-changelog <week>.
```

- **It names five weeks at most.** A project further behind is told how many
  more there are; `pnpm changelog due` lists them all.
- **It reads git only, as of the last fetch.** It asks no network. A week
  merged since `origin`'s default branch was last fetched is not in it. Run
  `git fetch` first, or `pnpm changelog due`, which reads the same.
- **It knows a pull request by the subject of its commit on the default
  branch.** Following first parents only, it counts GitHub's `Merge pull
  request #12 from …`, `Merge PR #12: …`, and a subject that ends in
  `(#12)` after a space, as a squash merge writes it (with several, the
  last). A rebase
  merge leaves no such commit, so the reminder never sees those pull
  requests. `pnpm changelog check` asks GitHub, and sees them.
- **A commit pushed straight to the branch with `(#12)` at the end of its
  subject counts as pull request 12** for the reminder, and not for `check`,
  which asks GitHub what was merged. Leave it out of the entry and the
  reminder names the week; cite it and `check` fails. Push such a commit
  without the number.
- **It is silent when it cannot judge.** No git, no `origin`, no
  `CHANGELOG.md`, or anything unforeseen: it prints nothing and exits 0. A
  session is never held up or alarmed by it, and silence is not "nothing is
  due".
- **Codex needs `/hooks`.** A hook it has not seen is not run until you trust
  it. Open `/hooks` in Codex and trust the new one.

## Releases

`sync-releases.yml` mirrors `CHANGELOG.md` onto GitHub Releases: one release
for each tagged week, titled like its heading, its notes made from that
week's section. The newest tagged week is marked Latest. It runs when the
file changes on the default branch, on Monday at 00:30 UTC, and by hand.

It is off. To switch it on:

```bash
gh variable set CHANGELOG_RELEASES --body true
```

**Publish one week first, and look at it.** Setting the variable takes effect
at the next trigger: a push that changes `CHANGELOG.md` or the sync scripts,
Monday 00:30 UTC, or a run by hand. That run publishes every tagged week at
once. So before it:

```bash
pnpm changelog:releases --only <week> --apply
```

Open that release on GitHub. `pnpm changelog:releases --body <week>` prints
what any week would say, and `pnpm changelog:releases` alone prints the plan.

- **The script takes the default branch from GitHub**, for the links that
  point at files. A push to another branch writes nothing.
- **Never edit a release by hand.** `CHANGELOG.md` is the only source. The
  next run rewrites a release whose section differs, and your edit goes.
- **A tag that carries the wrong date lists out of order.** A release takes
  its place in GitHub's list from the date of its tag. Tags are now dated by
  their week (the Monday 00:05 UTC after it), but one made before that keeps
  the date it has. The add-on does not repair a tag, and never moves one. RTC
  backdated its 28 past tags to the Monday 00:05 UTC after each week by hand.

## The writer in CI

`changelog-writer.yml` writes the weeks `pnpm changelog due` lists, with
Claude Code, and opens one pull request for them. A person reviews and merges
it. The workflow never merges.

**What it costs.** One paid run each Monday when a week is due, billed to your
Anthropic account and bounded by its 40-turn cap. A run that finds nothing
due installs nothing and calls nothing. A project that will not pay leaves it
off, and RTC leaves it off.

**How to switch it on:**

```bash
gh variable set CHANGELOG_WRITER --body true
gh secret set ANTHROPIC_API_KEY
```

It also needs the repository setting "Allow GitHub Actions to create and
approve pull requests" (Settings, Actions, General). Without the variable the
job is skipped. With it and without the secret the run fails, and says so.

**How it is built.** Two jobs, so that the agent never holds a token that can
write:

- `write` runs Claude Code with a read-only token. It may edit only
  `./CHANGELOG.md`, reads only inside the checkout, runs with
  `--setting-sources user`, and uploads the file.
- `publish` runs no agent and installs nothing. It checks that `CHANGELOG.md`
  did not change on the default branch during the run, scans the added lines
  for token-shaped strings, runs `pnpm changelog check` for each week, commits,
  pushes `changelog/<newest week>`, finds the reminder issue by its bot
  author, and opens the pull request with a body the workflow writes. The
  pull request is a draft when a check failed.

A free first step skips the run when an open changelog pull request by
`app/github-actions` exists.

What to know:

- **Checks do not start on its pull request.** A pull request opened with the
  job token starts no checks. Close the pull request and reopen it.
- **The action's human-actor check.** The Claude Code action may refuse a
  scheduled run when a bot last edited the cron line. Its `allowed_bots` input
  lets one through.
- **A leftover branch.** A `changelog/<week>` branch left from a closed pull
  request makes the push fail. Delete it.
- **When the agent stops early.** If it hits the turn cap, no pull request is
  opened, and the week stays due: the next session's reminder names it again.
- **Protect the default branch.** The workflow pushes a branch and never the
  default one, and a branch rule is what keeps it so.
- **The read rules are not a sandbox.** The agent may read only inside the
  checkout, and the rules deny `/proc`, `/dev` and the runner's temp folder.
  The secret scan and the exact-key check in `publish` are a backstop.
- **The secret scan is a prefix list, not a proof.** It finds the shapes of
  the common tokens and keys, and the exact value of `ANTHROPIC_API_KEY`. A
  secret of another shape passes it. The pull request is read before it is
  merged.

## Commands, and the three that need another add-on

All seven commands are always installed. The three that need another add-on
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

Three commands need nothing else:

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

- **`/workflow:worktrees`** is the reading of `pnpm worktree:audit`
  ([above](#the-worktree-audit)): what to say about each verdict, and the
  rule from the source that nothing is removed before a yes that names what
  goes. It is granted the audit and nothing else, so each `git worktree
  remove` it is told to run asks.

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
  be told to start a program (`--upload-pack`, `--open-files-in-pager`), nor
  `git log` and `gh run download`, which can be told to write a file where
  they are told. Each asks, as it would with no command running.

What this does not hold: a grant is by a program's first words, and the
words after them are the agent's. `git status` cannot be turned into a push,
but a project's own script that is granted (`pnpm worktree`,
`pnpm coverage:gaps`) is run with whatever arguments follow, and does what
that script does with them. A second security review named the list as one
that can be got round, with no detail; `git log` and `gh run download` went
from it for that reason, and what is left is this.

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
| The changelog reminder | `SessionStart` in `.claude/settings.json`, matcher `startup\|resume\|clear` | `SessionStart` in `.codex/hooks.json`, matcher `startup\|resume\|clear`. Codex asks you to trust a new hook: run `/hooks` |
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
- `tests/audit-worktrees.test.mts`: each verdict; a branch merged by a real
  merge commit and one whose changes reached main by a squash; detached,
  locked and prunable; orphan branches and stray folders; the filter; a
  failed fetch; a subject, a branch's name, a file's name and git's own
  stderr with a control character or a text-direction mark in them; a path
  with a space and a quote in it, whose printed commands are then run in a
  real shell and remove that worktree and no other; and the state of the
  repository before and after a run, which is the same. Its 155 mutants are
  at the end of `tests/mutants.json`; they were run on 2026-10-13 and all
  killed.
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
interactive session, and any other version.

### In a live session of Codex

Run on 2026-10-13 with Codex 0.162.1, headless (`codex exec`, sandbox
`workspace-write`), in a scratch repository with a folder as `origin` and
the add-on's `.codex/hooks.json`. The hook is one no person had trusted
there, so the run was started with `--dangerously-bypass-hook-trust`; a
project's own first run asks a person to trust it instead.

| Command | What happened |
|---|---|
| `git status --short && git push origin main` | Not run. Codex reported the hook's refusal, word for word |
| `git push origin main:other` | The hook answered nothing, Codex reported no hook error, and its own approval let the command run |

The payload Codex sent for the second was recorded: tool name `Bash`, the
command as text, and a `turn_id`, with `cwd`, `hook_event_name`, `model`,
`permission_mode`, `session_id`, `tool_use_id` and `transcript_path` beside
them. So the field the hook tells Codex by is there, and the refusal is read.
Not seen: a hook that a person trusts in the usual way, and a command sent as
a list of words.

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
five seconds. Both are fixed and tested.

What it tried and found closed, so that the next review need not start from
nothing. The hook does not read these, and the host asks about them itself
or matches no rule for a push to them:

- A quote the hook loses track of (`echo $'\'' ; git push … #'`,
  `${x:-"}"}`): the host refuses `$'…'` and `${…}` as too complex to judge.
- A push inside `${x:-$(…)}`, in the body of an unquoted heredoc, in a
  function defined and called on one line, in a `case`, in zsh's `=(…)`:
  the host asks.
- `git --attr-source HEAD push`, `git --config-env=… push`,
  `git -c alias.x=push x`, `git $'pu\x73h'`: the text no longer begins
  `git push`, so no `allow` rule for a push matches it.
- `env -u X`, `exec -a x`, `xargs -n1`, `coproc`, `repeat 2`, `nocorrect`:
  the host does not look past them either.
- `bash -c -- '…'`, `bash -Cc '…'`, `bash <<EOF`: needs an `allow` rule for
  `bash`.
- `HOME=/tmp/x; git push …`, `git push origin =main`: the host refuses the
  assignment and the `=cmd` form.
- A line continued with a backslash, `&|`, `|&`, a tab, a carriage return, a
  no-break space, and `"git"`, `\git`, `/usr/bin/git`: the hook asks or
  refuses as it should.

A second review, the same day, was given the hook as the first one left it.
It found no command that gets past, and none of 23 everyday commands around
a push or a pull request wrongly refused. It named one candidate, a command
used as a file beside a plain push (`git push origin b > >(curl …)`, and the
same with `< <(…)`): the hook says nothing about it, and from the host's
code the reviewer read that an `allow` rule lets it run. A live run said
otherwise. Claude Code 2.1.296, with `Bash(git push *)` allowed and no hook,
refused both forms ("A command used as a file in this command can't be
checked before it runs") and ran a plain push. So what a reviewer reads in
the host's code is a lead, and a run decides. Also tried and closed:
`coproc git push` (the host matches no rule to it), `;;`, `&!`, `&` (refused
as chains), and `git push origin tag v1.0`, which is plain words: one tag,
for the project's own rule to decide.

Those lists are what two reviews tried. They are not a proof that nothing is
left.

A third review, on 2026-10-24, read the hook's reader (`lib/shell.mts`)
against bash, and found three places where the reader saw text and bash ran
a command, so that a push there was neither refused nor asked about. Each is
a test now, and so is each of the same kind found while closing them, run in
bash 5.3 and 3.2, zsh and dash:

| Found | Example | Now |
|---|---|---|
| `$'…'` ended at an escaped quote | `echo $'\'' ; git push … #'` | Read to its real end: refused as a chain |
| An unquoted heredoc's body was skipped; bash runs the `$(…)`, backticks and `${…}` in it | `cat <<EOF` with `$(git push …)` in the body | Read as a substitution. A quoted delimiter (`'EOF'`, `"EOF"`, `\EOF`) keeps the body as text |
| `${…}` was read to its first `}`, never inside | `echo ${x:-$(git push …)}` | Read inside, a `}` in quotes included |
| `<<` in arithmetic was taken for a heredoc, which hid the lines after it | `echo $((1<<2))` then a push, then `2` | `$((…))`, `$[…]` and `((…))` are arithmetic; what `((…))` holds is read as commands too, as dash runs it |
| A heredoc opened before a quote that holds a new line took its body from inside the quote | `cat <<EOF "`, a new line, `"; git push …; echo "`, and the body | The body begins after the next new line outside quotes |
| Backticks were closed where the reader's quotes said; bash 5 closes them at the first backtick no backslash escapes, and runs the push after them | ``echo `echo 'x`; git push …`` | Closed where bash closes them. What these hold is unreadable, so it is asked about |
| A line continuation joins what stands on either side before bash reads: `ca\` and `se` on the next line are `case`, `E\` and `OF` an unquoted `EOF`, `$\` and `(` a `$(` | `cat <<E\`, then `OF`, and `$(git push …)` in the body | Every continuation is taken out of the whole command once, before it is read, as bash does, two or more in a row included (`\|`, two continuations and `\|` are `\|\|`). Single quotes and a quoted heredoc's body keep theirs, as in bash. One that ends a comment, where bash keeps the new line, makes the command unreadable, so it is asked about, inside `((…))` too. So does one in text made again from the command: backticks make two backslashes one, and a new line after it is then a continuation the reader has not taken out. A command that cannot be read is asked about when `push` or `gh` stands in it with its continuations taken out |
| Inside double quotes, backticks kept `\"` as written; bash makes it `"` | `` echo "`echo \" ' \"; git push …; echo \" ' \"`" `` | `\"` is `"` there too: refused as a chain |

What shells read differently from one another, the reader does not read:
the command is unreadable, and is asked about when it names an outward step.
That is any unquoted `case` inside `$(…)`, wherever it stands (`f() { case
…`, `function f { case …`), since its patterns end in `)`; a quote inside
`${…}` within double quotes, a heredoc or arithmetic; a single quote in
arithmetic; a heredoc opened inside a substitution whose body would come
after it; and backticks whose content is itself unreadable. `$"…"` was read
right already: it is a double-quoted string to the reader, as to bash.

Each `((` is tried as arithmetic to its own close before it is taken for a
subshell, so a long run of brackets cost one look ahead per bracket. What
those tries read, over the whole command, is bounded by the longest command
(a million characters). Past that the command is not read, and is refused
when it names an outward step: a hundred thousand brackets are answered in
well under a second.

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
- **The audit's report in an agent's hands.** `pnpm worktree:audit` was run
  by hand on 2026-10-13 against two real checkouts, with one and with three
  linked worktrees. The verdicts matched what `git status` and
  `git merge-base` said of each, and the worktrees, the branches, the stash,
  each tree's status and index and the worktree folder were the same before
  and after. No session of either host was given a report to act on, and no
  printed command was run outside a test.
- **A session at work in a worktree.** The audit cannot see one. In those two
  runs, two of the four worktrees read as `MERGED` with the note that they
  may be new. Whether a session was at work in them, the tool could not say.
- **The audit with a git older than 2.36, in a shell that is not a POSIX
  one, and on a name that is not text.** It was run with git 2.56.0 only. An
  older git does not know `git worktree list -z`: the tool then stops at
  "could not list" and exits 2, which is tested with a folder that is no
  repository and not with an old git. The quoting of a printed command was
  tested with `sh`, and never on Windows. macOS refuses a file name that is
  not UTF-8, so such a path was tested as a word only, not through git.
- **The hook in front of a person.** It ran in a headless session of each
  host ([Claude Code](#in-a-live-session-of-claude-code),
  [Codex](#in-a-live-session-of-codex)). The prompt of an interactive
  session was not watched in either, nor Codex asking a person to trust the
  hook.
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
