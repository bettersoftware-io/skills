# Add-on: visual goldens

Adds a screenshot tier to a project created from the starter. Each scenario
renders the real UI in a fixed state, takes a picture, and compares it with a
committed image (a golden). A difference fails. A scenario pictures one
component, a section of the screen, or the whole app.

```bash
node scripts/add-to-project.mts <project> visual
cd <project> && pnpm install && pnpm visual
```

## What it adds

| Part | Where | What it does |
|---|---|---|
| Scenario list | `packages/client-react/tests/visual/scenarios.ts` | A name, what is pictured and the seeded state, as typed data. Nine to start: the row in five states and the empty list (components), the list moving and with a row selected (sections), and `app` (the page) |
| Registry | `tests/visual/registry.tsx` | What a scenario's `mount` names: `price-row` and `price-list` to start, each wrapped in `Surround`, the app's theme root. The project's file, written at first install only, like the goldens |
| Seeding | `tests/visual/seeding.ts` | How a scenario's data becomes app state: `seedScenario(scenario, clock)` builds the app harness and returns the application, the deliveries and, for a scenario with a `mount`, what to render. The project's file, like the scenario list |
| Framing | `tests/visual/framing.ts` | The sizes a scenario falls back on: root width 480, root padding 8, viewport 1920x1080. The project's file |
| Tolerance | `tests/visual/tolerance.ts` | The global tolerance, with what was measured. The project's file |
| Visual host | `tests/visual/host/` | A second Vite root. It renders what the seeding returns (or `App` from `src/ui`) with the app's own `index.css`, after every declared font face has loaded. It imports both through the client's `#/` alias, so the client's `package.json` must declare `"imports": { "#/*": "./src/*" }`, as the starter's does. It knows no field of a project's own state; time is a clock the page owns |
| Spec | `tests/visual/visual.pw.ts` | One Playwright test per scenario, plus one that fails on a golden no scenario owns |
| Goldens | `tests/visual/goldens/<platform>/` | One PNG per scenario, per system (`darwin-arm64`, `linux-x64`). The nine examples ship for `darwin-arm64` only; the `linux-x64` set is drawn by the update workflow (see [Limits](#limits)) |
| `pnpm visual` | root script | Compare. Never writes a golden |
| `pnpm visual:update` | root script | Redraw this system's goldens |
| `pnpm visual:jitter` | `tools/visual/jitter.mts` | Capture the same commit N times and report the largest difference: the noise floor. `--scenario <name>` measures one |
| `pnpm visual:coverage` | `tools/visual/coverage.mts` | Renders every scenario with coverage on and lists the UI files, branches and functions no scenario renders. A report, not a gate |
| `pnpm visual:check` | typecheck of `tests/visual/` | Joins `gate:fast` |
| `pnpm visual:check:server` | `tools/visual/check-server.mts` | Fails a Playwright config that starts its server through pnpm. Joins `gate:fast` |
| `pnpm visual:check:styles` | `tools/visual/check-styles.mts` | Fails when `main.tsx` imports a stylesheet or font other than `index.css`; the host loads only that one. Joins `gate:fast` |
| CI | `.github/workflows/visual.yml`, `update-visual-goldens.yml` | Compare on pull requests and on main; redraw the Linux set by hand |
| Job summary | `tools/visual/summary.mts` | Names the scenarios that failed and what to do, and counts the pictures at each level |

Dev dependencies added to `packages/client-react`: `@playwright/test` and
`playwright` (exactly `1.63.0`), `@sinonjs/fake-timers` (the host's clock),
`@types/node`, and for `visual:coverage` `vitest`,
`@vitest/browser-playwright` and `@vitest/coverage-v8`.

## The pyramid

Start with the small components: every state that matters, one scenario each,
at a fixed width. Then a reasonable number of sections, chosen for how parts
fit together and not to cover combinations: the combinations of the parts'
states grow multiplicatively, and each part's states are already pictured
below. Then a few pages, the whole app at the sizes that matter. Run
`pnpm visual:coverage` to find states nothing shows yet.

The shape to avoid is a set of only whole-app pictures. A change to one row
then fails every picture, each failure shows a whole screen, and the states of
the row that no page happens to show are never pictured.

No gate counts pictures per level; the word is "reasonable". The job summary
prints the count on every run (`Pictures: 6 components, 2 sections, 1 page`
for the starter), so the shape is visible.

### Where a new picture belongs

- A new state of one component: a component scenario.
- A section only when the way parts sit together is what could break.
- A page only for a new screen or a new layout size.

## What a scenario says

The add-on reads these fields of a scenario (the type `Picture`, in
`host/picture.ts`). They sit beside the project's own state fields, and each
is optional:

| Field | Meaning | Default |
|---|---|---|
| `level` | `"component"`, `"section"` or `"page"` | `"page"` |
| `mount` | The registry key of what is rendered | the whole `App` |
| `capture` | `"root"` (the scenario root, content height) or `"viewport"` | `"root"` for a component or section, `"viewport"` for a page |
| `width` | Root width, or viewport width for a viewport capture | from `framing.ts` |
| `height` | Viewport height for a viewport capture | from `framing.ts` |
| `strict` | Zero pixels, zero threshold | off |
| `maxDiffPixels` | A larger cap for this scenario | the global |
| `pixelThreshold` | A lower per-pixel threshold for this scenario | the global |

A scenario with none of them is a page: the whole `App` in a 1920x1080
viewport, pictured as the viewport. A contradiction fails that scenario alone,
with its name and the field: `height` on a root capture; `strict` with
`maxDiffPixels` or `pixelThreshold`, or `strict` set to anything but `true`; a
`maxDiffPixels` not above the global; a `pixelThreshold` not below the global;
a `level` or `capture` that is not one of its words; an empty `mount`; a
`width` or `height` that is not a whole number above 0; a `maxDiffPixels` or
`pixelThreshold` that is not a number of 0 or more; a `mount` while the seeding
returns no `render`.

`level` decides the default capture and is counted in the summary. Otherwise it
is a word for people and agents to reason with.

### What is captured

- **Root capture** (components and sections). The host renders the element in
  a `data-testid="scenario-root"` element: a fixed width, the content's height,
  and a small padding so a shadow or a focus ring outside the component's box
  is in the picture. The spec pictures that element. The width is fixed
  because a box sized by its content takes its width from the glyphs: in RTC,
  such widths moved by 46 to 66 pixels between runs on x86, and Playwright
  cannot compare images of two sizes.
- **Viewport capture** (pages and overlays). The spec sets the viewport to the
  scenario's width and height before the page loads, the host renders the
  element straight into `#root` with no frame, padding or margin, and the spec
  pictures the viewport, never the whole scrolling page. The picture is the
  app as a person sees it at that size.

### A dialog, as a component

Mount the dialog alone, with no app behind it, with `capture: "viewport"` and
a `width` and `height` the size of the picture wanted. Its `position: fixed`
layer, its scrim and any `vh` sizes are then drawn against the viewport, which
is the picture: nothing is offset, and nothing of the app shows outside the
scrim. A root capture would picture a box the dialog is not drawn in, and
`vh` would still read the real viewport. A dialog over the app stays a page
scenario, used sparingly.

### `framing.ts`

The sizes a scenario falls back on are the project's, in
`tests/visual/framing.ts`: `rootWidth: 480`, `rootPadding: 8` and
`viewport: { width: 1920, height: 1080 }`. These are where a project starts,
not rules. A project with wide grids or deep shadows changes its own file,
never an add-on file. A root picture is the root width plus the padding on each
side: 496 pixels wide with the shipped values.

## The traps, closed by default

RTC, the project this tier comes from, drew pictures that were not the app.
Each trap it met, and what this add-on does about it:

| Trap | What the add-on does |
|---|---|
| The app's fonts were imported in `main.tsx`, which the harness never loads, and RTC drew 1,046 goldens in a fallback font | The host loads the app's real `index.css`. `pnpm visual:check:styles` fails when `src/main.tsx` imports a stylesheet or font other than `index.css`: move such an import into `index.css`, the one file the app and the host both load |
| `document.fonts.ready` resolved before any face was used, so real glyphs swapped in after the picture (a header measured 1139, then 1180 pixels) | Before the first render the host loads every face the page's stylesheets declare, then waits for `ready`. There is no list to keep in step with the app. A face that fails to load fails the scenario, naming the face |
| A hand-copied reset in place of the global stylesheet lost `color-scheme`, scrollbar colours and the motion freeze, and dark pages came out white | The host imports `#/index.css`, the real file, and nothing else |
| Components pictured alone had no colours: the theme provider sits at the app's root | The registry's `Surround` holds the app's theme root (its providers and the attributes its styles read, without its layout), and every mounted scenario is wrapped in it. The starter's passes its children through, since its theme is `index.css` alone |
| Content widths drifted with glyph advances | Root captures have a fixed width |
| Two browser stacks on one 2-core runner made the stable-frame check capture early | The tier runs with one worker when `CI` is set |
| Chromium redraws only the changed part of a tile (partial raster), so one rounded corner was shaded two ways from frame to frame (condo-ledger, linux-x64) | Chromium starts with `--disable-partial-raster`. See [How the frame is pinned](#how-the-frame-is-pinned) |
| A native `<select>`'s own text drew two ways across linux-x64 runs (condo-ledger), while the same text in a plain element matched every run | No check can see it. Draw the shown value as ordinary text over the control, or keep the control out of goldens |

## Which gate it joins

The comparison joins neither gate. It needs a browser and goldens drawn on the
system that runs it, and the contract keeps such checks out of `gate:fast` and
`gate:full`. It runs as `pnpm visual` and in its own workflow.

`pnpm visual:check` joins `gate:fast`. It takes about a second and needs only
`pnpm install`. It typechecks `tests/visual/`: the package's own
`tsconfig.json` covers `src` only, and an add-on may not edit it.

The Playwright version is held by the kit's `playwright-pin` gate, which runs
with the other gates in `gate:fast`. It fails when the `@playwright/test`
version is a range, when two packages name two versions, and when a workflow's
image tag is another version: CI would draw with another browser build. The
check was this add-on's own (`tools/visual/check-pin.mts`) until the `e2e`
add-on needed the same one; a project that has both has one check. The add-on
is refused by a project whose kit does not have the gate yet.

`pnpm visual:check:server` joins `gate:fast` too. It reads every
`playwright*.config.ts` in the project and fails one whose
`webServer.command` starts with pnpm (`pnpm exec vite …`, `pnpm run dev`,
`pnpm --filter …`, also behind `corepack`, a path, `NAME=value` or `&&`).

Playwright stops the process it started. Through pnpm that process is the
wrapper, and since pnpm 12.6 the server it started lives on with no parent:
every test passes, and the run never ends. Measured here on 2026-10-06, pnpm
12.6.0, in a project with every add-on: with `pnpm exec vite` as the command
the five tests passed in three seconds and the run was still there 45
seconds later, with vite's parent process 1; it finished the moment that
vite was stopped by hand. In CI such a run holds the job until its time
limit. The config this add-on ships already starts
`node_modules/.bin/vite` from the package's folder, and the check keeps it
that way: the two root scripts `visual` and `visual:update` still go through
`pnpm exec playwright`, which is not a server and ends by itself.

It is a script of its own, and not part of `visual:check`, because an add-on
may not change a script a project already has. It says `SKIP` when no config
starts a server, and exits 2 when a command is not a string it can read.

`pnpm visual:check:styles` joins `gate:fast` as well. It reads
`packages/client-react/src/main.tsx` and fails on an import of any stylesheet
or font other than `index.css`. It needs no browser.

## Who owns what

A feature adds scenarios, and a scenario may need state the starter's do not
have. Until 2026-10-06 that meant editing `host/main.tsx`, which is the
add-on's file: the demo project added sixty lines there, and every update of
the add-on after that refused, needed `--force`, and the lines were put back
by hand.

| File | Whose | Holds |
|---|---|---|
| `scenarios.ts` | the project's | `Scenario` and the list |
| `seeding.ts` | the project's | `seedScenario(scenario, clock)`: the harness, the application as it starts, what is delivered once the UI is on screen, and what to render |
| `registry.tsx` | the project's | What each `mount` renders, and `Surround`, the theme root |
| `framing.ts` | the project's | The default root width, root padding and viewport |
| `tolerance.ts` | the project's | The global tolerance |
| `host/`, `visual.pw.ts`, `playwright.config.ts`, `goldens.ts`, `tools/visual/` | the add-on's | The clock, the render, when `deliver` is called, the ready signal, the capture, the comparison |

The host calls `seedScenario` once, after its clock is installed, renders what
it returns (`render`, or the whole `App` when there is none) on `app`, and
calls `deliver` from the frame's effect, when the UI below has subscribed. So
how state is delivered and when the picture is taken stay in the add-on, and
what the state is stays in the project. A scenario with a `mount` while the
seeding returns no `render` (a seeding written before the registry) fails with
a message that names the seeding's template in `tools/templates/`.

The registry and the goldens are examples: written at first install, never by
an update. A project that had the add-on before them gets neither; its
template copy, `tools/templates/visual.packages__client-react__tests__visual__registry.tsx.txt`,
is there to start from.

**A project that edited the host** is told where the lines go. A plain update
refuses, as for any edited file, and says under the file's name that its
edits now go in `seeding.ts` and what `--force` will do. With `--force` the
host is replaced, the project's version is kept as
`tools/templates/visual.replaced.packages__client-react__tests__visual__host__main.tsx.txt`,
and `seeding.ts` is written as shipped. The person moves their lines from the
copy into `seeding.ts`, deletes the copy, and runs `pnpm visual`. While the
copy is there, every update says so. The manifest field is `movedToProject`
([the contract](../README.md)). An edited `visual.pw.ts` is handed to
`scenarios.ts` the same way: a width or height a scenario needs now goes on
the scenario.

The host names the project's scope in one import, and a formatter wraps
that line under a longer scope. The update compares the add-on's files byte
for byte, so a wrapped line read as an edit and the next update refused a
file nobody had touched. The line carries a `biome-ignore format` comment,
and `scripts/scope-stable-files.test.mts` holds that every file an add-on
owns comes out of the formatter as it went in, under three scopes.

Tried on a copy of the demo (2026-10-06): the three wrappers it had added to
the host moved to `seeding.ts` unchanged, `pnpm visual` passed 8 of 8 against
its committed `darwin-arm64` goldens with both knobs at 0, and a second update
wrote nothing.

## How the frame is pinned

- **State comes from the harness.** The seeding delivers prices through
  `createAppHarness().deliverPrice`, and seeds a selection through the
  selection machine's own intent. A component scenario passes its props from
  the scenario. Nothing is clicked.
- **Time does not run.** The host replaces `setTimeout`, `setInterval` and
  `Date` with a clock it owns. The stale row is made by moving that clock past
  `STALE_AFTER_MS` between deliveries. No timer fires by itself, so a slow
  machine takes the same picture.
- **One ready signal.** The host sets `data-visual-ready="true"` on `<html>`
  once every font face has loaded and the seeded state has rendered. The spec
  waits for that and nothing else.
- **No partial raster.** Chromium starts with `--disable-partial-raster`.
  Measured in condo-ledger on 2026-10-16, linux-x64 in the pinned container:
  seven flag sets as Playwright projects, each scenario drawn twice per run,
  eight runs on separate runners. With no flag a scrolling list in a dialog
  never held still; threaded scrolling, compositor stages and `--disable-gpu`
  did not help. With this flag every frame held still and ten of eleven
  scenarios were byte-identical across all eight runs. `--disable-lcd-text`
  added nothing and redrew every piece of text. Font hinting is left alone.
- **One worker in CI.** Locally Playwright picks.
- **Animations are off** (`animations: "disabled"`, reduced motion), and the
  colour scheme, locale, time zone and scale are fixed in the config.
- **No network.** The spec fails if the page asks for anything outside the
  host's own server, or throws.
- **No reused server.** `reuseExistingServer` is `false`, so a stale server on
  the port is an error, not a silent source of old pixels. Hot reload is off.

### Finding the next cause of noise

When a scenario does not hold still and no tolerance should hide it, find the
cause the way the partial-raster flag was found:

1. Add each candidate Chromium flag set as a Playwright project in a copy of
   the config, with `snapshotPathTemplate` including `{projectName}`, so each
   writes its own images.
2. Draw every scenario twice in each run.
3. Run it several times in parallel, on separate runners (the update workflow
   on a branch).
4. Download the artifacts and compare the images by hash, or with
   `pnpm visual:jitter <dirA> <dirB> ...`.

The flag set whose images agree across every run is the fix. It goes in the
add-on's config with the measurement in its comment, never as a larger
tolerance.

## The tolerance

Set in `tolerance.ts`, the project's file: `maxDiffPixels: 8`,
`threshold: 0.01`. A small insurance budget, not zero, and not large enough to
hide a real change.

Two knobs, applied in order. `threshold` is how far one pixel's colour may
move before it counts as different. `maxDiffPixels` is how many pixels may
count before the test fails. There is no ratio: a ratio is blind on a large
capture. Playwright's default `threshold` is 0.2; with it, the starter's "up"
colour changed from green `#1a8f4c` to blue `#1a4c8f` counts 0 pixels, and the
tier would pass with a zero pixel budget. At 0.01 a move of 1 or 2 levels on
each channel is hidden and 3 or more counts.

The budget is held by reference regressions in `tests/budget.test.mts`, without
a browser. Each is an image pair built at 480x48 beside a row of text-like
strokes, and compared the way Playwright compares (pixelmatch: colour distance
against the threshold, anti-aliased pixels left out). Every one must fail
under the shipped values:

| Regression | Pixels changed | Counted |
|---|---|---|
| Up colour `#1a8f4c` to `#1a4c8f`, hard strokes | 83 | 83 |
| The same change on two smoothed rings, 14 px across | 280 | 160 |
| A 1x120 line of `#d9d9d9` on white removed | 120 | 120 |
| A 4x4 hard-edged icon removed | 16 | 16 |
| A 6x6 smoothed round icon removed | 32 | 16 |
| A 60x20 box with a 1 px `#888` border moved right by one | 76 | 76 |
| 40 pixels moved by 2 levels on each channel (noise, must pass) | 40 | 0 |

The rule the tests hold: twice the budget is at most the smallest regression
counted. 2 × 8 = 16, the smallest count, with no slack. A mutant that raises
either default fails a test.

The real colour change and a real one-pixel shift, counted by Playwright in
the starter, are **not measured yet** on the new scenarios.
<!-- Pending: the browser measurement (darwin-arm64 and linux-x64) replaces this line. -->

The noise floor was 0 before this change: one commit captured 5 times, four
whole-app scenarios, every image byte-identical on darwin-arm64 (one Mac,
Chromium build 1243 headless, 2026-10-04) and on linux-x64 (five runs of the
update workflow on GitHub's runners, in the pinned container, 2026-10-05). On
the nine scenarios of this version, two drawings on darwin-arm64 were
byte-identical.

### A scenario's own tolerance

A scenario may set `strict` (zero pixels, zero threshold), a larger
`maxDiffPixels` or a lower `pixelThreshold`. Each needs a
`pnpm visual:jitter --scenario <name>` measurement of that scenario and the
mechanism understood, both written in a comment at the scenario. Looser than
the global only for a measured, understood difference. Tighter whenever the
global could hide a change that matters there: a mark smaller than about 6x6
with smoothed edges, such as a grip or a status dot, can count 8 pixels or
fewer.

`pnpm visual:jitter` judges each image by the tolerance its own scenario
resolves to. It is written with Node built-ins only, PNG reading included, so
it needs nothing installed. Its count was checked against Playwright's own on
a real failure: both said 83.

## Visual reach: `pnpm visual:coverage`

Renders every scenario in Vitest's browser mode (Chromium through the pinned
Playwright), through the host's own render path, with no picture taken, and
collects v8 coverage of `src/ui/**/*.tsx`. It prints the UI files with
statements no scenario renders, the most first, and under each the lines of
branches never taken and the functions never called: states no picture shows
yet. `--limit <n>` shortens the list (30 by default). The reports (json,
summary, html) are in `packages/client-react/tests/visual/reports/coverage/`.

It is a report. It exits 2 when a scenario cannot be rendered, when Vitest is
not installed in `packages/client-react`, or when `vitest`,
`@vitest/browser-playwright` and `@vitest/coverage-v8` are on different
versions, which Vitest does not support; it then names the command that puts
them on one: `pnpm -r update --no-save vitest @vitest/browser-playwright @vitest/coverage-v8`.

Its config is `tests/visual/reach/vite.config.ts`, named so on purpose:
`strict-lint`'s knip settings already list `tests/**/vite.config.ts`, so a
project with both needs no edit.

Where the project has the `coverage` add-on, `pnpm coverage:gaps` prints a
"Not rendered by any visual scenario" section from the last
`visual:coverage` report, with its date. It never runs the browser itself.

## The update workflow: an artifact, not a commit

The `Update visual goldens` workflow uploads the images as an artifact and
commits nothing; its job summary gives the commands.

RTC's workflow commits the new goldens to the branch it was run on, with the
workflow's token. This add-on does not:

- The job stays `contents: read`. A job that can push runs `pnpm install` and a
  dev server with that token within reach.
- A push made with the workflow's token starts no workflow. The branch would
  end on a commit that neither CI nor the visual job has checked.
- A person sees the images before they become the reference.

The cost is one `gh run download`. An auto-commit can be added later as a
second job that only downloads the artifact and pushes.

## How it was tested

On 2026-10-17, in a project created with `create-project.mts --scope @demo`,
on macOS arm64, with the add-on installed by `add-to-project.mts` and its nine
example scenarios:

| Check | Result |
|---|---|
| `pnpm visual` with the shipped `darwin-arm64` goldens | 10 of 10 pass (9 scenarios, 1 orphan check), twice; with `CI=1` (one worker), 10 of 10 |
| The nine goldens redrawn into another folder | byte-identical to the first drawing |
| `pnpm gate:full` with the kit, `visual`, `format-lint` and `strict-lint` | 12 stages pass |
| A seeding that returns no `render` | each scenario with a `mount` fails, naming the seeding's template |
| An `@font-face` whose file is missing | every scenario fails: `the font Missing normal normal did not load` |
| A `mount` that is not in the registry | that scenario alone fails, naming the key and the registry's entries |
| `pnpm visual:coverage` | exit 0; one file listed, `PriceRow.tsx`: 1 statement, `selectRow` never called |
| `vitest` on another version than the two `@vitest/` packages | exit 2, naming the command; after running it, exit 0 |
| `pnpm visual:jitter --scenario <name>` in a browser | **not run yet** <!-- pending --> |
| On GitHub, `linux-x64`: the update workflow five times on one commit, and the shipped Linux set | **not run yet** <!-- pending --> |

Before this change, on 2026-10-05, the workflows ran in
[bettersoftware-io/skills-demo](https://github.com/bettersoftware-io/skills-demo)
with the four whole-app scenarios of the time
([the record](../../docs/github-run-2026-10-05.md)): five runs of the update
workflow gave byte-identical artifacts, and `Visual goldens` failed with no
Linux set and passed with it.

`pnpm vitest run addons/visual` from this repository's root runs the add-on's
199 tests in 13 files, without a browser: the picture fields, the per-scenario
tolerance, the budget, the font loading, the level counts, the styles check,
the reach ranking, the Vitest versions, the jitter measurement and who owns
what. `tests/mutants.json` holds 107 mutants, each one shown failing a test.
The installer's side has its own: `examples` (4 mutants in
`scripts/mutants/examples.json`), `releaseNotes` (6 in
`scripts/mutants/release-notes.json`) and `movedToProject` (11 in
`scripts/mutants/moved-to-project.json`), all killed.

## Limits

- **The budget is proven on built image pairs**, not on captures of real text.
  A mark smaller than about 6x6 with smoothed edges can count 8 pixels or
  fewer and pass: a 2x2 dot is 4 pixels. A change that touches only the
  anti-aliased grey pixels of an edge is mostly left out by the comparison.
  Where such a mark matters, set `strict` or a lower `pixelThreshold` on that
  scenario.
- **The server check reads the config as text.** It finds `command:` and the
  string after it. A command built in a variable is "could not run" (exit
  2), not a pass. It judges pnpm only: the fault was measured with pnpm, and
  a project made from the starter uses nothing else. A server started
  through another wrapper (`npx`, a shell script that calls pnpm) is not
  caught.
- **A machine nobody measured may draw a pixel differently.** If it draws
  more than the budget, a test fails with nothing changed. `tolerance.ts` says
  what to do: measure, then set the number just above the floor.
- **No `linux-x64` goldens ship yet.** The set is drawn on GitHub's runners in
  the pinned container. Until it is, CI's `Visual goldens` fails on the
  missing images; the update workflow draws them.
  <!-- Pending: the Linux set and its five-run measurement replace this entry. -->
- **`linux-x64` means the container.** A Linux desktop outside it uses the same
  folder name and may draw different pixels.
- **A native control's own text is not steady** in the headless Linux
  renderer. No check finds it.
- **An unknown `mount` fails after the ready wait**, about 5 seconds, not at
  once.
- **One client package.** Paths assume `packages/client-react`.
- **The shipped `darwin-arm64` goldens** were drawn on one Mac. Another macOS
  version may draw the system font differently; then `pnpm visual:update`.

Not built:

- No theme matrix: the config fixes one colour scheme (light). A project
  expresses a mode as a field of its own scenario.
- No scenario driven by clicks or typing: state goes in as data.
- No published diff site: the HTML report is a CI artifact and a local folder.
- No run of the tier inside the container from a developer's machine.
