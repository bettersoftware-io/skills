# Weekly changelog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `agent-workflow` reminds each Claude Code and Codex session of a changelog week that is due. It proves a week complete both ways, generates the link definitions, and dates its tags by their week. It also ships two workflows that stay off until a project switches them on: GitHub Releases from `CHANGELOG.md`, and a headless writer that opens a pull request.

**Architecture:** Pure functions in `tools/agent-workflow/lib/` (history, changelog, due, tag, releases) take text and return values. Thin entry points (`changelog.mts`, `close-week.mts`, `sync-releases.mts`, `hooks/changelog-due.mts`) read files and run programs through the injected `Run`. The two workflows gate their job on a repository variable.

**Tech Stack:** TypeScript `.mts` run by plain Node 26 (erasable syntax only, relative imports with extension), Vitest 5, `gh`, `git`, GitHub Actions, Anthropic's `claude-code-action`.

**Spec:** `docs/superpowers/specs/2026-10-18-changelog-design.md`

## Global Constraints

- **Where the work happens.** Branch `worktree-changelog`, worktree `.claude/worktrees/changelog`. The spec is already committed there. Nothing is pushed, no pull request is opened, and nothing is created on GitHub until the user says so.
- **Path shorthand.** `AW/` means `addons/agent-workflow/`, and `TOOLS/` means `AW/files/tools/agent-workflow/`.
- **Contract.** Follow the add-on contract in `addons/README.md`:
  - an add-on only adds;
  - tooling is `.mts` in `tools/agent-workflow/`;
  - each workflow is the add-on's own file, with actions pinned by full commit hash and the version as a comment, the narrowest `permissions`, and `persist-credentials: false`;
  - no `.js`, `.mjs` or `.cjs` file.
- **Exit codes.** 0 = nothing wrong. 1 = something wrong, named above a `FAIL` line. 2 = nothing judged, on a `SKIP …. Nothing was judged` line. Exit 2 is never reported as a pass. The one exception is `sync-releases --check` on a file with no week yet: it prints `SKIP` and exits 0, following the `check:dockerfiles` precedent.
- **Mutants.** Every new test is shown able to fail. Add a mutant to `AW/tests/mutants.json` (format `{name, file, find, replace, test}`). Run `node addons/coverage/files/tools/coverage/mutation-check.mts addons/agent-workflow/tests/mutants.json`: every mutant must be killed. Each mutant's test command must first be seen green and selecting at least one test. `pnpm vitest run scripts/mutants.test.mts` must stay green.
- **`hook-registration.mts` is kept twice.** `scripts/lib/hook-registration.mts` and `TOOLS/lib/hook-registration.mts` stay byte-identical. Do not change either unless both change.
- **Merge subjects `due` recognises.**
  - `^Merge pull request #(\d+) from `
  - `^Merge PR #(\d+): `
  - a trailing ` \(#(\d+)\)$`; with several, the last one counts.
- **The week boundary.** A merge at Monday 00:00:00Z belongs to the new week. This is `isInWeek` in `TOOLS/lib/week.mts`.
- **Tagger.** Name `github-actions[bot]`, email `41898282+github-actions[bot]@users.noreply.github.com`. The date is the week's `endOf` plus 5 minutes, as ISO (`2026-10-05T00:05:00Z` for 2026-W40).
- **Repository variables.** `CHANGELOG_RELEASES` and `CHANGELOG_WRITER`. Each is on only when it equals `'true'`. The writer also needs the secret `ANTHROPIC_API_KEY`.
- **Version.** `.codex-plugin/plugin.json` goes from `0.19.0` to `0.20.0`. `AW/addon.json` gains `releaseNotes` with id `0.20.0`.
- **Style.** Comments, README text and messages are written in the repository's style: short plain sentences that say what was measured.
- **Commits.** Messages are conventional (`feat(agent-workflow): …`) and end with the session's attribution lines.
- **Rule for every task.** Run `pnpm vitest run addons/agent-workflow` and `pnpm typecheck` before each commit. Run `pnpm install` once in the worktree first.

## Review Focus

1. **An `origin` written the SSH way** (`git@github.com:acme/app.git`), or ending in `.git`, gives `https://github.com/acme/app`. Test in Task 1.
2. **The year's turn.** 2026 has 53 ISO weeks, so `due` on 2027-01-05 with `2026-W52` as the newest heading lists `2026-W53` and `2027-W01`. Test in Task 3.
3. **A revert of a squash** (`Revert "Add x (#12)" (#15)`) is pull request 15, not 12. Test in Task 1.
4. **A reference to earlier work.** A week that cites an older pull request ("follows [#9]") fails the two-way check. The message says to write a plain link instead of a citation. Test in Task 2.
5. **The hook where it cannot judge:** a folder with no git, no `origin`, or no `CHANGELOG.md`. It prints nothing and exits 0, in well under its 5 second timeout. Test in Task 4.

---

### Task 1: Merged pull requests and the repository's address, from git

**Files:**
- Create: `TOOLS/lib/history.mts`
- Test: `AW/tests/history.test.mts`

**Interfaces:**
- Produces:
  - `interface Merge { number: number; mergedAt: string }` (ISO, UTC).
  - `parseHistory(log: string): Merge[]`. Input lines are `<sha>\t<committer ISO date>\t<subject>`. Output is oldest first, and lines without a number are dropped.
  - `readHistory(root: string, ref: string, run: Run): Merge[]`. It runs `git log --first-parent --format=%H%x09%cI%x09%s <ref>`, and throws `HistoryError` when git fails.
  - `remoteBranch(root: string, run: Run): string | undefined`. It returns `origin/HEAD` if `git rev-parse --verify --quiet origin/HEAD` succeeds, else `origin/main` if that verifies, else `undefined`.
  - `repositoryUrl(root: string, run: Run): string | undefined`. It reads `git remote get-url origin` and turns `git@github.com:o/n(.git)`, `https://github.com/o/n(.git)` and `ssh://git@github.com/o/n(.git)` into `https://github.com/o/n`. Anything else gives `undefined`.
  - `class HistoryError extends Error`.

- [ ] **Step 1: Write the failing tests.**
  - Fixtures use `createFolder`, `commit` and `git` from `support.mts`. A merge is `git merge --no-ff -m "<subject>"` with `GIT_COMMITTER_DATE` set through `commit`'s date pattern. Add a `mergeAt(repo, branch, subject, date)` helper to `support.mts`, since `close-week.test.mts` has a private one.
  - `it("reads GitHub's merge subject, a squash's trailing number and RTC's Merge PR subject")`: three subjects give `[12, 13, 14]` with their dates.
  - `it("takes the last number of a revert of a squash")`: `Revert "Add x (#12)" (#15)` gives `15`.
  - `it("follows the first parent only")`: a commit on a merged side branch whose subject ends `(#99)` is not listed.
  - `it("drops a subject that names no pull request")`.
  - `it("finds origin/HEAD, else origin/main, else nothing")`: three fixtures. Use `createRemote()` and delete `refs/remotes/origin/HEAD` for the second.
  - `it("turns each way of writing a GitHub origin into its https address")`: the three forms above, plus `https://gitlab.com/o/n` giving `undefined`.
- [ ] **Step 2: Run** `pnpm vitest run addons/agent-workflow/tests/history.test.mts`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement** `TOOLS/lib/history.mts` with the interfaces above, using the subject patterns from Global Constraints.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add mutants:**
  - drop the `Merge PR` pattern;
  - take the first trailing number instead of the last;
  - remove `--first-parent`;
  - remove the `.git` strip.

  Run mutation-check. Expected: all killed.
- [ ] **Step 6: Commit** `feat(agent-workflow): read a week's merged pull requests from git`.

### Task 2: The two-way proof and generated definitions

**Files:**
- Modify: `TOOLS/lib/changelog.mts` (`CITATION`, `DEFINITION`, `checkWeek`, `definitionsIn`)
- Modify: `TOOLS/changelog.mts` (the `check` branch, and a new `defs` branch)
- Test: `AW/tests/changelog.test.mts` (rewrite the three definition tests at ~51-66, and add the cases below)

**Interfaces:**
- Consumes: `repositoryUrl` (Task 1).
- Produces:
  - `commitCitationsIn(text: string): string[]`, for labels such as ``[`abc1234`]``, which are 7–40 hex characters. A definition does not count as a citation.
  - `expectedDefinitions(text: string, repo: string): string[]`, as lines:
    - `[#N]: <repo>/pull/N` for each cited PR, ascending;
    - then ``[`sha`]: <url>`` for each cited commit, sorted by label. `<url>` is the existing definition's address when that address starts with `<repo>/commit/<sha>`, else `<repo>/commit/<sha>`.
  - `withDefinitions(text: string, repo: string): string`. It removes every definition line of citation form, wherever it is, and writes `expectedDefinitions` as one block at the end. One blank line separates the block from the text, and the file ends in a newline. Other reference definitions (`[foo]: url`) are left where they are.
  - `checkWeek(text: string, week: string, merged: number[], repo: string): string[]`. Its problems are, in this order:
    - the existing missing-heading and not-cited lines;
    - `cited in <week> and not merged in it: #9. A reference to earlier work is a plain link, not a citation`;
    - `the link definitions are not what \`pnpm changelog defs\` writes: run \`pnpm changelog defs --write\``, when `withDefinitions(text, repo) !== text`.
  - CLI `changelog defs [--write]`. Without `--write` it prints the lines that differ and exits 1 when there are any, else exits 0. `--write` writes the file and exits 0. With no `origin` address it exits 2 with `SKIP`.

- [ ] **Step 1: Write the failing tests.**
  - `it("names a pull request cited in a week it was not merged in, and says how to refer to earlier work")`.
  - `it("generates PR definitions ascending, then commit definitions by label")`.
  - `it("keeps an existing full-hash address for a commit label")`: `` [`abc123456`]: <repo>/commit/abc123456def… `` is kept.
  - `it("leaves a reference definition that is no citation where it is")`.
  - `it("fails a file whose definitions differ from what defs writes, and passes once defs --write has run")`. Drive this through `changelog({argv: ["defs", "--write"], …})` with a fake `run` that answers `git remote get-url origin`.
  - `it("skips defs when origin is not a GitHub address")`: exit 2.
  - Replace the old order, the twice-given definition and the definition pointing elsewhere tests with the defs mismatch line. Keep `it("accepts a definition that points at an issue of that number")` as a defs case: an `/issues/N` address is replaced by `/pull/N`, so it now fails the check. Update its name and expectation to say so.
- [ ] **Step 2: Run** `pnpm vitest run addons/agent-workflow/tests/changelog.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces. The `check` branch reads the address through `repositoryUrl(root, run)`, and gives exit 2 when there is none.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add mutants:**
  - drop the cited-not-merged rule;
  - sort commits by first appearance instead of by label;
  - always rebuild the commit address;
  - stop leaving non-citation definitions in place.

  Update existing mutants whose `find` text changed, until `scripts/mutants.test.mts` is green. Run mutation-check. Expected: all killed.
- [ ] **Step 6: Commit** `feat(agent-workflow): a week's citations equal its merges, and the definitions are generated`.

### Task 3: `changelog due`, and `weeks` re-checks the newest week

**Files:**
- Create: `TOOLS/lib/due.mts`
- Modify: `TOOLS/changelog.mts` (a new `due [--ref <ref>]` branch; `weeks` adds the extend line)
- Test: `AW/tests/due.test.mts`

**Interfaces:**
- Consumes: `Merge`, `readHistory` and `remoteBranch` (Task 1); `sectionOf`, `citationsIn` and `weeksIn` (Task 2's module); `weekOf`, `lastFinishedWeek`, `weekAfter`, `parseWeek`, `startOf` and `isInWeek` (`week.mts`).
- Produces:
  - `interface DueWeek { week: Week; merged: number[]; missing: number[]; extend: boolean }`. `extend` is true when the week already has a heading in either text.
  - `dueWeeks(texts: string[], merges: Merge[], now: Date): DueWeek[]`. `texts` holds the working and the remote `CHANGELOG.md`.
    - The weeks judged are the newest heading's week, when it is finished, and every finished week after it, up to `lastFinishedWeek(now)`. The newest heading is taken over all texts. With no heading in any text, only `lastFinishedWeek(now)` is judged.
    - A week is due when it has merges and no text cites them all in that week's section.
    - The result is oldest first.
  - `describeDue(d: DueWeek): string`. For example:
    - `2026-W41  12 merged, 3 not cited (#20, #21, #22): extend it with /workflow:changelog 2026-W41`;
    - with no heading: `2026-W41  12 merged, no entry: write it with /workflow:changelog 2026-W41`.
  - `findDue(root: string, run: Run, now: Date, ref?: string): DueWeek[]`.
    - It reads `CHANGELOG.md` from the working tree, and `git show <ref>:CHANGELOG.md`, where `ref` is the argument or `remoteBranch`.
    - It reads the history at `ref`.
    - It throws `ChangelogError` with no working `CHANGELOG.md`, or no ref.
    - A missing file at the ref counts as an empty text.
  - CLI `changelog due [--ref <ref>]`. It prints one `describeDue` line per week. It exits 0 with none, 1 with some, and 2 with `SKIP`.
  - `weeks` output: after its current lines, it prints one line `"<week>  <start>..<end>  extend: <n> not cited"` for the newest heading's week, when that week is in `findDue`'s result. When `findDue` throws, it prints nothing extra.

- [ ] **Step 1: Write the failing tests**, pure against `dueWeeks` unless noted:
  - `it("is due when a finished week has merges and no section")`.
  - `it("is due to extend when a section written early misses merges after it")`: the newest heading is W40, which has a merge after the cited ones, and `now` is in W41.
  - `it("never judges the current week")`.
  - `it("counts a week written when either the working or the remote text cites it all")`: two cases.
  - `it("judges only the last finished week in a file with no week yet")`.
  - `it("lists W53 and the next year's W01 across the turn of 2026")`.
  - `it("leaves a merge at Monday 00:00:00Z to the next week")`.
  - `it("reads the remote text and history through git, and skips with no CHANGELOG.md or no remote branch")`: through `changelog({argv:["due"]})` on a `createRemote()` fixture.
  - `it("weeks adds the newest week to extend")`.
- [ ] **Step 2: Run** `pnpm vitest run addons/agent-workflow/tests/due.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces.
- [ ] **Step 4: Run** the same command plus `changelog.test.mts`. Expected: PASS.
- [ ] **Step 5: Add mutants:**
  - judge the current week too;
  - require both texts to cite;
  - judge every week when the file has none;
  - drop the extend line from `weeks`.

  Run mutation-check. Expected: all killed.
- [ ] **Step 6: Commit** `feat(agent-workflow): changelog due names the weeks still to write or extend, offline`.

### Task 4: The session-start reminder in both hosts

**Files:**
- Create: `TOOLS/hooks/changelog-due.mts`
- Modify: `TOOLS/lib/host.mts` (the constants below)
- Modify: `AW/addon.json` (`hostSettings`)
- Modify: `TOOLS/check.mts` (checks the second hook's registration)
- Test: `AW/tests/changelog-due-hook.test.mts`
- Modify: `AW/tests/addon.test.mts`, `AW/tests/check.test.mts`
- Modify: `scripts/host-settings.test.mts`

**Interfaces:**
- Consumes: `findDue` and `describeDue` (Task 3).
- Produces:
  - In `host.mts`:
    - `DUE_HOOK_SCRIPT = "tools/agent-workflow/hooks/changelog-due.mts"`.
    - `DUE_HOOK_COMMANDS: Record<string,string>`, which is `node "$CLAUDE_PROJECT_DIR/<script>"` for Claude and `node <script>` for Codex.
    - `DUE_HOOK_MATCHERS = { [CLAUDE_SETTINGS]: "startup|resume|clear", [CODEX_HOOKS]: "startup|resume" }`.
  - The hook reads stdin (ignored apart from a JSON `cwd`, which is used as the root when present, else `process.cwd()`). When `findDue` returns weeks, it prints this to stdout:

    ```json
    {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<text>"}}
    ```

  - `<text>` is fixed copy:

    ```
    Changelog: as of the last fetch of the default branch, these weeks are due in CHANGELOG.md:
    <one describeDue line each>
    Mention this to the person at a natural point; do not drop the task you were given to write it. In Codex the command is $workflow-changelog <week>.
    ```

  - It prints nothing otherwise. It always exits 0, catches every error, and prints nothing on one.
  - `hostSettings` adds `SessionStart: [{ matcher, hooks: [{ type: "command", command, timeout: 5 }] }]` under `hooks` in both files. Codex's entry also has `"statusMessage": "Checking the changelog"`.

- [ ] **Step 1: Check Codex's hook contract** against https://developers.openai.com/codex/hooks before the tests: does a `SessionStart` hook give context through stdout JSON `hookSpecificOutput.additionalContext`, or through plain stdout, and what are its matcher values? If it differs from the above, change Codex's matcher and the output (one format per host, told apart as `split-outward-commands.mts` does, by `turn_id`), and record the source in the hook's header comment.
- [ ] **Step 2: Write the failing tests.**
  - `it("gives the due weeks as session context, with the command for each host")`: spawn `node` on the hook in a `createRemote()` project that has a due week. Parse the JSON, and assert `hookEventName` and the lines of the text.
  - `it("says nothing when nothing is due")`.
  - `it("says nothing and exits 0 with no git, no origin, or no CHANGELOG.md, within a second")`: three folders.
  - `it("registers the reminder in both hosts with the matcher and command the check looks for")`: in `addon.test.mts`, against `host.mts`.
  - `it("fails the check when the reminder is not registered")`: in `check.test.mts`.
  - `it("merges a SessionStart group once, and covers it by a group with the same sources")`: in `scripts/host-settings.test.mts`.
- [ ] **Step 3: Run** `pnpm vitest run addons/agent-workflow scripts/host-settings.test.mts`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement** the hook, the constants, the manifest entries, and the check. The check reads `hooks.SessionStart` with `groupRuns(group, command, "startup", host)`, and FAILs with `FIX` when no group runs it.
- [ ] **Step 5: Run** the same command. Expected: PASS.
- [ ] **Step 6: Add mutants:**
  - the hook exits 1 on an error;
  - the hook prints when nothing is due;
  - Codex's registration is dropped from the manifest;
  - the check stops reading `SessionStart`.

  Run mutation-check. Expected: all killed.
- [ ] **Step 7: Commit** `feat(agent-workflow): each session starts with the changelog weeks that are due`.

### Task 5: Tags carry their week's date, and the issue lists every due week

**Files:**
- Create: `TOOLS/lib/tag.mts`
- Modify: `TOOLS/close-week.mts`
- Test: `AW/tests/close-week.test.mts` (update the API call expectation at ~44-58, and add cases)

**Interfaces:**
- Consumes: `findDue` and `describeDue` (Task 3); `endOf` (`week.mts`).
- Produces:
  - `tagDate(week: Week): string`, which is `new Date(endOf(week) + 5 * 60_000).toISOString()` with the `.000` milliseconds removed, giving `2026-10-05T00:05:00Z`.
  - `createWeekTag(week: Week, sha: string, repository: string, gh: (...args: string[]) => Ran): { ok: true } | { ok: false; step: "object" | "ref"; error: string }`.
    - It calls `gh api repos/<repo>/git/tags` with `-f tag=`, `-f message=` (today's text), `-f object=`, `-f type=commit`, `-f tagger[name]=github-actions[bot]`, `-f tagger[email]=41898282+github-actions[bot]@users.noreply.github.com`, `-f tagger[date]=<tagDate>`, `--jq .sha`.
    - It then calls the ref.
  - `close-week` uses `createWeekTag`. Its issue body adds a section, when `findDue(root, run, now, "HEAD")` lists any week:

    ```
    Still due:
    - <describeDue>
    ```

    A week that already has an entry gets the title `Changelog: extend <week>` instead of `write`. A `findDue` error leaves the section out, and adds the line `(Could not tell which other weeks are due: <message>.)`.

- [ ] **Step 1: Write the failing tests:**
  - `it("dates the tag at Monday 00:05 UTC after its week, even on a late run")`, with `NOW` `2026-10-07T15:00:00Z`;
  - `it("lists every week still due in the issue")`;
  - `it("titles the issue extend when the week already has an entry")`;
  - `it("still opens the issue when it cannot tell what else is due")`.
- [ ] **Step 2: Run** `pnpm vitest run addons/agent-workflow/tests/close-week.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add mutants:**
  - date the tag at `endOf` with no 5 minutes;
  - drop `tagger[date]`;
  - drop the due section;
  - always title the issue `write`.

  Run mutation-check. Expected: all killed.
- [ ] **Step 6: Commit** `feat(agent-workflow): a week's tag is dated by its week, and the issue lists what is still due`.

### Task 6: `changelog tag <week>` for past weeks

**Files:**
- Modify: `TOOLS/changelog.mts` (a `tag` branch)
- Modify: `TOOLS/lib/host.mts` (`ASK_RULES`)
- Modify: `AW/addon.json` (`hostSettings` ask rules)
- Test: `AW/tests/changelog-tag.test.mts`

**Interfaces:**
- Consumes: `createWeekTag` and `tagDate` (Task 5); `parseWeek` and `endOf`.
- Produces:
  - CLI `changelog tag <week> [--apply]`. It reads `owner/name` from `gh repo view --json nameWithOwner --jq .nameWithOwner`.
    - It refuses with exit 1 when `gh api repos/<r>/git/ref/tags/<week>` succeeds: `the tag <week> exists. This never moves a tag`.
    - It finds the commit with `git rev-list -1 --first-parent --before=<endOf-1s> <remoteBranch>`.
    - Without `--apply` it prints `would tag <sha> as <week>, dated <tagDate>` and exits 0.
    - With `--apply` it calls `createWeekTag`.
  - `ASK_RULES` gains `"Bash(pnpm changelog tag *--apply*)"` and `"Bash(pnpm changelog:releases *--apply*)"`, and so does the manifest.

- [ ] **Step 1: Write the failing tests:**
  - `it("plans without --apply and writes nothing")`;
  - `it("refuses a week that has a tag")`;
  - `it("creates the tag on the week's last first-parent commit, dated by its week")`;
  - `it("asks before either --apply, in the manifest and in host.mts")`.
- [ ] **Step 2: Run** `pnpm vitest run addons/agent-workflow/tests/changelog-tag.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces.
- [ ] **Step 4: Run** the same command plus `addon.test.mts`. Expected: PASS.
- [ ] **Step 5: Add mutants:**
  - skip the exists refusal;
  - write without `--apply`;
  - drop one ask rule.

  Run mutation-check. Expected: all killed.
- [ ] **Step 6: Commit** `feat(agent-workflow): changelog tag makes a past week's tag, dated by its week, never moving one`.

### Task 7: Releases from `CHANGELOG.md`, off until switched on

**Files:**
- Create: `TOOLS/lib/releases.mts`
- Create: `TOOLS/sync-releases.mts`
- Create: `AW/files/.github/workflows/sync-releases.yml`
- Modify: `AW/addon.json` (script `"changelog:releases": "node tools/agent-workflow/sync-releases.mts"`, and `verify` becomes `pnpm agent-workflow:check && pnpm changelog:releases --check`)
- Test: `AW/tests/releases.test.mts`, ported from RTC's `tests/scripts/changelog/sync-releases.test.ts`. Read it with `git -C ~/workarea/dev/github.com/bettersoftware-io/ReactiveTraderCloudClone show origin/main:tests/scripts/changelog/sync-releases.test.ts`, and the script the same way from `scripts/changelog/sync-releases.mts`.
- Modify: `AW/tests/addon.test.mts` (a `describe("the release workflow")` beside the weekly-tag one)

**Interfaces:**
- Produces:
  - `parseWeeks(text): { tag: string; title: string; section: string }[]` and `renderReleaseBody(week, definitions: Map<string,string>, repo: string, branch: string): string`. These are RTC's rewrites, with `blob/<branch>` in place of `blob/main`.
  - `planReleases(weeks, state: RemoteState, render): Plan`. This is RTC's logic unchanged: oldest first, `latest` only on the newest tagged week, and an unchanged name and body planned as unchanged.
  - `syncReleases({ root, argv, run, report }): number`. Its flags:
    - `--repo`, which defaults to `gh repo view`;
    - `--branch`, which defaults to `main`;
    - `--apply`, `--only <week>`, `--body <week>`, `--state <file>`, `--check`.
    - `--check` renders every week offline. It exits 1 naming the week and the commit with no definition, exits 0 with `SKIP … no week yet` on a file with no week, and exits 2 with no `CHANGELOG.md`.
  - The workflow is RTC's `sync-releases.yml`, with these changes:
    - the job has `if: vars.CHANGELOG_RELEASES == 'true'`;
    - the sparse checkout is `CHANGELOG.md` and `tools/agent-workflow`;
    - the push paths are `CHANGELOG.md` and `tools/agent-workflow/sync-releases.mts` and `tools/agent-workflow/lib/releases.mts`;
    - the run line is `node tools/agent-workflow/sync-releases.mts --repo "$GITHUB_REPOSITORY" --branch "$DEFAULT_BRANCH" --apply`, with `DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}` in `env`.

    Its pins are the same `actions/checkout` and `actions/setup-node` commits as `weekly-tag.yml`.

- [ ] **Step 1: Port RTC's tests** as Vitest cases against the functions, through the injected `run` and `--state` fixtures. Add:
  - `it("checks every week renders, offline")`;
  - `it("skips the check on a file with no week")`;
  - `it("links relative paths at the default branch it is given")`;
  - workflow tests (pins equal to weekly-tag's; `if:` on the variable; `contents: write` only; `persist-credentials: false`; no install step; `concurrency` with `cancel-in-progress: false`).
- [ ] **Step 2: Run** `pnpm vitest run addons/agent-workflow/tests/releases.test.mts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces, in this repository's style: `run`/`report` injected, no top-level side effects, and `isMainModule` at the bottom.
- [ ] **Step 4: Run** the same command plus `addon.test.mts`. Expected: PASS.
- [ ] **Step 5: Port RTC's 12 mutants** to the new file paths, and add mutants that:
  - drop the workflow's `if:`;
  - make `--check` pass a missing definition.

  Run mutation-check. Expected: all killed.
- [ ] **Step 6: Commit** `feat(agent-workflow): GitHub Releases from CHANGELOG.md, for a project that switches them on`.

### Task 8: The headless writer, off until switched on

**Files:**
- Create: `AW/files/.github/workflows/changelog-writer.yml`
- Modify: `AW/files/.claude/commands/workflow/changelog.md` (a `## In CI` section)
- Modify: `AW/tests/addon.test.mts` (a `describe("the writer workflow")`)

**Interfaces:**
- Produces: a workflow with:
  - triggers `schedule: "0 1 * * 1"` and `workflow_dispatch`;
  - `concurrency: { group: changelog-writer, cancel-in-progress: false }`;
  - top-level `permissions: contents: read`;
  - job `if: vars.CHANGELOG_WRITER == 'true'`, with permissions `contents: write`, `pull-requests: write` and `issues: read`.

  Its steps, in order:
  1. Checkout of the default branch, `fetch-depth: 0`, `persist-credentials: false`.
  2. `setup-node` 26.
  3. A step `id: due` that fails with `ANTHROPIC_API_KEY is not set: add the secret or unset CHANGELOG_WRITER` when the secret is empty. The secret is passed through `env`, never in the command line. The step then runs `node tools/agent-workflow/changelog.mts due --ref HEAD`:
     - exit 0 sets output `due=false`;
     - exit 1 sets `due=true` and writes the lines to the job summary;
     - exit 2 fails the step.
  4. Under `if: steps.due.outputs.due == 'true'`: pnpm setup by the starter's corepack pattern (copy it from the project `ci.yml` the starter ships), then `pnpm install --frozen-lockfile`.
  5. Under the same `if`: Anthropic's `claude-code-action`, pinned by commit. It is given:
     - the prompt `Follow .claude/commands/workflow/changelog.md for the weeks \`pnpm changelog due\` lists, in its "In CI" form.`;
     - the allowed tools `Bash(pnpm changelog weeks)`, `Bash(pnpm changelog prs:*)`, `Bash(pnpm changelog check:*)`, `Bash(pnpm changelog defs:*)`, `Bash(pnpm changelog due:*)`, `Bash(gh pr view:*)`, `Bash(gh pr create:*)`, `Bash(gh issue list:*)`, `Bash(gh repo view:*)`, `Bash(git switch:*)`, `Bash(git add:*)`, `Bash(git commit:*)`, `Bash(git push -u origin changelog/*)`, `Read`, `Write` and `Edit`;
     - a turn cap of 40;
     - `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`.
- The command's `## In CI` section says:
  - skip step 3 (the worktree) and work on a branch `changelog/<newest week>`;
  - one pull request for all due weeks, titled `docs(changelog): <weeks>`;
  - stop after `gh pr create`, and never merge;
  - when `pnpm changelog check` fails, open it as a draft (`--draft`) whose body lists what is missing.

- [ ] **Step 1: Look up `anthropics/claude-code-action`**: its latest release, the commit hash of that release (`gh api repos/anthropics/claude-code-action/releases/latest`, then the tag's commit), and the input names for the prompt, the allowed tools, the turn cap and the API key, from its README at that commit. Use those names in place of the ones above where they differ. Also confirm push access: with `persist-credentials: false` the action needs its own token for the push. Use the input the action documents for a GitHub token, fed `${{ github.token }}`, and record why in a comment.
- [ ] **Step 2: Write the failing tests** in `addon.test.mts`:
  - `it("runs nothing until CHANGELOG_WRITER is true")`;
  - `it("stops with a message when the secret is missing, before anything is installed")`;
  - `it("checks what is due before installing or running Claude Code")`: step order;
  - `it("pins every action by commit, the same checkout and setup-node as weekly-tag")`;
  - `it("may push a changelog branch and open a pull request, and never merge")`: no `gh pr merge` in allowed tools, and the permissions are exactly the three above;
  - `it("puts no expression in a command line")`: reuse the weekly-tag test's helper.
- [ ] **Step 3: Run** `pnpm vitest run addons/agent-workflow/tests/addon.test.mts`. Expected: FAIL.
- [ ] **Step 4: Write** the workflow and the command section.
- [ ] **Step 5: Run** the same command. Then run actionlint and zizmor offline on both new workflows, as `addons/ci-security` runs them (its README gives the commands). Expected: PASS, and no findings above the level weekly-tag passes at.
- [ ] **Step 6: Add mutants:**
  - drop the job `if:`;
  - move the install before the due step;
  - add `Bash(gh pr merge:*)` to the allowed tools.

  Run mutation-check. Expected: all killed.
- [ ] **Step 7: Commit** `feat(agent-workflow): a headless changelog writer, for a project that switches it on and pays for it`.

### Task 9: Command, section, README, release notes and version

**Files:**
- Modify: `AW/files/.claude/commands/workflow/changelog.md`
- Modify: `AW/AGENTS.section.md` (`### The changelog`, ~338)
- Modify: `AW/README.md` (the "What it adds" table; the "weekly tag and the changelog" section; new sections "Releases" and "The writer in CI")
- Modify: `AW/addon.json` (`summary`, `releaseNotes`)
- Modify: `.codex-plugin/plugin.json` (`0.20.0`)
- Modify: `AW/files/CHANGELOG.md` (its introduction mentions `pnpm changelog defs` and the reminder)
- Test: `AW/tests/addon.test.mts`

**Interfaces:**
- The command:
  - Step 1 becomes `pnpm changelog due` first, then `weeks`.
  - Step 4 gains the partial-week rule. A week written before it ends says `(partial: written <date>)` at the end of its summary, and is extended in place later.
  - Step 5 becomes `pnpm changelog defs --write`.
  - A new `## Backfill` section covers:
    - one brief, then one agent per week;
    - the era of pull requests: cite every one;
    - before them: key commits, a coverage list of every commit, and a compare link between the week's tags;
    - plain words, not plan labels;
    - `pnpm changelog tag <week>`, asking the person before `--apply`.
  - The `allowed-tools` frontmatter becomes `Bash(pnpm changelog weeks), Bash(pnpm changelog due:*), Bash(pnpm changelog prs:*), Bash(pnpm changelog check:*), Bash(pnpm changelog defs:*), Bash(pnpm worktree:*), Bash(pnpm gate:fast:*), Bash(gh pr view:*), Bash(gh issue list:*), Bash(gh repo view:*), Read, Write, Edit`, which leaves out `tag`.
- The section gains one paragraph: a session may start with the due weeks. Mention them to the person when it fits, and do not drop the task to write them.
- `releaseNotes` `0.20.0` has four notes:
  1. Sessions now start with the changelog weeks that are due. In Codex, trust the new hook with `/hooks`.
  2. `pnpm changelog check` now fails a definitions block that differs from what `pnpm changelog defs --write` writes, and a citation in the wrong week. Run `defs --write` once.
  3. The new workflows `sync-releases.yml` and `changelog-writer.yml` are skipped until `CHANGELOG_RELEASES` or `CHANGELOG_WRITER` is `true`. The README says how to switch each on, and what the writer costs.
  4. Tags are now dated by their week.

- [ ] **Step 1: Write the failing tests:**
  - `it("does not let the changelog command run changelog tag without a prompt")`;
  - `it("has release notes for 0.20.0 that name both variables and /hooks")`;
  - update `it("are the seven the check knows about")` if anything the command lists changed.
- [ ] **Step 2: Run** `pnpm vitest run addons/agent-workflow scripts/plugin-manifests.test.mts`. Expected: FAIL.
- [ ] **Step 3: Write** the text and bump the version.
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`. Expected: PASS, the whole suite.
- [ ] **Step 5: Commit** `docs(agent-workflow): the changelog's reminder, proof, releases and writer, and 0.20.0`.

### Task 10: Proof in skills-demo, and the record

**Files:**
- Create: `docs/changelog-2026-10-24.md` (the test record; use the date of the run)
- Modify: `docs/STATUS.md`

- [ ] **Step 1:** In `~/workarea/dev/github.com/bettersoftware-io/skills-demo`, run `git switch -c try-agent-workflow-0.20.0`, then `node <worktree>/scripts/add-to-project.mts . agent-workflow`, then `pnpm install`. Expected: the summary lists the two workflows, the hook in both settings files, and exit 0.
- [ ] **Step 2:** Run `pnpm agent-workflow:check`, then `pnpm changelog:releases --check`, then `pnpm gate:full`. Expected: PASS, SKIP (no week yet) and PASS.
- [ ] **Step 3:** Run `git fetch` and then `pnpm changelog due`. Expected: the last finished week, with skills-demo's real merged PRs. Run the hook as each host starts it (`echo '{}' | node tools/agent-workflow/hooks/changelog-due.mts`, and the Codex payload with `turn_id`). Expected: the JSON above.
- [ ] **Step 4:** Write that week's entry with `/workflow:changelog <week>` in this session, following the command. Run `pnpm changelog check <week>`, `pnpm changelog defs`, and `pnpm changelog:releases --body <week>`, plus `--state` with a fixture holding that tag. Expected: PASS, no difference, and the notes as designed.
- [ ] **Step 5:** Start one `claude -p "say what the session context says about the changelog"` in skills-demo, and copy what it answers into the record. Do the same in Codex if `codex` is installed; if not, say so in the record.
- [ ] **Step 6:** Leave skills-demo's branch unpushed. Write the record: commands, outputs, and what was not seen. List under "Seen on GitHub only in part" in `docs/STATUS.md`:
  - the two workflows on GitHub;
  - a real release;
  - a run of the writer;
  - a tag created through the API with a `tagger.date`;
  - Codex (if not run).
- [ ] **Step 7: Commit** `docs: the changelog's run in skills-demo, and what is not seen yet`.
