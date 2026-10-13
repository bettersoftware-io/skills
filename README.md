# bettersoftware-skills

Plugins for Claude Code and Codex that encode one way of building TypeScript
applications: clean architecture in a pnpm monorepo, a streaming UI on RxJS,
and a testing approach that proves the tests can fail.

The rules here were not designed up front. They were extracted from a real
codebase, [ReactiveTraderCloudClone](https://github.com/bettersoftware-io/ReactiveTraderCloudClone),
where each one exists because something went wrong without it.

## Install

One plugin exists so far, `bettersoftware-skills`, in a marketplace called
`bettersoftware`.

Claude Code:

```
/plugin marketplace add bettersoftware-io/skills
/plugin install bettersoftware-skills@bettersoftware
```

Codex:

```bash
codex plugin marketplace add bettersoftware-io/skills
codex plugin add bettersoftware-skills@bettersoftware
```

| Skill | Use it |
|---|---|
| `bettersoftware-skills:creating-a-project` | To start a new project from the starter. It runs the script, installs, and proves `gate:full` passes before anything is changed |
| `bettersoftware-skills:extending-a-project` | To add an add-on to a project, bring its copy of the kit up to date, or give an existing project the gates for the first time |
| `bettersoftware-skills:reviewing-architecture` | To review a change for what no gate can check, as seven judgement questions |
| `bettersoftware-skills:documenting-architecture` | To write a codebase's architecture as documents with diagrams, in any language or stack. Every diagram is rendered, every cited file is checked to exist, and the text is fact-checked against the source by readers who did not write it |

**In Codex's default sandbox a new project is created but not proven.** The
sandbox has no network and keeps `.git` and `.codex` read-only, so the skill
writes the project, says which steps were refused, and stops. Outside the
sandbox, in the project:

```bash
git init
pnpm install
pnpm gate:full
cp tools/arch/hooks/codex.hooks.json .codex/hooks.json   # then trust it with /hooks
```

The plugin installs no hooks. The gates and the hooks that run them are files
in each project (`tools/arch`, `.claude/settings.json`, `.codex/hooks.json`),
so they apply to everyone who works on the project, with or without the
plugin, and to CI.

The Claude Code manifest carries no `version` on purpose: a version pins
users until it changes, and while the plugin is this young every commit should
reach them.

## Add-ons

A project takes the optional checks it wants. Like the kit, an add-on is files
in the project, so it works for everyone on the project, in any harness and in
CI.

```bash
node scripts/add-to-project.mts <project> coverage
```

| Add-on | The project gains |
|---|---|
| [`coverage`](addons/coverage/README.md) | A per-file coverage gate for every package, a ranked list of gaps, a check that proves a test can fail, and a published report that states the commit it was built from |
| [`visual`](addons/visual/README.md) | Screenshot tests of the UI in seeded states against committed golden images, kept per platform, with the tolerance measured and set in one place |
| [`e2e`](addons/e2e/README.md) | End-to-end tests: Playwright drives the built client in a real browser, on the simulator and against the real server, through page objects, with the layering held by the kit |
| [`performance`](addons/performance/README.md) | A static check of animations and transitions, a runtime audit of what Chromium actually composites, and a guide to the traps and their fixes |
| [`format-lint`](addons/format-lint/README.md) | Biome: a formatter, a general linter and import sorting, as a base the add-on owns and a `biome.json` the project owns |
| [`ci-security`](addons/ci-security/README.md) | Workflow lint and workflow security lint, Dependency Review on pull requests, `pnpm audit`, an OpenSSF Scorecard report, a Dockerfile check, a security policy to start from, a Dependabot config (or Renovate's, as `ci-security:renovate`), and a command that reads the repository's settings and names the ones that are off |
| [`repo-hygiene`](addons/repo-hygiene/README.md) | One version of each dependency across the workspace, every markdown link and heading anchor resolving, and CSS lint with names checked and every colour taken from a token |
| [`strict-lint`](addons/strict-lint/README.md) | The ESLint rules that need types (a promise nothing waits for, a `switch` that misses a case), and knip for unused files, exports and dependencies |
| [`agent-workflow`](addons/agent-workflow/README.md) | A hook that keeps each push and pull request step in a tool call of its own, a worktree script, a page of what is left, a weekly tag, and a changelog whose completeness is checked |
| `kit` | The same command brings a project's copy of the gates up to date, or sets them up in a project that did not start here |

`coverage`, `format-lint`, `ci-security`, `strict-lint` and `agent-workflow` are
marked recommended: a new project should take them unless it has a reason
not to. The creation skill
offers the list with those selected, and `create-project.mts --with
recommended` takes them where nobody can be asked.

The script records a hash of each file it installs. On a later run an untouched
file is replaced by the newer version; a file edited in the project is never
overwritten unless `--force` is given, and files the project is meant to own
(its scenarios, its goldens, its exclusions) are written once and then left
alone. When the template of such a file changes, the update says which file,
what changed and what to do. A project from before a template was kept is
shown where its file differs from it. `add-to-project.mts <project>
--compare` lists every such difference at any time, and writes nothing. A host's settings file is merged into, never
written over. An add-on may offer a choice between two sets of such files
(`ci-security:renovate`); the project has one, and moving to the other removes
the first only if the project never changed it.
[The contract an add-on follows](addons/README.md).

## Architecture documents

`documenting-architecture` is the one skill here that is not about the
starter. It works on any repository, and writes nothing into it but the
documents.

```bash
node scripts/architecture-docs/check-diagrams.mts docs/architecture      # every mermaid block renders
node scripts/architecture-docs/check-cited-paths.mts docs/architecture   # every `path/in/backticks` exists
node addons/repo-hygiene/files/tools/repo-hygiene/check-doc-links.mts --root docs/architecture
node scripts/architecture-docs/build-site.mts docs/architecture          # a copy that opens in a browser
```

| Script | What it does |
|---|---|
| `check-diagrams.mts` | Draws every ```` ```mermaid ```` block with Mermaid's own bundle, in one browser with no window. A diagram that does not render is named by its file and line, and Mermaid's "line 3" is given as a line of the file |
| `check-cited-paths.mts` | Fails a repository path cited in backticks that is not there. A path the set says is missing is named with `--except` |
| `build-site.mts` | Writes one page per document with a list of chapters, the anchors GitHub would give, and Mermaid beside the pages, so it reads from disk with nothing fetched. It goes to a cache folder unless `--out` says where |

Each check prints `PASS` with how much it judged, `SKIP` with the reason, or
`FAIL` with a file and line, and exits 0, 0 or 1. It exits 2 when it could
not run.

**The plugin's other scripts need Node and nothing else. These need three
packages**, and an installed plugin has no `node_modules`. So the first run
fetches them into `~/.cache/bettersoftware-skills/architecture-docs/` (or
`XDG_CACHE_HOME`), with `npm ci --ignore-scripts`, at the versions
[`toolset.lock.json`](scripts/architecture-docs/toolset/toolset.lock.json)
pins by hash: `marked` 15.0.12, `mermaid` 12.1.0 and `puppeteer-core`
25.13.0, about 230 MB with what they depend on. A later run fetches nothing.
`ARCHITECTURE_DOCS_TOOLSET` names a folder that already holds them, for a
machine with no network.

No browser is downloaded. The checks use one the machine has: a headless-only
Chromium that Puppeteer already put in `~/.cache/puppeteer` if there is one,
then Chrome, Chromium, Edge or Brave. `ARCHITECTURE_DOCS_BROWSER` names
another. A machine with none is told so, and the check exits 2.

**The documents may be someone else's.** These scripts are run on
repositories their user did not write, and what they read is printed, drawn
and copied into pages that open in the user's own browser. So:

- A symbolic link is never followed. A document that is one is left out and
  named in the output; one named on the command line is refused.
- HTML written by hand in a document is shown as text. A few tags that only
  shape text (`<br>`, `<kbd>`, `<details>`, `<sub>`) are kept, and only bare:
  with an attribute they are text too.
- That is judged on the page as it will be written, not on what the markdown
  converter was given. A tag stays a tag only when it is one of those, or one
  the converter writes, spelled exactly as it writes it. The converter is not
  trusted to have escaped anything.
- A link whose scheme is not `http`, `https` or `mailto` leads nowhere in the
  copy, and the build says which. It is judged twice: as written, and again
  as it stands after it is pointed at its place in the copy.
- `hostile.test.mts` builds a document that tries each of these with the real
  converter, opens it in a browser, and asks the browser what ran and how it
  reads every link. It runs where the tools have been fetched and is skipped,
  by name, where they have not.
- Mermaid runs in its `strict` mode, in the check and in the copy.
- `build-site.mts` empties the folder it writes to. It writes only into a
  folder that is new, empty, or a copy it built before (it leaves a marker
  file), and never into the documents' own folder.

Mermaid's own command line is not used. It starts a browser for each
diagram: a set of 94 diagrams was 94 browsers and took 67 seconds. One
browser for the run takes 6.

The three checks prove form. Whether a sentence is true is step 6 of the
skill: readers who did not write the set check it against the source.
[The record](docs/documenting-architecture-2026-10-11.md) has what that found
on two sets that had passed every check.

## What is in this repository

- [`starter/`](starter/README.md): a working project to start from, with one
  small feature built the way every feature is meant to be built. Without the
  plugin, create a project from it with
  `node scripts/create-project.mts <target> --scope @acme`.
- [`kit/`](kit/README.md): the deterministic checks (architecture gates, lint
  rules), the agent hooks that run them, and the review questions. Copied into
  a project as `tools/arch`.
- [`addons/`](addons/README.md): the add-ons above.
- [`skills/`](skills): the four skills above.
- [`scripts/architecture-docs/`](scripts/architecture-docs): what `documenting-architecture` runs. See [Architecture documents](#architecture-documents).
- [`evals/`](evals/README.md): requests run against a model, to see whether
  each one loads the right skill. Run by hand; they cost money.
- [`docs/STATUS.md`](docs/STATUS.md): what is not done yet.

How each part was tested:

| Record | What it shows |
|---|---|
| [`docs/baseline-2026-10-04.md`](docs/baseline-2026-10-04.md) | What an agent built with no guidance, and what the kit says about it |
| [`docs/review-skill-test-2026-10-04.md`](docs/review-skill-test-2026-10-04.md) | The review, with and without the skill |
| [`docs/starter-test-2026-10-04.md`](docs/starter-test-2026-10-04.md) | Three features built by an agent in a created project, one of them with nothing in the starter to copy |
| [`docs/plugin-test-2026-10-04.md`](docs/plugin-test-2026-10-04.md) | Installing the plugin on both hosts, and the creation skill |
| [`docs/codex-test-2026-10-04.md`](docs/codex-test-2026-10-04.md) | The project in Codex: a feature from `AGENTS.md` alone, and both hooks firing |
| [`docs/github-run-2026-10-05.md`](docs/github-run-2026-10-05.md) | The add-ons' workflows on GitHub, the Linux goldens, and CI's visual noise |
| [`docs/demo-feature-2026-10-05.md`](docs/demo-feature-2026-10-05.md) | A CRUD feature over REST, built by an agent in the demo project, and what review and use found |
| [`docs/small-model-2026-10-05.md`](docs/small-model-2026-10-05.md) | A feature built by the smallest model: where it stopped, what a second session fixed, and a stale-cache bug found on the way |
| [`docs/documenting-architecture-2026-10-11.md`](docs/documenting-architecture-2026-10-11.md) | Two sets of architecture documents written without the skill, what a fact-check then found in each, and what the scripts were run on |
| [`docs/inventory.md`](docs/inventory.md) | What was extracted, and how it was sorted |

No skill exists yet for placing logic, adding a port, streaming state or
testing. One is written only when a task fails in a way the gates do not
catch, and across four feature runs none has.

## Principles

- **Everything checkable is checked.** A rule a machine can verify gets a
  deterministic check, whether or not an agent tends to follow it unprompted.
  One good run proves nothing about the next.
- **Skills carry what a machine cannot check.** Judgement calls, reasons and
  fix recipes. The baseline run decides what skill text is worth its context;
  it never decides what gets enforced.
- **The failure message does the teaching.** A check says what is wrong and
  where the code belongs, at the moment the rule is broken.
- **Nothing to judge is not a pass.** A check that could not run, or found
  nothing to look at, says so.
- **Every rule says when to skip it.** A rule without a stated exception gets
  applied where it does not belong.
- **Keep the door open, don't build the room.** Replaceability comes from
  cheap bans on the wrong imports, not from abstractions written in advance.

## Licence

MIT
