# Add-on: ci-security

Adds supply-chain and workflow checks to a project created from the starter
and hosted on GitHub: a lint of the workflows themselves, a review of every
dependency change, an audit of the production dependencies, an OpenSSF
Scorecard, a check of the project's Dockerfiles, a security policy to start
from, the config of one update bot, and a command that reads the
repository's settings and names the ones that are off.

```bash
node scripts/add-to-project.mts <project> ci-security            # with Dependabot
node scripts/add-to-project.mts <project> ci-security:renovate   # with Renovate instead
cd <project> && pnpm install && pnpm lint:workflows
```

Every check but one needs the network, so it joins neither `gate:fast` nor
`gate:full`. A gate needs nothing beyond `pnpm install`, and an agent runs
the gates in a sandbox that may have no network. Those checks run in
workflows of their own, and the workflow lint also runs by hand before a
push. The Dockerfile check reads files only, so it is in `gate:fast`.
`pnpm repo:settings` needs `gh`, a login and the network, and is run by hand.

## What it adds

| Part | Where | What it does |
|---|---|---|
| `pnpm lint:workflows [actionlint\|zizmor]` | `tools/ci-security/lint-workflows.mts` | Downloads each linter as a pinned release, checks its sha256, runs it on `.github/`. `PASS`, `FAIL` or `SKIP` per linter |
| The pins | `tools/ci-security/lib/pins.mts` | Version, URL and sha256 of each linter for macOS and Linux, x64 and arm64 |
| Workflow lint and audit | `.github/workflows/ci-security.yml` | On pull requests, on main and weekly: actionlint, zizmor, `pnpm audit --prod` |
| Dependency Review | `.github/workflows/dependency-review.yml` | On pull requests: fails one that brings in a known advisory or a strong-copyleft licence |
| Scorecard | `.github/workflows/scorecard.yml` | Weekly and when `.github/` or branch protection changes: findings to code scanning. Gates nothing |
| `pnpm check:dockerfiles` | `tools/ci-security/check-dockerfiles.mts` | Reads every Dockerfile the way Docker does: each image the build pulls named by digest, the last stage not run as root, no package installed outside a lockfile. A file it cannot read that way fails. `SKIP` when the project has none. Joins `gate:fast` |
| `pnpm repo:settings` | `tools/ci-security/check-settings.mts` | Asks GitHub which repository settings are on. `PASS`, `FAIL` or `SKIP` per setting; under a `FAIL`, where the setting is and the command that switches it on. It only reads. Joins no gate |
| The required checks | `tools/ci-security/lib/required-checks.mts` | Reads `.github/workflows/` for the jobs every pull request runs, which are the status checks a ruleset can require |
| Security policy | `SECURITY.md` | How to report in private, what to expect, what is in scope. Written once, then the project's own |
| Dependabot (the default) | `.github/dependabot.yml` | Weekly version updates for npm and for actions, never a release younger than seven days. Written once, then the project's own |
| Renovate (`ci-security:renovate`) | `.github/renovate.json5` | The same policy for Renovate, in place of the Dependabot file. Written once, then the project's own |

Three scripts are added to the root `package.json`. No package is installed.

## Why each tool

Each one watches something the others do not. The reasoning is from the
decision record of the project these checks come from.

| Tool | The gap it closes |
|---|---|
| **actionlint** | Is each workflow valid: syntax, expressions, runner labels, the inputs of a `run:` step |
| **zizmor** | Is each workflow safe: injection through `${{ }}`, a token left in the git config, permissions wider than needed, an action not pinned by commit. actionlint has no opinion on these |
| **Dependency Review** | What a pull request changes in the dependencies, development ones included, before it merges. Also the only check that reads licences |
| **`pnpm audit --prod`** | The whole production tree against known advisories, including the day an advisory is published and nothing was pushed (the weekly run) |
| **Dependabot** | Keeps versions and action commits moving, a week behind their release. A malicious release is usually removed within days |
| **Scorecard** | The repository's settings, which no file shows: branch protection, token defaults, and the day one of them is loosened |

## Dependabot or Renovate

A project has one of the two, never both: two bots open the same pull
requests twice. Dependabot is the default because it needs nothing installed.

```bash
node scripts/add-to-project.mts <project> ci-security:renovate     # move to Renovate
node scripts/add-to-project.mts <project> ci-security:dependabot   # move back
node scripts/add-to-project.mts <project> ci-security              # update; keeps the one the project has
```

Moving removes the other bot's file if the project never changed it. A file
the project changed is left where it is, and the script says so: move what
you changed to the new file, then delete the old one yourself.
[How a choice works](../README.md#a-choice).

**Renovate needs its GitHub App installed on the repository**
(<https://github.com/apps/renovate>). A person does that, in the settings of
the organisation or the account. Until then nothing happens: no pull request,
no issue, and no error anywhere. The file alone does nothing. After the app
is installed Renovate first opens one "Configure Renovate" pull request, or
goes straight to work when it finds the file; check the Dependency Dashboard
issue it opens.

The two files hold one policy:

| | `dependabot.yml` | `renovate.json5` |
|---|---|---|
| When | `interval: weekly` | `schedule: before 6am on monday` (UTC) |
| How young a release may be | `cooldown: default-days: 7` | `minimumReleaseAge: 7 days`, held back until then (`internalChecksFilter: strict`) |
| Grouping | Minor and patch in one pull request, each major alone; the actions in one | The same two groups |
| Open at once | `open-pull-requests-limit: 5` | `prConcurrentLimit: 5` |
| Actions | The commit and the version comment move together | `helpers:pinGitHubActionDigests` does the same, and pins an action that is not pinned yet |
| Security fixes | Dependabot security updates, a repository setting | Still Dependabot security updates. Renovate's `vulnerabilityAlerts` is off, so no fix arrives twice |

`minimumReleaseAge` in `pnpm-workspace.yaml` is a day. Both bots wait
longer, and Renovate must never wait less: pnpm refuses a younger release,
and the pull request could not update the lockfile. A test holds the three
numbers together.

What only Renovate does, and the file settles:

- It reads every file it knows, so it is told to leave `tools/` alone. That
  folder is what the kit and the add-ons installed; an update of an add-on
  replaces it and refuses a file changed in the project.
- It reads the `overrides` in `pnpm-workspace.yaml` as ordinary dependencies
  and would lift a pin written for one advisory to the next major. Nothing in
  that file is moved.
- It moves the `packageManager` field with its hash, and the digest of a base
  image in a Dockerfile. Dependabot needs a `docker` entry for the second,
  and leaves the first to a person (`tools/arch/ci/pin-package-manager.mts`).

Left out of the source's Renovate config: its auto-merge rules (a policy a
project decides for itself; Dependabot's file has none either), its hourly
limit, and its package rules for React Native, Expo, a deploy tool and its
own lint packages.

Not included, and why: **CodeQL** is a repository setting (default setup), not
a file, so it is in the list below. **Snyk, SonarCloud** and other vendor
scanners need an account and a token, and repeat what these layers do.

## Settings a person must switch on

The add-on writes files. These are repository settings, and it cannot set
them. All are under Settings. `pnpm repo:settings` reads the ones marked
"yes" and prints which are off. Run it after the project's first push to
GitHub.

| Setting | Where | Without it | Read by `pnpm repo:settings` |
|---|---|---|---|
| Dependency graph | Advanced Security | Dependency Review fails every pull request, saying the graph is off. On by default for a public repository | With Dependabot alerts: they need the graph, and switching them on switches it on |
| Dependabot alerts and Dependabot security updates | Advanced Security | No pull request is opened when an advisory hits a version already on main | yes, one line each |
| Dependabot version updates | Advanced Security | Usually on once `dependabot.yml` exists; check it | no |
| CodeQL default setup, with the `actions` language | Advanced Security → Code scanning | No static analysis of the project's own code. It is also where Scorecard's findings are shown | yes |
| Private vulnerability reporting | Advanced Security | Nobody can report a flaw in private, and the "Report a vulnerability" button that `SECURITY.md` points to does not exist | yes |
| The Renovate app, with `ci-security:renovate` only | <https://github.com/apps/renovate>, then the repository | Nothing happens. No pull request, and no error | no |
| The three things `SECURITY.md` asks its maintainers for, in the comment at its top | The file itself | The policy promises an answer in 7 days and disclosure within 90, which may not be times you keep | no |
| A ruleset on the default branch that requires a pull request, blocks deletion and force pushes, and requires the status check of every job that every pull request runs. With the starter and this add-on those are `gates · lint · typecheck · test · build`, `workflow lint (actionlint · zizmor)`, `pnpm audit (production dependencies)` and `dependency review (advisories · licences)` | Rules → Rulesets | The checks run and anyone can merge past a red one | yes, one line for each of the three |
| Workflow permissions: read repository contents | Actions → General | A workflow with no `permissions:` block gets a write token | yes |
| Automatically delete head branches | General → Pull Requests | The branch of every merged pull request stays on GitHub until someone deletes it | yes |

Do not make `scorecard analysis` a required check: it does not run on pull
requests. `pnpm repo:settings` does not ask for it, by the rule below.

In a private repository, Dependency Review and code scanning need GitHub
Advanced Security. Without it, delete `dependency-review.yml` and
`scorecard.yml`; the rest works.

## The settings check

```
PASS Dependabot alerts, and with them the dependency graph
FAIL Dependabot security updates: off
  where: Settings → Advanced Security → Dependabot security updates (https://github.com/acme/app/settings/security_analysis)
  fix:   gh api -X PUT repos/acme/app/automated-security-fixes
SKIP CodeQL default setup, with the actions language: not read, so this is not a pass and not "off". GitHub answered HTTP 403: You are not authorized to read code scanning default setup.
```

| Exit | Means |
|---|---|
| `0` | Every setting was read and is on |
| `1` | A setting is off. The lines under its `FAIL` say where it is and give the command that switches it on |
| `2` | No setting is off, and one or all of them could not be read: no `gh`, no login, no GitHub repository for the folder, no access to a setting. Also a wrong argument. Not a pass |

`--root <dir>` reads another checkout than the one the tool is in.

**It only reads.** Each question is `gh api --method GET`, sent from one
function. A `fix:` command is printed for a person and never run, and a test
holds that with every setting off no other call is made. An agent shows the
command to the user: in a project made from the starter, the agent's host
refused such a write.

**It joins no gate.** It needs `gh`, a login and the network, and a login may
not be let to read every setting. A gate that failed for a person with less
access would fail for a reason they cannot fix. It is run by hand.

**Off and not read are kept apart.** GitHub answers 404 for alerts that are
off, and the same 404 to a login that may not see the setting. A 404 is read
as "off" in two cases: the login may administer the repository, or the
message says "disabled". Any other refusal is a `SKIP` with GitHub's reason.
An answer in a form the tool does not know is a `SKIP` too.
So is CodeQL in the minute after it is switched on, while GitHub has found
no language yet: a command written from that empty list would set it to
`actions` alone, so none is printed.

**The repository** is the one `origin` points at when that is an address on
github.com. Otherwise it is the one `gh repo view` names. The address is
never printed: it can hold a token.

**The ruleset** is read from `rules/branches/<default branch>`, which gives
the rules that hold on the branch: those of active rulesets only, from every
ruleset that matches it, the organisation's too. The three lines are a
`pull_request` rule, a `deletion` and a `non_fast_forward` rule, and
`required_status_checks`. When one fails, the list of rulesets is read to name
a ruleset that is there and not active, and the branch is read to say when it
has a classic protection rule, which is not judged. The command printed makes
one ruleset with all three, for `~DEFAULT_BRANCH`: a pull request with no
required approval, no deletion, no force push, and the checks named.

**The checks to require come from the project's workflows**, not from a list
in the tool. A job is named when every pull request runs it:

| A job is left out when | Why |
|---|---|
| Its workflow has no `pull_request` under `on:`, or has anything under it (`paths`, `paths-ignore`, `branches`, `branches-ignore`, `types`) | Some pull requests do not start it. A required check that never reports holds the pull request for good |
| It has an `if:` of its own. A step's `if:` does not count | A pull request can skip it |
| It has a `strategy:`, calls another workflow with `uses:`, or has an expression in its `name:` | Its check has no one name that the file gives |

The check's name is the job's `name:`, or its id. So the Scorecard job, the
coverage add-on's job that publishes the report and the weekly tag are not
asked for, and the coverage gate is. The jobs left out are named on the
line, and each with its reason above the command.

No YAML package is installed for this. The reader takes the block form
workflows are written in (`on:` and `jobs:` at the left edge, a job as a key
under `jobs:`). A workflow in another form is named on the line as not
judged; it is never taken as having no job.

Two things about text and programs that are not the project's own:

- **Every printed line is written out plain.** A job's name and a file's
  name come from the checkout, a ruleset's name and a refusal from GitHub. A
  control character there could clear a line and write a PASS no check gave,
  and a mark that turns the text round could show a command other than the
  one that is pasted. Each is printed as its escape (`\u001b`). Which
  characters is decided by Unicode's classes and not by a list of ranges:
  the control characters, the format marks (direction, no width, tags), a
  line or paragraph end, a space that is not the space, and what is private
  or not assigned. In the JSON of the ruleset command the escape is the same
  character, so the command asks for the same check. What goes into a command as a word is held to a pattern:
  the repository's name to letters, digits, `.`, `_` and `-`, a CodeQL
  language to GitHub's own list.
- **`gh` and `git` are started by their full path**, found in a folder of
  the PATH that no project fills. Three kinds of folder are passed over: one
  not written in full (`.` or an empty entry is the folder a program is
  started in, which here is the project); a `node_modules/.bin`, which pnpm
  puts first on the PATH of a script and where a dependency may ship a file
  of any name; and one inside the project, or inside the checkout `--root`
  names, reached by a link too. So a file called `gh` that a checkout or a
  dependency brought is not started in place of GitHub's. The program that
  is started gets the same folders as its own PATH, since `gh` starts `git`
  by its name.

Three security reviews of these commits named these two things, each time
with no more than a file and a few words. The first also named a third
thing, which is not followed up. What the fixes do not cover, and nobody
should read them as covering:

- a character that looks like another (a Cyrillic `а` in a job's name) is
  printed as it is;
- a program is only as trusted as the folders of the PATH that are left. A
  folder outside the project that anyone may write to is still searched;
- git reads the checkout's own configuration when it is asked for `origin`.
  The check is for a project a person works in, not for a checkout they do
  not trust;
- the other tools of this add-on (`lint-workflows.mts`) start their
  programs as they did before.

## The security policy

`SECURITY.md` at the root is a file to start from. GitHub shows it under the
repository's Security tab and links to it from the "new issue" page; it
looks in the root, in `docs/` and in `.github/`. OpenSSF Scorecard's
Security-Policy check looks in the same places and scores three things: a
link or an address to report to, text of the policy's own, and words about
disclosure with a time in numbers. The file has all three, and a test holds
them.

It names the project's packages by their scope (`@app/*`, which the
installer rewrites) and nothing else about the project. It links only to
GitHub's own guide, so the link check of the `repo-hygiene` add-on has
nothing in it to resolve. A comment at its top, which a reader of the
rendered page does not see, lists what the maintainers must change.

## The Dockerfile check

```
PASS dockerfiles — 1 Dockerfile(s), 1 FROM line(s)
SKIP dockerfiles — the project has no Dockerfile, so there was nothing to check
```

The starter has no Dockerfile, so a new project sees the `SKIP` line (exit
0). The check is there for the day the server gets an image.

| It fails on | Why |
|---|---|
| An image with no `@sha256:` digest of 64 lowercase hex digits, or with a variable in it: in a `FROM`, a `COPY --from=` or a `RUN --mount=…,from=` | A tag is moved to a new image whenever its owner pushes one. A digest names one image for good. Scorecard's Pinned-Dependencies check reports the `FROM` lines |
| A last stage that ends as `root` or `0`, as a user the check cannot tell (`USER ${APP}`, `USER "root"`, `USER +0`), or with no `USER` in it or in the stages it is built from | The build needs root; the running program does not. Without it a way out of the program is a root shell in the container |
| A `RUN` that installs globally or fetches and runs: `npm install -g` in any word order, `pnpm add -g`, `bun add -g`, `yarn global add`, `npx`, `pnpx`, `bunx`, `npm exec`, `dlx`. In the shell form, the list form, a heredoc's body and after `ONBUILD` | The package has no pinned version and no checksum. Install from a lockfile |
| A file Docker would refuse, or could read in another way than the check | A rule held on another reading of the file is not held |

`scratch` and an earlier stage of the same file are accepted as a base. Files
are found by name (`Dockerfile`, `Dockerfile.*`, `*.Dockerfile`, and
`Containerfile` in the same three forms, in any letter case) in every folder
but `node_modules` and `.git`. A link with such a name is followed. A
Dockerfile that cannot be opened is a finding, and so is a link to a folder.

**It reads the file as Docker does.** The first version split the file into
lines and looked at the first word of each. Docker does more, and each
difference was a way to pass the check with a file that breaks a rule:

| In the file | What Docker does | What the first version saw |
|---|---|---|
| `US\` at the end of a line, `ER root` on the next | Joins the two with nothing between: `USER root` | Two lines it did not know, and the `USER node` above them |
| `USER root \` as the last line, or `RUN npm install -g x \` | Runs it | Nothing: it waited for a next line |
| `RUN echo a\\`, then `USER root` | Two instructions: two backslashes join nothing | One `RUN` |
| `# escape=` and a backtick at the top, then `RUN echo \`, then `USER root` | Two instructions: the backslash joins nothing now | One `RUN` |
| `COPY <<EOF /etc/motd`, `USER node`, `EOF` | Writes a file that holds the text `USER node` | A `USER node` instruction |
| `RUN <<EOF`, `npm install -g x`, `EOF` | Runs the install | A line that is not a `RUN` |
| `RUN ["npm", "install", "-g", "x"]` | Runs the install | No `npm install` in a row |
| `RUN npm -g install x` | Installs globally | No `-g` after `install` |
| `FROM 0` | Pulls the image called `0` | The first stage |
| `COPY --from=nginx:1 …`, `RUN --mount=type=bind,from=golang:1 …` | Pulls the image | Nothing: not a `FROM` |
| `USER "root"`, `USER r\oot`, `USER +0`, `USER 00` | Root: it takes quotes and backslashes out, and the number is 0 | A user that is not `root` or `0` |
| `USER ${APP}` | Whatever the build is given | A user that is not root |
| A `Dockerfile` that is a link, or one in `dist/` | Builds it | Nothing: not looked at |

So the check now follows Docker's rules for lines, parser directives,
heredocs and stages, and where it cannot be sure it fails the file:

- **A word Docker does not know** as an instruction fails, and so does a
  control character, a no-break space or a byte order mark in the middle of
  the file. Docker and an editor do not show such a line the same way.
- **A heredoc** is accepted in one form: `<<EOF`, `<<-EOF`, `<<"EOF"` or
  `<<'EOF'` as a word of its own, on a line with no other quote, no backslash
  and no `${`, and with a name that is not an instruction. In any other form
  Docker and a shell split the line into words in their own ways, and an older
  Docker reads the body as instructions.
- **`# syntax=`** may name `docker/dockerfile` only. Another frontend reads
  every line in its own way.
- **A variable in an image** fails whatever its default, a pinned one too, and
  in front of a digest too. `--build-arg` replaces the value on the command
  line, and one strict rule is easier to hold than a proof per case.
- **The last stage is the one that ships.** `docker build --target` can ship
  an earlier one, and `--build-context` can replace any image; the check
  cannot see a command line. A stage that is `FROM` an earlier stage starts as
  that stage's user. A stage from an outside image starts as root as far as
  the check can know, so it must set `USER` itself.
- **`ONBUILD USER`** does not set the stage's user: it acts in the stage that
  is `FROM` this one, and is counted there. **`ONBUILD RUN`** is held to the
  packages rule on its own line: it is the same install, one build later.

The header of `check-dockerfiles.mts` has the whole list.

The source project runs no linter on its Dockerfile. These are the three
things it fixed in it by hand and now holds with a pin, a grep and a review;
they are the portable part. The visual add-on's `visual:check` compares the
Playwright image tag in the workflows with the npm version. That is another
question (do two versions agree), about another kind of file, and nothing
here repeats it. An image named in a workflow's `container:` is zizmor's to
judge.

## The local lint

```
PASS actionlint 1.7.12: every workflow is valid
PASS zizmor 1.30.1: no security finding (not checked here: what must be asked of GitHub, such as an action with a known advisory, because GH_TOKEN is not set; CI checks it)
```

| Exit | Means |
|---|---|
| `0` | Every linter ran and found nothing |
| `1` | A linter found a problem. Its own output, above the `FAIL` line, names the file and line |
| `2` | A linter could not run, or there was no workflow to lint. A `SKIP` line gives the reason. Not a pass |

The download is never trusted:

- Each build is one release asset, named by its exact URL and sha256. Nothing
  is taken from a "latest" link.
- The sha256 is checked before the bytes are written to disk. A wrong one is
  thrown away, nothing is run, and the result is `SKIP` with both checksums.
- The archive is kept in `node_modules/.cache/ci-security/`, which the
  starter's `.gitignore` covers, so later runs need no network. It is checked
  again on every run, and the binary is taken out of it afresh every time: a
  binary left by an earlier run is deleted first and never run.
- A platform with no pinned build (Windows) is a `SKIP` that names the
  platforms that have one.

A `PASS` line says what was not checked on this machine. Without `shellcheck`
installed, actionlint does not read the shell inside `run:` steps. Without a
GitHub token in `GH_TOKEN`, zizmor skips the checks that ask GitHub about an
action. CI has both, so CI is the complete run.

`pnpm audit --prod` has no local script: it is one command, and you can type
it. With no network it fails with a connection error; it does not pass.

## The workflows

- **Every action is pinned by its full commit hash**, with the version in a
  comment. The update bot moves both together.
- **`permissions: contents: read`** on every workflow. The one write is
  `security-events: write` on the Scorecard job, to upload its findings.
- **`persist-credentials: false`** on every checkout. No job pushes.
- **No job installs a dependency.** The lint tool is plain Node with no
  package; `pnpm audit` reads the lockfile; Dependency Review has no checkout.
  So no package's code runs in these workflows, and the token is never in a
  job with project code. The token is given to one step, the zizmor run.
- **No `pull_request_target`, no secret, no expression in a `run:` line.**
- A newer run cancels the one in flight.

## How it was tested

**The tools.** 478 tests in `tests/`, run with
`pnpm vitest run addons/ci-security` from this repository's root. No test
touches the network: a download is a function that returns bytes, the archive
extraction and the linter run are stand-ins, and GitHub is a function that
answers `gh` (`tests/github.mts`). `system.test.mts` runs the real
`tar` on an archive it makes, and the real tool in a folder with no workflow
(it stops before any download). `check-dockerfiles.test.mts` runs the check
on Dockerfiles it writes, and the script itself in a folder of its own.

**Every test can fail.** For the first 98 tests, one mutant per test, run
with the coverage add-on's tool: 96 of 96 killed. The two remaining tests
list files, which a find-and-replace cannot break, so each was made red by
hand: a `.js` file put in `files/`, and a fourth workflow.

The first run had twelve survivors, all in `pins.test.mts`, and they were a
fault in the spec: the `-t` filter matched no test, vitest ran nothing and
exited 0, so every mutant "survived". The filters were fixed, and each of the
96 was then checked to select exactly one test. One real gap was found while
writing the mutants: a single test covered two deletions of a stale binary, so
neither could be seen alone. It is now two tests.

For the Dockerfile check, the security policy, the two bots' files and the
manifest (2026-10-06): `tests/mutants.json`, 251 of 251 killed, 231 of them
for the Dockerfile check. One more test, that the policy is at the root, lists
files; it was made red by hand with a second policy under `files/docs/`.

**The settings check** (2026-10-12): 122 tests. Most of GitHub's answers in
them are the ones it gave that day: for a repository with every setting on,
for one with five settings off and no rule on its branch, and for one the
login could only read. So is what `gh` prints with no login, a refused token
and no network. The header of `tests/github.mts` lists the answers that were
written from GitHub's API description and not seen. Four tests start the
script itself, with a `git` and a `gh` on the `PATH` that are shell scripts,
or with none. `tests/mutants.json` has 127 mutants for these tests: 127 of
127 killed. The mutant an older test was held by was run again under the
test's new name. Each of the 122 tests also went red under at least one
mutant when its whole file was run with the mutant in place.

It was run against GitHub, reading only:

| The folder | Result |
|---|---|
| A project made from the starter, with six workflows and every setting on | exit 0, nine `PASS`. The five checks read from its workflows are the five its ruleset requires; three jobs were left out |
| This repository, where only the workflow permissions are as asked | exit 1: one `PASS`, eight `FAIL`, each single setting with its place and its command, and the ruleset command with this repository's one check. Its two matrix jobs were left out, with the reason |
| A folder whose `origin` names someone else's public repository | exit 1: five `SKIP` with GitHub's reason (two 404, two 403, one field left out), one `PASS`, three `FAIL` for the ruleset, and the line that says the branch has a classic protection rule |
| A folder with no `origin` | exit 2, one `SKIP` line |
| The first folder again: with no login, with a token GitHub refuses, through a proxy that takes no connection, with no `gh` on the `PATH` | exit 2 each time, one `SKIP` line that names the reason |

In a project created with every add-on, `pnpm gate:full` exits 0 with these
files in, and `pnpm repo:settings` exits 2 there: the project has no
`origin` yet.

No printed command was run: see "Limits".

**The Dockerfile check against Docker's own reader** (2026-10-06). The check
claims to read a file as Docker does, so it was compared with the program
that does: BuildKit 0.33.1's Dockerfile frontend, built into a small Go
program that needs no daemon. For a Dockerfile it prints the images the build
would pull, the commands it would run and the user of the last stage, or the
error. It is not part of this repository.

- Every Dockerfile the tests write (228 different ones) went through both. No
  file passes the check while BuildKit refuses it, pulls an image with no
  digest or ends as root. The first version of the check passed 43 that break
  a rule (6 pull an image with no digest, 20 end as root or as a user that
  cannot be told, 17 run an install outside a lockfile) and 26 more that
  BuildKit refuses. For the packages rule the comparison is by a pattern over
  the commands BuildKit would run: BuildKit has no opinion on a command.
- 20,000 Dockerfiles made of hostile lines in a random order (continuations,
  directives, heredocs, stages, `ONBUILD`): the check passed 1,255 and
  BuildKit agreed on each. Of the first 5,000 the first version passed 1,539
  that BuildKit refuses (1,444) or reads as breaking a rule (95).

The check fails more files than BuildKit refuses, on purpose (a variable in
an image, a heredoc in a form it does not accept). Not compared: a real
`docker build`, since no daemon ran, an older Docker with no heredocs, and
what `# syntax=` does, which the daemon decides.

**The Renovate config** was read by Renovate's own validator
(`renovate-config-validator --strict`, Renovate 44.133.0, 2026-10-06), as the
repository config at `.github/renovate.json5`: "Config validated
successfully". As a control, a file with `minimumReleaseAge` as a number and
a misspelt key was refused with exit 1. The validator warned that its RE2
module was not built on this machine and fell back to JavaScript's regular
expressions; the config has none.

**The Dockerfile check** was also run on the source project's own
Dockerfile, which is written to these three rules: `PASS`, 1 file, 1 `FROM`.
That run was of the first version of the check and was not repeated.

**In a project**, on macOS arm64, 2026-10-05. Created with
`create-project.mts`, then `add-to-project.mts <project> ci-security`,
`git init`, `pnpm install`:

| Command | Result |
|---|---|
| `pnpm lint:workflows` | exit 0. Both linters downloaded, verified, `PASS` on the starter's `ci.yml` and this add-on's three workflows and `dependabot.yml` |
| `pnpm gate:full` | exit 0, all seven architecture gates `PASS` |
| The same lint with `GH_TOKEN` set | exit 0, zizmor's online checks included |
| `zizmor --persona=auditor` on the add-on's workflows | no finding. The one it reports is in the starter's `ci.yml` (no `concurrency`) |
| A workflow with a misspelt key (`shel:`) | exit 1. actionlint `FAIL`, names file, line and key. zizmor `PASS`: it does not judge syntax |
| A workflow with `actions/checkout@v7` | exit 1. zizmor `FAIL`, `unpinned-uses`, names file and line. actionlint `PASS`: it does not judge safety |
| A workflow with `pull_request_target`, a checkout of the pull request's head and its title in a `run:` line | exit 1. zizmor names `dangerous-triggers`, `template-injection`, `unpinned-uses`, `excessive-permissions`; actionlint also fails the title in `run:` |
| The lint with the network denied (`sandbox-exec`, `deny network*`) and no kept archive | exit 2, two `SKIP` lines with `ENOTFOUND github.com`. Nothing written |
| The same with the archives kept from an earlier run | exit 0 |
| One sha256 in the project's `pins.mts` changed to zeros | exit 2, `SKIP`, both checksums printed, nothing written, nothing run |
| `pnpm audit --prod`, before `pnpm install` | exit 0, "No known vulnerabilities found" |
| `pnpm audit --prod` against a registry that refuses the connection | exit 1 with the connection error |
| `add-to-project.mts <project> ci-security` a second time | "0 file(s) written, 8 already up to date"; a hash of every file in the project is the same before and after |

On 2026-10-06, in projects with every add-on and the scope
`@ci-organisation-with-a-long-name`:

| Command | Result |
|---|---|
| Created with `ci-security`: `pnpm gate:full`, `pnpm lint:workflows`, `pnpm visual` | exit 0 each. `.github/` holds `dependabot.yml` and no Renovate file; `SECURITY.md` is at the root with the project's scope in it; `SKIP dockerfiles` |
| Created with `ci-security:renovate`: the same three | exit 0 each. `.github/` holds `renovate.json5` and no Dependabot file; `tools/installed.json` records `renovate` |
| `add-to-project.mts <project> ci-security:renovate` on the first | `dependabot.yml` removed ("it was never changed here"), `renovate.json5` created |
| `ci-security` again, by name alone | 0 files written; still Renovate |
| `ci-security:dependabot` | `renovate.json5` removed, `dependabot.yml` created; `git status` empty: the project is back at its commit |
| The same move with one line added to `dependabot.yml` first | The file is left, `renovate.json5` is created, and "Still to do by hand" says to move the change and delete the file |
| `ci-security:snyk` | exit 1, names the two options, changes nothing |
| `pnpm gate:fast` and `pnpm lint:workflows` after all of that | exit 0 |
| A `Dockerfile` with `FROM node:26-slim`, `npm install -g corepack` and no `USER` | `FAIL dockerfiles (3)`, each with file and line; `pnpm gate:fast` exit 1 |
| The same file with a digest, a lockfile install and `USER node` | `PASS dockerfiles`, exit 0 |
| The add-on alone, by the steps of this repository's CI job | `pnpm gate:full` exit 0 |

## Limits

- **The licence check is a list of what is refused.** A dependency whose
  licence GitHub cannot read only warns, and a strong-copyleft licence that is
  not on the list, or is declared under an older identifier, passes. A project
  that needs a licence policy replaces `deny-licenses` with `allow-licenses`
  in its own copy of the workflow and accepts the upkeep. Raised by a security
  review of this add-on.
- **None of the four workflows has run on GitHub.** GitHub Actions was down on
  the day this was written. actionlint and zizmor pass on the files, which
  checks their form, not their behaviour. Not seen: Dependency Review reading
  a real pull request, the Scorecard upload being accepted, the audit job
  running `pnpm` through Corepack, the linux-x64 linter builds running (their
  checksums are the release's own, but only the darwin-arm64 builds were
  downloaded and run).
- **Scorecard is included on the strength of its documentation**: with
  `publish_results: false` it needs no secret in a public repository. Its
  `Branch-Protection` check may read less than a person can see, because the
  default token cannot read every setting. If it does not work in your
  repository, delete `scorecard.yml`; nothing else depends on it.
- **The settings check has switched nothing on.** It prints commands and
  runs none, and none it printed was run while it was written. The six for
  single settings are the endpoints GitHub documents. The ruleset's body has the fields
  GitHub's API description requires (2026-10-12); GitHub was not sent it.
- **It reads rulesets, not classic branch protection.** A branch held by a
  classic rule alone gets three `FAIL` lines, and a line that says a classic
  rule is there.
- **It does not read who may bypass a ruleset**, or whether a required check
  is tied to GitHub Actions. The ruleset it prints accepts a check of that
  name from any source.
- **It reads the workflows in the checkout**, not on GitHub's default
  branch. A workflow that is not pushed yet is counted.
- **The dependency graph has no line of its own.** Alerts that are on mean
  the graph is on. Alerts that are off say nothing about it.
- **It does not read** Dependabot version updates, whether Dependabot has
  paused security updates, the Renovate app, or what `SECURITY.md` asks for.
- **It asks the host `gh` uses by default.** An `origin` on GitHub
  Enterprise Server is not read as a GitHub address.
- **The first run of the local lint needs the network.** In a sandbox without
  it the answer is `SKIP`, exit 2. That is correct and it is not a pass.
- **No Windows build is pinned.** Run the lint under WSL, or leave it to CI.
- **No update bot manages the two linter pins.** A person changes the
  version, four URLs and four checksums together. `pins.mts` belongs to the
  add-on, so a project that edits it must pass `--force` on the next update
  of the add-on.
- **zizmor runs with its default persona.** Its `pedantic` and `auditor`
  findings (a missing `concurrency`, a permission without a comment) are not
  shown. The add-on's own workflows have none.
- **The licence list refuses; it does not allow.** A licence the action cannot
  read only warns.
- **`pnpm audit` and Dependency Review overlap on production dependencies.**
  That is meant: one reads the whole tree every week, the other reads the
  change before it merges.
- **The weekly runs stop** when a repository has had no activity for 60 days;
  GitHub disables scheduled workflows then.
- **`dependabot.yml`, `renovate.json5` and `SECURITY.md` are not updated**
  when the add-on is. Each is the project's file from the first install. When
  the add-on's version of one changes, the update shows the lines.
- **The Renovate config was not run.** Its form was checked by Renovate's own
  validator (see "How it was tested"); no repository with the app installed
  has used it, so no pull request it opens has been seen.
- **The Dockerfile check reads text.** It does not build, and it does not
  know an image by its content: a digest that names the wrong image passes.
  It does not follow an `ARG` to its value; it asks for the image written
  out. It does not see a command line: `--target` ships another stage than
  the last, and `--build-context` replaces an image. A base image from
  outside may set a user that is not root; the check asks for a `USER` line
  all the same. `pip`, `apt`, `curl | sh`, a command built from variables and
  a script that is copied in and run are not judged, and neither is the image
  that `# syntax=docker/dockerfile:1` pulls by its tag. A file named
  `dockerfile.ts` is read as a Dockerfile and fails.
- **A project from before `SECURITY.md` was shipped** gets it on the next
  update of the add-on, unless its copy of the add-on is from before
  templates were kept (2026-10-06); then copy it from
  `tools/templates/ci-security.SECURITY.md.txt`.
- **The lint tool's cache is under `node_modules/`**, so removing
  `node_modules` means one more download.
