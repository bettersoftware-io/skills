# An update of visual from 0.18.1 to 0.19.0, 2026-10-17

The visual add-on 0.19.0 must update the projects installed from 0.18.1,
condo-ledger first, without touching their scenarios or seeding. This is that
update tried on a project built to the same shape, then taken the way
`extending-a-project` says.

## Setup

- `main` at `d9e338c` (plugin 0.18.1), unpacked with `git archive` into a
  scratch folder. The update was run from this branch at `3bc6a63`.
- macOS 27.0.1 on arm64, Node 26.11.1, pnpm 12.6.0.
- A project created from the old copy:

  ```
  node scripts/create-project.mts <scratch>/t13-demo --scope @demo --with visual,strict-lint
  ```

  It has the kit (create-project always installs it), `visual`, and
  `strict-lint`, so `gate:full` runs `lint:dead` (knip) over what the update
  adds. `git init`, `pnpm install`.
- Then the two edits condo-ledger has:
  - `visual.pw.ts`: the loop reads each scenario, and
    `await page.setViewportSize({ width: scenario.width, height: 720 })` comes
    before `goto`. `scenarios.ts` gained `width: number` on `Scenario` and
    `width: 1280` on each of its four scenarios.
  - `playwright.config.ts`: `launchOptions: { args: ["--disable-partial-raster"] }`
    under `use`, with a comment.
- With the edits the four pictures changed (the frame grew at 1280 wide), so
  they were redrawn once with `pnpm visual:update`: 5 passed, then
  `pnpm visual` 5 passed. The pictures were the frame element: `empty` 184x144,
  the other three 236x236. `pnpm gate:full` passed. The `linux-x64` goldens
  were left as the old ones; they are not run on a Mac.
- All of it committed in the project, so `git status` shows only what the
  update does.

## The update without `--force`

```
node scripts/add-to-project.mts <project> visual
```

Exit 1, and `git status` clean afterwards:

```
2 file(s) in the project differ from what was installed and would be overwritten:
  packages/client-react/tests/visual/playwright.config.ts
  packages/client-react/tests/visual/visual.pw.ts
      What a project changes in this file now goes in packages/client-react/tests/visual/scenarios.ts, which is the project's own: no update replaces it. A width or height a scenario needs now goes on the scenario: `width` and `height` set the viewport of a page.
      Run this again with --force. It replaces this file, keeps your version as tools/templates/visual.replaced.packages__client-react__tests__visual__visual.pw.ts.txt,
      and writes packages/client-react/tests/visual/scenarios.ts if the project has none. Then move your lines from the copy into packages/client-react/tests/visual/scenarios.ts, and delete the copy.
Nothing was changed. Move your edits out of these files, or pass --force to replace them.
```

Both files are named, and under `visual.pw.ts` it says where the edit goes.
The `playwright.config.ts` edit is the flag and its comment only, so nothing in
it needed copying aside before `--force`.

## The update with `--force`

```
node scripts/add-to-project.mts <project> visual --force
```

Exit 0. The summary, trimmed:

```
visual: 24 file(s) written, 10 already up to date, 1 removed
  wrote    packages/client-react/tests/visual/host/{ScenarioFrame.tsx,address.ts,fonts.ts,main.tsx,picture.ts,render.tsx,seeded.ts}
  wrote    packages/client-react/tests/visual/playwright.config.ts
  wrote    packages/client-react/tests/visual/reach/{reach.browser.tsx,vite.config.ts}
  wrote    packages/client-react/tests/visual/visual.pw.ts
  wrote    tools/visual/{check-styles,coverage,jitter,summary}.mts, tools/visual/lib/{arguments,measure,reach,vitestVersions}.mts
  wrote    tools/templates/visual.…{framing.ts,registry.tsx,scenarios.ts,seeding.ts,tolerance.ts}.txt
  removed  packages/client-react/tests/visual/host/host.css
  created  packages/client-react/tests/visual/framing.ts
  changed  package.json: scripts.visual:check:styles
  changed  package.json: scripts.visual:coverage
  changed  packages/client-react/package.json: devDependencies.@vitest/browser-playwright
  changed  packages/client-react/package.json: devDependencies.@vitest/coverage-v8
  changed  packages/client-react/package.json: devDependencies.playwright
  changed  packages/client-react/package.json: devDependencies.vitest
  changed  package.json: scripts.gate:fast now also runs "pnpm visual:check:styles"
  updated  AGENTS.md: the section for visual
```

The release notes, as printed:

```
Release notes:
  0.19.0
    - Every scenario you have is still the whole app, now pictured as a page: the viewport (1920x1080 unless the scenario sets `width` or `height`), with no frame or padding, so anything below the viewport is no longer in the picture unless the scenario sets a larger `height`. Every golden changes once: run `pnpm visual:update` and open each image before you commit it.
    - A page now defaults to 1080 pixels tall: a scenario that was drawn 720 tall sets `height: 720`.
    - For `linux-x64`, run the `Update visual goldens` workflow: it uploads the images as an artifact and commits nothing, and its job summary gives the commands.
    - If you edited `visual.pw.ts` to size the viewport, a scenario's `width` and `height` now do that. Take the update with `--force`, then move anything else you changed from the copy it keeps in `tools/templates/`.
    - Chromium now starts with `--disable-partial-raster`, so a scenario given up for shading or a flickering list can come back, as a component. If you added that flag to `playwright.config.ts`, `--force` replaces the file and keeps no copy: copy yours aside first if it differs by more than that line.
    - A native control's own text (a `<select>`) still draws two ways on linux-x64: draw its shown value as ordinary text.
    - `tests/visual/framing.ts` is new and yours: the root width (480), root padding (8) and viewport (1920x1080) a scenario falls back on.
    - A set of only whole-app pictures is the shape to avoid: picture each component's states first, then a reasonable number of sections, and keep pages for new screens and sizes (AGENTS.md, "The pyramid").
    - No example scenario, golden or registry is added to your project. To picture components and sections, copy `registry.tsx` from `tools/templates/visual.packages__client-react__tests__visual__registry.tsx.txt` with your own entries, return `render` from `seedScenario` as `tools/templates/visual.packages__client-react__tests__visual__seeding.ts.txt` does, and put the app's theme root in its `Surround`.
    - The shipped tolerance is now `{ maxDiffPixels: 8, threshold: 0.01 }`: your `tolerance.ts` is kept and keeps working, and the new one is in `tools/templates/visual.packages__client-react__tests__visual__tolerance.ts.txt` to copy from. A scenario may set `strict`, `maxDiffPixels` or `pixelThreshold` only with a `pnpm visual:jitter --scenario <name>` measurement and its cause written beside it.
    - `pnpm visual:check:styles` joins `gate:fast`: it fails when `packages/client-react/src/main.tsx` imports a stylesheet or font other than `index.css`. Move such an import into `index.css`, the one file the visual host loads.
    - `pnpm visual:coverage` lists the UI no scenario renders. It adds `vitest`, `@vitest/browser-playwright` and `@vitest/coverage-v8` to `packages/client-react`, which must be on one version: if it says they differ, run `pnpm -r update --no-save vitest @vitest/browser-playwright @vitest/coverage-v8`.
```

Then "Still to do by hand" (the kept copy of `visual.pw.ts`, and to move the
edit into `scenarios.ts`), and "Yours to change" for the three project files:

- `scenarios.ts`: "yours has changes of its own, so it was left as it is. Make
  this change in it by hand", with the template's diff.
- `seeding.ts`: "yours is still the old template, word for word. Take the new
  one", with a `cp`.
- `tolerance.ts`: the same, with a `cp`.

What `git status` showed:

```
 M AGENTS.md
 M package.json
 M packages/client-react/package.json
 M packages/client-react/tests/visual/host/ScenarioFrame.tsx
 M packages/client-react/tests/visual/host/address.ts
 D packages/client-react/tests/visual/host/host.css
 M packages/client-react/tests/visual/host/main.tsx
 M packages/client-react/tests/visual/host/seeded.ts
 M packages/client-react/tests/visual/playwright.config.ts
 M packages/client-react/tests/visual/visual.pw.ts
 M tools/installed.json
 M tools/templates/visual.packages__client-react__tests__visual__scenarios.ts.txt
 M tools/templates/visual.packages__client-react__tests__visual__seeding.ts.txt
 M tools/templates/visual.packages__client-react__tests__visual__tolerance.ts.txt
 M tools/visual/jitter.mts
 M tools/visual/lib/arguments.mts
 M tools/visual/lib/measure.mts
 M tools/visual/summary.mts
?? packages/client-react/tests/visual/framing.ts
?? packages/client-react/tests/visual/host/fonts.ts
?? packages/client-react/tests/visual/host/picture.ts
?? packages/client-react/tests/visual/host/render.tsx
?? packages/client-react/tests/visual/reach/reach.browser.tsx
?? packages/client-react/tests/visual/reach/vite.config.ts
?? tools/templates/visual.packages__client-react__tests__visual__framing.ts.txt
?? tools/templates/visual.packages__client-react__tests__visual__registry.tsx.txt
?? tools/templates/visual.replaced.packages__client-react__tests__visual__visual.pw.ts.txt
?? tools/visual/check-styles.mts
?? tools/visual/coverage.mts
?? tools/visual/lib/reach.mts
?? tools/visual/lib/vitestVersions.mts
```

Checked against it:

- No example written: no new PNG, no `tests/visual/registry.tsx`. The
  registry's template is in `tools/templates/`, as the notes say.
- `framing.ts` written, with `rootWidth: 480`, `rootPadding: 8`,
  `viewport: { width: 1920, height: 1080 }`.
- `scenarios.ts`, `seeding.ts` and `tolerance.ts` have the same SHA-256 before
  and after.
- The kept copy of `visual.pw.ts` has the SHA-256 of the project's edited file.
- The new `playwright.config.ts` carries
  `launchOptions: { args: ["--disable-partial-raster"] }`, the viewport from
  `FRAMING`, and one worker when `CI` is set.
- `tools/installed.json` records `releasesSeen: ["0.19.0"]`.

## Moving the edit, and the redraw

`pnpm install`: 25 packages added, and a warning of unmet peers:
`vitest 5.0.3` beside `@vitest/browser-playwright` and `@vitest/coverage-v8`
at 5.0.5.

`pnpm visual`: 4 failed, 1 passed (the orphan check). Each scenario is now a
page, captured as the viewport:

```
empty             Expected an image 184px by 144px, received 1280px by 1080px.
rows-up-and-down  Expected an image 236px by 236px, received 1280px by 1080px.
row-selected      Expected an image 236px by 236px, received 1280px by 1080px.
row-stale         Expected an image 236px by 236px, received 1280px by 1080px.
```

The width came through from the scenario's own `width: 1280`; the height is
the new default. The old pictures were drawn in a window 720 tall, so, as the
second note says, each scenario got `height: 720`. In `scenarios.ts`:

- `import type { Picture } from "./host/picture.ts";` and
  `export interface Scenario extends Picture`, so `height` is a field the type
  knows. The project's `width: number` stays, as a required field.
- `height: 720` on each of the four scenarios.

The kept copy of `visual.pw.ts` held nothing else, so it was deleted.
`seeding.ts` and `tolerance.ts` were left as they are (see Concerns).

`pnpm visual:update`: 5 passed. Every image is 1280x720. Each was opened:

| Image | What it shows |
|---|---|
| `empty.png` | The heading "Prices" and the table's header row, Symbol and Mid, on white |
| `rows-up-and-down.png` | EURUSD 1.1012 in green, GBPUSD 1.2488 in red, USDJPY 151.2000 in black |
| `row-selected.png` | The same three rows, GBPUSD on a grey band |
| `row-stale.png` | EURUSD and GBPUSD in their colours, USDJPY faded |

Each is the whole app in the viewport: the heading sits 8 pixels from the top
and left, which is the browser's own body margin (the app's `index.css` sets
none), with no host frame or padding around it. Below the table the window is
empty, as the app is.

`pnpm visual`: 5 passed.

## The other checks

`pnpm visual:coverage`, first run, exit 2:

```
visual:coverage: Vitest's packages are on different versions in packages/client-react: vitest 5.0.3, @vitest/browser-playwright 5.0.5, @vitest/coverage-v8 5.0.5. Vitest does not support a mix. Put them on one version with:
  pnpm -r update --no-save vitest @vitest/browser-playwright @vitest/coverage-v8
```

That command moved `vitest` to 5.0.5 (lockfile only). Then:

```
Not rendered by any visual scenario (reports in packages/client-react/tests/visual/reports/coverage/):

  statements not rendered   statements %   file
                        1          87.5%   packages/client-react/src/ui/PriceList.tsx
      functions never called: selectRow

1 UI file(s) with code no scenario renders. Those are states no scenario shows yet.
```

`pnpm gate:full`: pass. Every gate PASS, then

```
PASS web-server: 1 server command(s) in 1 Playwright config(s), none through pnpm.
PASS lint:types — 79 file(s) linted with type information
PASS lint:dead — knip found nothing unused (79 TypeScript file(s) in the project)
PASS visual-styles: main.tsx loads no stylesheet or font besides index.css.
```

then 57 tests in 7 packages and the build. Before the update the same gate
linted 73 files. Knip found nothing unused in what the update added,
`reach/vite.config.ts` included, with the project's `tools/strict-lint/knip.jsonc` untouched.

The update, the moved edit and the redrawn goldens were committed in the
project.

## A second update

```
node scripts/add-to-project.mts <project> visual
```

```
visual: 0 file(s) written, 34 already up to date, 0 removed

Next:
  cd <project>
  pnpm install
  pnpm visual
  pnpm gate:full
```

No release notes, no "Yours to change", and `git status` clean.

## Concerns

- "Yours to change" gives a bare `cp` for `seeding.ts`. The new template
  imports `./registry.tsx`, which an updated project does not have. Taken on
  its own, the `cp` breaks `pnpm visual:check`:
  `tests/visual/seeding.ts(11,23): error TS2307: Cannot find module './registry.tsx'`.
  The release notes say to copy the registry with it, and the skill says to
  run a `cp` only when the user agrees, so this run left `seeding.ts` alone
  (and undid the `cp` after trying it).
- `tools/installed.json` now lists the example goldens and `registry.tsx`
  under `starting`, though neither was written. The second update wrote
  nothing, so the record does not bring them in later.
- The `linux-x64` goldens are still the 0.18.1 pictures. On a Linux runner
  they fail until the `Update visual goldens` workflow draws them, as the third
  note says. That is not run here.

## skills-demo (Task 14)

skills-demo is a real project made from these skills, at 0.17.0 for the
visual add-on, with its own UI: a price list and a directory of categories
and users. The update was taken on a branch, `update-visual-0.19.0`, from this
branch at `d9a0549`, the way `extending-a-project` says. Run on the same Mac
as above.

### The update

`git status` clean, then
`node scripts/add-to-project.mts ../skills-demo visual`: exit 0, no refusal.
skills-demo never edited an add-on file, so no `--force`. The summary was the
same 24 written, 10 up to date, 1 removed (`host.css`), `framing.ts` created,
the four devDependencies and two scripts, `visual:check:styles` in
`gate:fast`. The twelve release notes printed once, as above. "Yours to
change": `scenarios.ts` and `seeding.ts` have changes of their own (diffs
shown), `tolerance.ts` is the old template word for word (a `cp`).
`pnpm install`: the same unmet peer, `vitest` 5.0.3 beside
`@vitest/browser-playwright` 5.0.5.

Before any scenario was touched, `pnpm visual` failed 7 of 7 (an 800-wide
frame against a 1920x1080 page), as the first note says, and `lint:dead`
failed:

```
Unused exported types (1)
Picture  interface  packages/client-react/tests/visual/host/picture.ts:13:18
```

Nothing in the add-on imports `Picture`; only the template's `scenarios.ts`
does. It passed once `Scenario extends Picture` (the "Yours to change" diff).

### The demo's own scenarios

Three changes to the demo's UI came first, each its own commit: the price row
as its own component (`PriceRow.tsx`, as in the starter); a dialog of a
category's members, opened from each category row; and its two selects
(`Show`, and the user form's `Category`) drawn as ordinary text over a native
select, as the sixth note says to do. Then `registry.tsx` from the template
with eight entries (the directory's parts wrapped in `.directory`, the
element the app puts around them and its styles read), `seeding.ts` with the
template's `render` taken by hand and three more pieces of state, and
`Scenario extends Picture`. `tolerance.ts` was kept: zero, the old shape. The
seven old goldens (darwin-arm64 and linux-x64) were deleted.

24 scenarios. The summary: `Pictures: 14 components, 8 sections, 2 pages`.

- Components: `price-row-{up,down,flat,selected,stale}`, `price-list-empty`,
  `refusal-message`, `user-fields-{blank,email-refused,category-refused}`,
  `directory-{loading,unavailable}`, `members-dialog-{long,empty}`.
- Sections: `price-list-moving`, `category-list-{listed,delete-refused,renaming}`,
  `user-list-{listed,editing,email-refused}` (width 960), `directory-listed`
  (width 1280).
- Pages: `app` (1920x1080), `app-narrow` (390x844).

The hard case of spec §6 is `members-dialog-long`: the dialog mounted alone,
`capture: "viewport"`, 800x600. Measured in the host: the card at x 247.5,
y 168.5, 305x263, `border-radius` 12px, in a `position: fixed` layer; its list
386 pixels tall in 160, `overflow-y: auto`.

`pnpm visual:update`: 25 passed. Each image was opened. Root pictures are 496
wide (480 plus 8 on each side), 976 and 1296 for the wider sections; the
pages and dialogs are their viewport. The font is the system face the app
asks for (`system-ui`), the up and down colours green and red, the selected
row on a grey band, the stale row faded, refused fields outlined in red. The
pages have only the app's own 8-pixel body margin. The first drawing showed
the selects with no box: their border mixed `currentcolor`, which is the
select's transparent text. Fixed in the demo's CSS, then redrawn.

### The checks

- `pnpm visual`: 25 passed, and 25 passed with `CI=1` (one worker).
- `pnpm visual:jitter --runs 5`: 24 images, identical in every capture; noise
  floor 0 pixels, judged against the kept zero tolerance.
- `pnpm visual:coverage`: first exit 2, Vitest 5.0.3 beside 5.0.5, as the last
  note says. The command it names moved `vitest` and `@vitest/coverage-v8` to
  5.0.5 in the lockfile. Then it listed five UI files, almost all event
  handlers a picture never calls, and one state: the members dialog opened
  inside the category list (the dialog itself is pictured alone).
- `pnpm gate:full`: pass. `lint:types` 130 files, `lint:dead` nothing unused in
  131 files, `visual-styles` pass, tests, build, and coverage at or above the
  bar in every package.
- A second update: 0 written, 34 up to date, no notes, `git status` clean.

`tools/installed.json` lists the starter's example goldens under `starting`
here too, eight of them under names the demo's own goldens now have
(`app.png`, the five `price-row-*.png`, `price-list-empty.png`,
`price-list-moving.png`). Nothing was written over them.

### On GitHub (Step 4)

First the update was taken again from this branch at `255b5a7`, which fixed
a `lint:dead` finding in the host: 2 files written (`host/picture.ts`,
`host/render.tsx`), 32 up to date, 0 removed, no refusal, no `--force`.
`tolerance.ts` was then copied from its template
(`{ maxDiffPixels: 8, threshold: 0.01 }`). Locally `pnpm visual` passed 25
and `pnpm gate:full` passed. Three more commits on the branch: `e21e147` (the
update), `496b3a6` (the tolerance), `ade6fa2` (the Linux set).

The branch was pushed and opened as
[skills-demo #15](https://github.com/bettersoftware-io/skills-demo/pull/15).
Nothing was merged; `main` stayed at `4a3d9b2`.

- `Visual goldens` on `496b3a6` (run 39052171301): failed 24 of 24 with
  `No golden for the scenario … on linux-x64`, as designed.
- `Update visual goldens`, five times on `496b3a6`: runs 39052176196,
  39052178245, 39052180287, 39052182342, 39052184299. All passed, 24 images
  each.
- By checksum each image is one file across the five sets: the digest of
  each set's hash list is the same (`14036df6e85cb6c0…`).
- `pnpm visual:jitter` over the five sets: 5 captures, 24 images, every
  image identical in every capture; noise floor 0 pixels (set: 8) and 0 for
  the threshold (set: 0.01).
- The set from run 39052176196 was brought in with the job summary's
  `gh run download` command and committed as `ade6fa2`.
- On `ade6fa2` every check of the pull request passed, `Visual goldens`
  among them (run 39052410250); only the Pages publish was skipped, as on
  any pull request.

The Linux pictures show what the Mac ones show: the same rows and colours,
the grey selected band, the dialog's scrim and card, the refused select's red
outline. The font is a real sans face with no missing glyph. Two
differences: line heights differ, so the members list shows 5 names on Linux
and 5 and a half on darwin; and **no text is bold on Linux** (headings,
table headers, category names), while it is bold on darwin. The 0.17.0 Linux
goldens on skills-demo's `main` show the same, so it is how the pinned
container draws `system-ui`, not a change of 0.19.0.

## linux-x64: the shipped set (Task 15)

The nine examples' `linux-x64` goldens can be drawn only in the pinned
container on GitHub's runners, and skills-demo does not receive the
examples. So they were drawn in a temporary public repository,
`bettersoftware-io/skills-visual-proof`, made as skills-demo was on
2026-10-05.

### Setup

- From this branch at `255b5a7`:

  ```
  node scripts/create-project.mts <scratch>/proof --scope @demo --with agent-workflow,ci-security,coverage,e2e,format-lint,performance,repo-hygiene,strict-lint,visual
  ```

  Every add-on in `addons/`; `ci-security` took its default option,
  `renovate`. Nothing edited by hand. `git init`, `pnpm install`, `pnpm fix`
  (the step the scripts print; it changed nothing), then `pnpm gate:full`:
  pass, with every add-on's gates, `lint:dead` included (89 files), and
  coverage at the bar in every package. `pnpm visual` passed 10.
- Committed as `14ac8c8` and pushed to the new repository with
  `gh repo create --public --source … --push`. No secret was added.

### The runs

- On the push, `CI`, `Coverage`, `CI security`, `End-to-end`,
  `Motion audit` and `Scorecard` passed. `Visual goldens` (run 39052663638)
  failed 9 of 9 with `No golden for the scenario "price-row-up" on linux-x64`
  and the path it expected, as designed.
- `Update visual goldens`, five times on `14ac8c8`: runs 39052667803,
  39052669864, 39052672257, 39052674084, 39052675974. All passed, in 52 s to
  1 min 2 s, 9 images each.
- By checksum each image is one file across the five sets, and the digest of
  each set's hash list is the same (`68d5eff25dc1db15…`).
- `node tools/visual/jitter.mts <five dirs>` in the project: 5 captures, 9
  images, every one identical in every capture. Noise floor 0 pixels (set: 8)
  and 0 for the threshold (set: 0.01).
- The set from run 39052667803 was copied into the add-on's
  `goldens/linux-x64/` and into the project's, committed there as `fad8f6e`
  and pushed. `Visual goldens` on `fad8f6e` (run 39053045487): 10 passed.

The sizes differ from darwin: a row is 496x50 on Linux and 496x47 on darwin,
the moving and selected lists 496x152 and 496x140; `app.png` is 1920x1080 on
both. The content is the same: header, the three rows, up green, down red,
flat black, the selected row on a grey band, the stale row faded. The font is
a real sans face with no missing glyph. As in skills-demo, **nothing is bold
on Linux**: the "Prices" heading, the column headers and the symbols, all
bold on darwin, are drawn at the regular weight.

### In the browser, on darwin-arm64 (spec §5)

In the same project, on the Mac, with the shipped tolerance
(`maxDiffPixels: 8`, `threshold: 0.01`). Each change was made in
`packages/client-react/src/index.css`, run with `pnpm visual`, and undone.
The counts are Playwright's.

The "up" colour, `--color-up: #1a8f4c` to `#1a4c8f`: 4 failed, 6 passed.

| Scenario | Pixels different |
|---|---|
| `price-row-up` | 95 |
| `price-list-moving` | 84 |
| `price-list-selected` | 84 |
| `app` | 84 |

The other five show no up price, and passed.

A one-pixel shift, `td { padding-left: calc(1rem + 1px); }` (each row cell's
text one pixel to the right): 8 failed, 2 passed.

| Scenario | Pixels different |
|---|---|
| `price-row-up` | 139 |
| `price-row-down` | 174 |
| `price-row-flat` | 237 |
| `price-row-selected` | 205 |
| `price-row-stale` | 233 |
| `price-list-moving` | 544 |
| `price-list-selected` | 574 |
| `app` | 544 |

`price-list-empty` has no row cell, and passed; so did the orphan check.
Every regression was caught, the smallest at 84 pixels, ten times the
budget.

Not measured on linux-x64: that needs a commit carrying each change pushed
and compared on GitHub, and it was not done.

Also on the Mac: `pnpm visual:jitter --runs 5` over the nine scenarios, and
`pnpm visual:jitter --runs 5 --scenario price-row-up`: every image identical
in every capture, noise floor 0 for both knobs.

The repository is to be deleted once this is committed; that is asked of the
user first.
