---
description: Write the week's entry in CHANGELOG.md from the pull requests merged that week, then ship it as a pull request
argument-hint: [ISO week, e.g. 2026-W41. Default: every week not yet in the file]
allowed-tools: Bash(pnpm changelog weeks), Bash(pnpm changelog due:*), Bash(pnpm changelog prs:*), Bash(pnpm changelog check:*), Bash(pnpm changelog defs:*), Bash(pnpm worktree:*), Bash(pnpm gate:fast:*), Bash(gh pr view:*), Bash(gh issue list:*), Bash(gh repo view:*), Read, Write, Edit
---

Bring `CHANGELOG.md` up to date. Requested week: `$ARGUMENTS`. If that is
empty, or still reads as a placeholder because this host does not fill it in,
take the week from the request, and with none given write every week step 1
lists.

Run each step yourself, one command per call. This file runs nothing by
itself.

## 1. Find the weeks to write

```bash
pnpm changelog due
```

It lists the finished weeks whose entry is missing, or does not cite every
pull request merged in them, as of the last fetch of the default branch. It
reads git only. Exit 0 with nothing printed means nothing is due; exit 1
means weeks are listed, one on each line; exit 2 means it could not judge. Then:

```bash
pnpm changelog weeks
```

It prints each week with no entry yet, with its first and last day. A week
runs Monday to Sunday, and a pull request belongs to the week of its merge
time in UTC. If the only week listed is the current one and the file already
has its heading, that entry is partial: extend it in place, do not add a
second heading.

Read the top of `CHANGELOG.md` before writing. Its introduction states the
format, and the weeks already there show the tone.

## 2. List what was merged

```bash
pnpm changelog prs 2026-W41
```

Exit 2 means the list could not be fetched (no `gh`, no network). Stop and
say so. Do not write an entry from memory or from `git log`.

A title usually says what changed and why. Where it does not, or where the
pull request records a decision, read its body (`gh pr view <n> --json body`)
before you summarise it.

## 3. Start a worktree

```bash
pnpm worktree changelog-2026-w41 --ready
```

Skip this only when you are already in a worktree made for this entry.

## 4. Write the week

- Heading `## 2026-W41 — 5 Oct – 11 Oct`, newest week first.
- Two to four lines on what the week was about.
- `### Added`, `### Changed`, `### Fixed`: what a user of the app or a
  developer of the project would notice. Put related pull requests in one
  bullet with a bold lead. Do not write one bullet per pull request.
- `### Decisions`: choices worth remembering, each pointing at the document
  that holds the reasoning. A revert, an experiment that was dropped and a
  "we chose not to" all belong here.
- `### Under the hood`: tests, gates, tooling, docs, dependency updates.
  Automated dependency updates go on one line.
- Cite pull requests as `[#123]`. Use plain words a reader six months from now
  can follow.
- A week written before it ends is partial. End its summary with
  `(partial: written 2026-10-08)`, the day you wrote it, and extend the entry
  in place later: add the new bullets and the new citations, then replace the
  note with a new date, or take it out once the week is over and the entry is
  complete.

Leave out a section that would be empty.

## 5. Write the link definitions

Each cited pull request needs a definition at the bottom of the file, in
ascending order, and the file holds exactly the ones `defs` generates:

```bash
pnpm changelog defs --write
```

It reads the address from `origin` and rewrites the block. `pnpm changelog
defs` alone prints the lines that differ and exits 1; it changes nothing.

## 6. Prove it is complete

```bash
pnpm changelog check 2026-W41
```

It must end in `PASS` with exit 0. `FAIL` names the pull requests that are
not cited, the ones cited in a week they were not merged in (a reference to
earlier work is a plain link, not a citation), and a definitions block that
differs from what `pnpm changelog defs --write` writes: fix the file and run
it again. `SKIP` (exit 2) means nothing was judged; report it as not checked,
never as a pass. Then run `pnpm gate:fast`.

## 7. Ship

Commit, then one outward step per call: push the branch, open one pull
request titled `docs(changelog): 2026-W41`, merge it once its checks pass.

Give the pull request its body as one quoted word with the new lines inside
the quotes: single quotes when the text has no `'`. The prompt then shows the
whole body as it will be sent.

```bash
gh pr create --title 'docs(changelog): 2026-W41' --body 'Adds the entry for 2026-W41.

Closes #31'
```

When the `Weekly tag` workflow tags a finished week whose entry does not cite
every pull request GitHub lists for it, it opens an issue titled
`Changelog: write 2026-W41`, or `Changelog: extend 2026-W41` when the week
already has a heading. If one is open
(`gh issue list --search "in:title Changelog: 2026-W41"`, which finds both),
put `Closes #<n>` in the pull request's body.

Do not create or move a week's tag here. Only a backfill of past weeks
(below) tags one, and never moves it. The workflow owns the tags, and it tags
the last commit before Monday 00:00 UTC, which is on purpose earlier than the
pull request that writes the week up.

## Backfill

For weeks long past, with many to write, do not write them one after another
in one conversation.

1. Write one brief: the format (read the top of `CHANGELOG.md`), the tone, the
   sections, and what a citation looks like. Every agent gets the same one.
2. Start one agent per week, each told its week and nothing else to write.
   The person gives the range of weeks: `pnpm changelog weeks` lists only the
   weeks after the newest heading, and `git tag --list '????-W??'` lists the
   weeks already tagged. Each agent runs steps 2, 4 and 6 for its week.
3. A week in the era of pull requests cites every one of them
   (`pnpm changelog prs <week>`).
4. A week before pull requests has none to cite. Write the key commits, then
   a coverage list that holds every commit of the week, so none goes
   unmentioned, and a compare link between the week's tags
   (`https://github.com/<owner>/<name>/compare/<previous week>...<week>`, with
   the address from `gh repo view --json url --jq .url`).
5. Plain words, not the labels of a plan or a ticket: a reader six months on
   has not seen them.
6. Run `pnpm changelog defs --write` once when all are in, then
   `pnpm changelog check <week>` for each.

A past week with no tag can be tagged:

```bash
pnpm changelog tag 2026-W30
```

That prints the plan: the commit, with its date and subject, and the date the
tag will carry. It writes nothing. Show it to the person, and run it again
with `--apply` only after they say yes. The command does not grant `tag`, so
the call asks. It never moves a tag that exists.

## In CI

`changelog-writer.yml` runs this command with no person to ask. The weeks are
the ones `pnpm changelog due` lists. You may edit `CHANGELOG.md` and nothing
else, and you have no git. Differences from the steps above:

- Write or extend every due week in `CHANGELOG.md`, steps 1, 2, 4 and 5.
- Run `pnpm changelog defs --write`, then `pnpm changelog check <week>` for
  each due week. Fix the entry until it passes, or until you cannot. Report a
  check that still fails as failed, never as a pass.
- Then stop. Do not start a worktree (step 3), run `pnpm gate:fast`, commit,
  push or open a pull request, and never merge. The workflow's next job checks
  the file again, commits it, pushes the branch and opens the pull request,
  as a draft when a check failed.
