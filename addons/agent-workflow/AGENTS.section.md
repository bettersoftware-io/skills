## Agent workflow

How a change leaves this machine. A hook refuses a shell command that joins
an outward step to anything else; this section is what the hook cannot
decide: when the outward steps run.

The rules serve three aims, in this order when they pull apart:

1. **Main is never red.** A red main stops every session at once.
2. **Many sessions work on the project at the same time.** None waits for
   another, and none edits what another is editing.
3. **A green change is on main within minutes.** Nothing waits for a person
   who was not asked to review it.

```bash
pnpm worktree <name> [--ready]     # a worktree beside the project, on worktree-<name>, cut from origin's main
pnpm worktree:audit [part of a name]   # which worktrees are finished, and which hold work; it only reads
pnpm changelog due                 # the finished weeks to write or extend (reads git, offline)
pnpm changelog weeks               # the weeks CHANGELOG.md has no entry for
pnpm changelog prs <week>          # what was merged in a week (reads GitHub)
pnpm changelog check <week>        # every merged pull request cited, every citation defined
pnpm changelog defs [--write]      # the link definitions are the generated ones
pnpm agent-workflow:check          # the hook works and is registered in each host's settings
```

### An outward step is a call of its own

An outward step sends something off this machine or changes shared state:
`git push`, `gh pr create`, `merge`, `edit`, `comment` or `close`,
`gh workflow run`, `gh run rerun` or `cancel`, a `gh api` call that writes,
and `gh issue`, `gh release` and `gh repo` writes. Everything else is local:
`git add`, `git commit`, `git fetch`, tests, `gh pr view`, `gh run list`.

Run each outward step as its own tool call. A pipe into a filter
(`git push 2>&1 | tail -2`) is still one step. Joining it to anything with
`&&`, `;`, `||` or a new line is refused. When the hook refuses a command,
split it. Do not reword it to get past the hook: the point is the order of
the work, not the shape of the command.

### Put the outward steps at the two ends

Plan a piece of work in three parts:

1. **Start:** anything outward the work depends on, such as a workflow run
   whose result you need later. Often nothing.
2. **Local work:** the worktree, edits, tests, gates, commits. Nothing here
   asks for permission. For several pull requests, do the local work of all
   of them here.
3. **End:** push, open the pull request, wait for green, merge, clean up,
   watch main. One call each, one after the other. The sections from "Wait
   for green on your commit" on say how.

A person may be away while you work, and each permission prompt stops the
session until they return. Prompts at the two ends cost two waits; prompts
spread through the work cost one wait each.

- Waiting for checks is not a reason to start local work that will need a
  second push. Use the wait to read and to write the report.
- A decision the user must make (whether to delete, whether to force) goes at
  the same end, not in the middle. Whether to merge a green pull request is
  not one: see "Merge when it is green".
- If you pushed and then found one more edit, fold it into the next closing
  batch. Do not push after every edit.

Skip this ordering for a task with no outward step, and when the user asks
for a push now.

### Every outward step asks

The hook never lets a command run without a prompt. It refuses a chain, and
of Claude Code it asks about a push that is not written plainly
(a colon as in `git push origin a:b`, an option that forces or deletes, a
quote, a variable), whatever rule allows a push. It says nothing else,
so each push, each pull request step and each merge asks a person, under the
host's own rules. Do not add an `allow` rule for one to
`.claude/settings.json`, and do not change the hook under
`tools/agent-workflow/`, unless the user asks: that is the user's decision,
not a step of the work.

A session often does not stand in the worktree when it runs an outward step.
Name the place in the command: `git -C <worktree> push`, and
`--repo <owner>/<name>` for `gh`. `cd <worktree> && git push` is a chain,
and the hook refuses it.

Give a title or a body as one quoted word, with the new lines inside the
quotes, so that the prompt shows the whole text as it will be sent:

```bash
gh pr create --head worktree-price-list --title 'Add the price list' --body '## Summary

- Stale prices are greyed out
- The total no longer counts a row twice'
```

Never use `--admin`, `--force` or `--delete` unless the user asked for
exactly that. Never merge a pull request you did not open in this session
unless the user named it.

### Start every change in a worktree

Run `pnpm worktree <name> --ready` before the first edit. It fetches and cuts
the branch from `origin`'s main by name, so the work does not start from a
stale local branch. `--ready` installs and runs `pnpm gate:fast` there; hand
a worktree to another agent only when the last line says `READY`. Skip the
worktree for a question that changes no file.

Look at main first, with `gh run list --branch main --limit 5`. If its
latest runs are red, say so before the first edit: see "After the merge,
watch main".

Several sessions can work on one project at the same time this way: each has
its own folder and its own branch, and none edits the project's own checkout.

- **Never edit or commit in the project's own checkout**, however small the
  change. Another session may be reading it, and main takes changes only
  through a pull request. Files someone left uncommitted there stay as they
  are.
- **Never make the worktree by hand** with `git worktree add -b`. That cuts
  the branch from where the checkout stands, and a local main is behind
  `origin` whenever another session has merged since the last fetch.
- **Several changes in one session get a worktree each**, and each its own
  pull request. Do the local work of all of them first, then their outward
  steps.

In the commands below, `main` stands for the branch `origin/HEAD` points at.

### One pull request for what is reviewed together

Put in one pull request what a reviewer would accept or reject together: the
change, its tests, the document it makes wrong, the entry it closes. Open a
second one only when a reviewer could accept one part and reject the other,
or when one part is wrong until the other is on main. "After this one lands"
is not a reason by itself: each split costs a run of the checks and a merge.

### Wait for green on your commit

After the push and `gh pr create`, wait for the checks of the commit you
pushed, not for any green run:

```bash
git rev-parse HEAD        # the commit to match
gh run list --commit <commit> --json workflowName,status,conclusion,headSha
```

The pull request is green when every run for that commit is `completed` with
`success`. Ask by the commit, not by the branch: a scan can run for the same
commit under the pull request's own ref, and the branch's list does not show
it. `gh pr checks <number> --watch` waits for them. Read the list afterwards
all the same: a run of an earlier push can still be shown as the latest.

- **A run failed:** read it with `gh run view <id> --log-failed`, fix it in
  the worktree, commit, push, and wait again. Never merge past a red check,
  and never weaken a check to pass it.
- **No run appears:** ask `gh pr view <number> --json mergeable`. A pull
  request that conflicts with main gets no run, however long you wait. Run
  `git merge origin/main` in the worktree, resolve, push.
- **A run takes twice its usual time:** stop waiting and look, with
  `gh run view <id> --json jobs`. A step that hangs before the project's own
  commands start (the checkout, a cache, the install) is the runner: start it
  again with `gh run rerun <id> --failed`. A second hang at the same step is
  an outage: say so and stop.
- **A check fails for a reason the diff cannot have caused** (a repository
  setting that is off, a service that is down): say what it is. Do not change
  the workflow to get past it.

### Read what landed on main before the merge

Green proves the branch against the main it was cut from. Others merge while
you work, so compare the two sides first:

```bash
git fetch origin
git diff --name-only HEAD...origin/main     # what landed since the branch was cut
git diff --name-only origin/main...HEAD     # what the branch changed
```

The question is one: can the two changes break each other? Git refuses a
merge when the same lines changed, so what is left is the break git cannot
see: a name one side renamed and the other still uses, a rule one side
tightened, a fixture both rely on.

- **Nothing landed, or what landed is plainly apart from your change**
  (another package, documents while you changed code): merge as it is. Behind
  is not the same as at risk.
- **Both sides changed the same file, and it is prose** (a `.md` file a
  person wrote): merge as it is. Git still stops on the same lines. Not prose
  in this sense: a generated or checked document, a renamed heading that
  something links to, and any settings file.
- **What landed touches code you touched, or a file every package depends
  on** (the lockfile above all; a config, a lint rule, a workflow, a fixture,
  an exported name): run `git merge origin/main` in the worktree, push, and
  wait for green again.
- **What landed is too much to judge quickly:** do the same. Do not spend
  longer on judging than a run of the checks takes.

Do not bring main in every time it moves. Each time costs a run of the
checks, and on a busy project main moves again before that run ends.

Bring main in with a merge. Never rebase a pushed branch: that needs a forced
push, and the runs of the checks are lost with the old commits.

When git stops on a conflict, resolve only what conflicts. If the other side
changed the body of something you renamed, read the merged body against the
name before you commit: no check sees a name that no longer says what the
code does.

### Merge when it is green

Merge a green pull request you opened in this session at once. Do not ask
whether to merge it, and do not wait to be told: the host's prompt for the
command is where a person says no.

```bash
gh pr merge <number> --merge
```

Always `--merge`. A squash or a rebase puts other commits on main than the
ones the checks ran on, and the next step could not find yours there. Never
`--auto`: read the checks yourself, then merge.

Skip the merge when the user asked for a pull request only, or said that a
person reviews it first. Say then that it is open and green.

### Clean up when the commit is on main

From the project's own folder, not from inside the worktree:

```bash
git fetch --prune origin
git merge-base --is-ancestor <commit> origin/main    # exit 0: it is on main
git worktree remove ../<project>-worktrees/<name>
git branch -D worktree-<name>
git merge --ff-only origin/main                      # see below
```

Remove the worktree only after the second line exits 0. Removing it deletes
every file in it, the ones git ignores too: notes or reports to keep are
committed, or written outside the worktree, before this. Remove only the
worktree you made: another one belongs to another session. For those that
others left, `pnpm worktree:audit` says which are finished; it removes
nothing, and nor do you without a yes. A merged pull
request whose worktree is still on disk is not finished.

If the branch is still on `origin` after the merge, say so and leave it:
removing it is `git push --delete`, which is the user's to ask for.

The last line brings the project's own checkout up to main. It is not an edit
of that checkout: it moves main to what `origin` has, and refuses to do
anything else. A session reads this file and starts the hooks from that
checkout, so one left behind works by the rules of an earlier day. Run it
only when the checkout stands on main with nothing uncommitted; otherwise
leave it and say so.

### After the merge, watch main

Some workflows run only on main, after the merge: a slow visual or end-to-end
tier, a published report, a scan. The work is not done until they are.
`gh pr view <number> --json mergeCommit` gives the commit to ask about:

```bash
gh run list --branch main --commit <merge commit> --json workflowName,status,conclusion
```

Wait until each run for that commit is `completed`. A run can take a minute
to be listed, so list again before you call the list whole. Not every
workflow runs for every commit: one with a `paths` filter runs only when
those files changed.

- **One fails because of your change:** fix it forward at once, without
  being asked: a new worktree, a new pull request, the same steps. Say in the
  report what broke and what fixed it.
- **One fails for another reason** (it was red before the merge, a setting,
  an outage): say which, and why it is not the change.

Never report the work as done while a run for the merge commit is in
progress.

A red main comes before any other work, yours or not: every session cuts its
next branch from it. If it was red before your merge, say so before you
start, and do not add a change to it that is not its fix.

### Stop when you are about to

- edit a file while the session stands in the project's own checkout;
- make a worktree with anything but `pnpm worktree`;
- put off a test, a document or an entry to "a follow-up pull request" that
  nothing forces to be separate;
- merge without a `completed`, `success` run for the commit you pushed;
- merge without having read what landed on main since the branch was cut;
- bring main in "to be safe" when what landed is plainly apart;
- type `gh pr merge` with `--squash`, `--rebase`, `--auto` or `--admin`;
- wait on a run past twice its usual time without having looked at its jobs;
- say "done" with the worktree still on disk, or a run on main in progress.

### What is left

`docs/STATUS.md` is the one answer to "what is still to do?". It holds only
what is not done: an entry is removed when its work is on main, and the page
shrinks. `docs/IDEAS.md` comes before it: what nobody has committed to.

A piece of work ends with something left more often than not: a follow-up
nobody asked for, a step only a person can take, a decision that is the
user's, a thing that was not verified. The closing report is not the place
that keeps it: the report is gone when the session ends, and another session
never saw it. Write each one into `docs/STATUS.md`, in the pull request of
the work that left it.

| Section | What goes in it |
|---|---|
| In progress | Work that has started and is not finished |
| Designed, not built | A plan or a design is on main, and nothing of it is built |
| Planned, and held by something | It waits on a release, a decision or other work. Say on what |
| Next, with no plan yet | The next step is known, and nobody has written a plan |
| Waiting on a person | A step or a decision an agent cannot take. Say who, and give the command or the question |
| Known limits | What will not be fixed soon: a thing not verified, a case not covered |

One bullet for each: the name in bold, what is left, and a link to its plan
when it has one. Link only a file that is on main.
Every edit sets the "Last updated" line to today. `pnpm check:status`, in
`gate:fast`, fails a page that leaves one of the six sections out, adds one,
or writes an entry without its bold name, and one changed since the last
commit with an old date.

- **Work is planned, or something is left over:** add its entry.
- **Its pull request merges:** remove the entry, in that pull request. There
  is no section for what is done.
- **Its state changes:** move it, and say what is left now.
- **Someone asks what is pending:** read the page. Where it differs from the
  project, correct it as part of the answer.
- **An idea with no plan:** `docs/IDEAS.md`, not this page. When it gets a
  plan, move it. Never keep it in both.

Every edit sets `Last updated` to today's date.

Skip the page for work that leaves nothing: say so in the report, and add no
entry to say so. Do not keep what is left in the host's own memory in place
of this page. A memory belongs to one person on one machine, and the page is
the project's.

### The changelog

`CHANGELOG.md` has one entry per ISO week. The `Weekly tag` workflow tags
each finished week and opens an issue that asks for its entry. To write one,
follow `.claude/commands/workflow/changelog.md` (`/workflow:changelog` in
Claude Code, the `workflow-changelog` skill in Codex). What the entry says is
your judgement; that it cites every merged pull request is checked by
`pnpm changelog check <week>`. Never create or move a week's tag by hand.

A session may start with a note of the weeks that are due. Mention them to the
person when it fits, and do not drop the task you were given to write them.

### The other runbooks

Each is a command in Claude Code (`/workflow:status`) and a skill of the same
name in Codex (`workflow-status`). The steps are in the file, and it runs
nothing by itself.

- `.claude/commands/workflow/status.md`: where the project stands. This
  checkout, the open pull requests, the last runs on main, and the headings
  of `docs/STATUS.md`. It reads and changes nothing.
- `.claude/commands/workflow/docs.md`: write what a session worked out into
  the project's documents. It says where each kind of finding goes, and stops
  for a yes before it writes.
- `.claude/commands/workflow/worktrees.md`: which worktrees are finished and
  which hold work someone stopped in the middle of, from
  `pnpm worktree:audit`. Nothing is removed before the user says yes to a
  list that names what goes.

Three more stop at their first step when the add-on they need is not in the
project:
`.claude/commands/workflow/coverage-backfill.md` (needs `coverage`),
`.claude/commands/workflow/visual-tolerance-audit.md` (needs `visual`) and
`.claude/commands/workflow/perf-audit.md` (needs `performance`).
