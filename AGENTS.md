# Working in this repository

This repository is the `bettersoftware-skills` plugin: the skills
(`skills/`), the starter a project is created from (`starter/`), the kit of
gates every project gets (`kit/`), the add-ons (`addons/`), and the scripts
that create and extend a project (`scripts/`). [README.md](README.md) says
what each is. What is not done yet is in [docs/STATUS.md](docs/STATUS.md).

## Commands

```bash
pnpm install
pnpm test        # every test of the kit, the scripts and the add-ons (vitest)
pnpm typecheck   # the kit, the scripts and the add-ons' tools
node addons/coverage/files/tools/coverage/mutation-check.mts <spec.json>   # each mutant in a spec must fail its test
node scripts/create-project.mts <folder> --scope @demo [--with <add-ons>]  # a project from this checkout, to try a change in
node scripts/add-to-project.mts <project> <add-on>                         # an add-on, or `kit`, into such a project
```

Run `pnpm test`, then `pnpm typecheck`, one after the other, before you say a
change is finished. CI runs both, and creates a project with each add-on and
holds it to its own `pnpm gate:full`: a change to the starter, the kit or an
add-on is tried in a created project too. Every mutant spec a change touches
(`*mutants*.json`) is run, and every mutant in it is killed.

## Shipping a change

Follow the rules in
[addons/agent-workflow/AGENTS.section.md](addons/agent-workflow/AGENTS.section.md),
from "An outward step is a call of its own" to "Stop when you are about to".
Above all, **merge when it is green**: a pull request you opened in this
session is merged with `gh pr merge <number> --merge` as soon as every check
of the commit you pushed has passed. Do not ask whether to merge it; the
host's prompt for the command is where a person says no.

What differs here, since this repository does not have that add-on
installed:

- **No `pnpm worktree`.** Work in a worktree of the host's (in Claude Code,
  under `.claude/worktrees/`), on a branch cut from `origin/main`. Never edit
  or commit in the main checkout.
- **No hook** keeps the outward steps apart: keep each `git push` and each
  `gh pr`, `gh workflow`, `gh run` and `gh repo` write a Bash call of its own
  all the same.
- **No `CHANGELOG.md` and no `check:status`.** `docs/STATUS.md` keeps its
  own sections; an entry is removed in the pull request that finishes it, and
  each edit moves its "Last updated" date to today.

## Conventions

- Conventional commit messages: `feat(visual): …`, `fix(installer): …`,
  `docs(status): …`.
- A change a project would see moves the version in
  `.codex-plugin/plugin.json` (the Claude Code manifest carries none). When an
  add-on's change asks something of a project that updates, its `addon.json`
  gets a `releaseNotes` entry under that version.
- A claim in a README is backed by a test or a measurement, and the
  README's "How it was tested" says what ran where.
