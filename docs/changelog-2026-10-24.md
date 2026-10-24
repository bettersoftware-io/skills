# The changelog features of agent-workflow 0.20.0, tried in skills-demo, 2026-10-24

The changelog reminder, the new `pnpm changelog` subcommands, the release
mirror (`pnpm changelog:releases`) and the two workflows that are off until
switched on were tried in a real project, locally. Nothing was pushed, no pull
request was opened, and nothing was written to GitHub: no variable, no secret,
no tag, no release. This is what ran, and what did not.

## Setup

- skills-demo `main` at `a8d7733`, clean. `git fetch`, then the local branch
  `try-agent-workflow-0.20.0` from `origin/main`. The branch has one commit
  (`51c2afc`, install plus the entry) and is not pushed.
- The add-on came from this branch (`worktree-changelog`, `66401d4` when the record
  was written), run from inside skills-demo:

  ```
  node <worktree>/scripts/add-to-project.mts . agent-workflow
  pnpm install
  ```

- macOS 27.0.1 on arm64, Node 26.12.1, pnpm 12.6.0, Claude Code 2.1.310,
  Codex 0.164.0.

## 1. Install

Exit 0. Created or merged, trimmed:

```
created  docs/IDEAS.md, docs/STATUS.md
changed  package.json: scripts.worktree, worktree:audit, changelog, changelog:releases, agent-workflow:check, check:status
changed  package.json: scripts.gate:fast now also runs "pnpm check:status"
merged   .claude/settings.json: 18 permissions.ask rules, among them
         Bash(pnpm changelog tag *--apply*) and Bash(pnpm changelog:releases *--apply*),
         Edit(/tools/agent-workflow/**)
merged   .claude/settings.json: hooks.PreToolUse: split-outward-commands.mts
merged   .claude/settings.json: hooks.SessionStart: changelog-due.mts
merged   .codex/hooks.json: hooks.PreToolUse: split-outward-commands.mts
merged   .codex/hooks.json: hooks.SessionStart: changelog-due.mts
added    AGENTS.md: the section for agent-workflow
```

`git status` showed, as new files, `.github/workflows/changelog-writer.yml`,
`.github/workflows/sync-releases.yml` and `.github/workflows/weekly-tag.yml`,
`CHANGELOG.md`, `.claude/commands/`, `.agents/` and `tools/agent-workflow/`.
The summary's tail printed only the settings and hooks; the workflows are
named by `git status`, not by the summary lines that were kept. `pnpm install`:
done in 1.6 s.

## 2. The checks, with no week yet

| Command | Result |
| --- | --- |
| `pnpm agent-workflow:check` | exit 0, 15 PASS: the hook, both hosts' registration of it, **both hosts' SessionStart reminder**, the edit rule, "all 18 ask rules are in", the seven commands; one SKIP |
| `pnpm changelog:releases --check` | exit 0, `SKIP sync-releases: CHANGELOG.md has no week yet, so there is no release to render` |
| `pnpm gate:full` | exit 0, every stage PASS or SKIP (34 lines; the SKIPs are `types-only`, `animations`, `dockerfiles`, `packages/e2e`, `packages/integration`) |

The one SKIP in `agent-workflow:check`: `changelog releases: CHANGELOG.md has no
week yet, so there is no release to render`.

`gate:full` includes `check:status` (`docs/STATUS.md — its sections, its date and
its entries are in the page's form`) and `lint:dead` (knip found nothing unused).

## 3. What is due, and the hook as each host starts it

`git fetch`, then:

```
$ pnpm changelog due
2026-W42  3 merged, no entry: write it with /workflow:changelog 2026-W42
(exit 1)
```

W42 (12 to 18 October) is the last finished week. Its three merged pull
requests are skills-demo's real ones (`pnpm changelog prs 2026-W42`):

```
2026-10-16  #12  Take the kit's update: AGENTS.md says a check comes through the installer
2026-10-16  #14  chore: kit and add-ons from bettersoftware-skills 0.17.0; Renovate in place of Dependabot
2026-10-18  #15  Take visual 0.19.0: the pyramid, faithful pages, per-scenario tolerance
```

The hook, started as each host starts it:

```
$ echo '{}' | node tools/agent-workflow/hooks/changelog-due.mts
$ echo '{"turn_id":"t1","hook_event_name":"SessionStart","source":"startup"}' | node tools/agent-workflow/hooks/changelog-due.mts
```

Both exit 0 and print the same JSON (the second is the Codex payload with a
`turn_id`):

```
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Changelog: as of the last fetch of the default branch, these weeks are due in CHANGELOG.md:\n2026-W42  3 merged, no entry: write it with /workflow:changelog 2026-W42\nMention this to the person at a natural point; do not drop the task you were given to write it. In Codex the command is $workflow-changelog <week>."}}
```

## 4. The entry, and what reads it

The entry for 2026-W42 was written in this session, following
`.claude/commands/workflow/changelog.md`: steps 1, 2, 4, 5 and 6 (step 3, the
worktree, was skipped, as the branch was made for this trial; step 7, shipping,
was not done). The three pull requests' bodies were read before summarising.
It has a summary, `Added`, `Changed`, `Decisions` and `Under the hood`, and
cites #12, #14 and #15. Committed locally on the trial branch.

```
$ pnpm changelog defs --write
wrote the link definitions of CHANGELOG.md
$ pnpm changelog check 2026-W42
PASS changelog 2026-W42: 3 merged pull request(s), all cited, every citation defined
$ pnpm changelog defs
PASS changelog defs: the link definitions are the generated ones
$ pnpm changelog:releases --check
PASS sync-releases: 1 week(s) render as release notes
$ pnpm agent-workflow:check          (last line)
PASS changelog releases: 1 week(s) of CHANGELOG.md render as release notes
$ pnpm changelog due                 (exit 0, nothing printed)
```

The hook, run again with the entry in, printed nothing (0 bytes) and exited 0.
`pnpm gate:fast` passed.

The release notes of the week, offline:

```
$ pnpm changelog:releases --body 2026-W42
<the entry's text, with each [#15] written as (#15), the link definitions left out>

---

Generated from the [2026-W42 entry](https://github.com/bettersoftware-io/skills-demo/blob/main/CHANGELOG.md#2026-w42--12-oct--18-oct) in `CHANGELOG.md`. Edit it there: this release is rewritten whenever that section changes.
```

With a fixture that holds the week's tag and no release
(`{"tags":["2026-W42"],"releases":[],"latestTag":"2026-W42"}`, kept in the
plan's folder as `task-10-state.json`):

```
$ pnpm changelog:releases --state <fixture>
create 2026-W42 (latest)
sync-releases: 1 to write, 0 unchanged
```

The plan creates one release, marked Latest. `--apply` was not run.
`changelog tag --apply` was not run either.

## 5. A real session of each host

The question, and only it: `say what the session context says about the
changelog`. skills-demo has no tag and no open week, so the first run was
made with the entry in.

**Claude Code, with the entry committed (nothing due).** `claude -p ... --max-turns 2`
exit 0. It listed the rules and commands of the "The changelog" section of
`AGENTS.md`, and said: "this session didn't start with a note of due weeks."
That is the designed silence: the hook printed nothing as nothing was due.

**Claude Code, with W42 due.** To make a week due without touching the
branch, the checkout was detached at the same commit, `CHANGELOG.md` was cut
back to its introduction (uncommitted), the question was asked, and the file
was put back and the branch switched to again. `pnpm changelog due` printed the
W42 line first. The session answered, in part:

```
1. The startup note (from a SessionStart hook)
> Changelog: as of the last fetch of the default branch, these weeks are due in CHANGELOG.md:
> 2026-W42  3 merged, no entry: write it with /workflow:changelog 2026-W42
> Mention this to the person at a natural point; do not drop the task you were given to write it. In Codex the command is $workflow-changelog <week>.
So one week is due: 2026-W42. It had 3 merged pull requests and has no entry yet.
```

The reminder reached the model, in a headless Claude Code session.

**Codex 0.164.0, with W42 due,** the same way:
`codex exec -s read-only --ephemeral "<the question>"`, exit 0, `approval: never`.
The whole answer:

```
The project's `workflow-changelog` skill applies when asked to write or update a week's entry in `CHANGELOG.md`, or to close an issue titled "Changelog: write <week>." It does not apply to release notes for a published package.
```

The reminder did not appear. The log shows no hook line. Codex asks a person
to trust a project's hooks with `/hooks`, which is interactive and was not done,
so an untrusted hook not running is the likely reason; that was not
established. The skill's description did reach the session. What Codex does
after the hook is trusted is not seen.

The skills-demo branch was left on `try-agent-workflow-0.20.0`, clean, ahead of
`origin/main` by one commit, unpushed.

## What passed

- The install: exit 0, both hosts' settings files, `AGENTS.md`, the two new
  workflows and `weekly-tag.yml` written.
- `agent-workflow:check`, `changelog:releases --check` (SKIP, then PASS),
  `gate:full`, `gate:fast`.
- `due`, `check`, `defs`, `--body`, `--state` and the hook with both payloads,
  against a real week of a real repository.
- The reminder in a headless Claude Code session when a week is due, and its
  silence when none is.

## What was not seen

- **The two workflows on GitHub.** `sync-releases.yml` and
  `changelog-writer.yml` are off until a repository variable switches them
  on; no variable was set and nothing ran them.
- **A real release.** `--apply` was never run; the plan against a fixture says
  `create`, and no release exists.
- **A run of the writer,** the headless agent of `changelog-writer.yml` with no
  write token. The entry here was written by an interactive session.
- **A tag created through the API with a `tagger.date`.** No tag was made;
  `changelog tag --apply` asks first, and was not run.
- **Codex.** It ran, and the reminder did not appear. The hook was not
  trusted with `/hooks`, so whether it fires once trusted is not known.
- **The reminder in an interactive Claude Code session.** Only `claude -p`.
- **`pnpm changelog prs` and the release plan against GitHub** ran with the
  `gh` of this Mac and no variable, not in a workflow.
