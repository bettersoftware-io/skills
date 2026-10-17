# The visual add-on: a pyramid of pictures, faithful and steady

Date: 2026-10-16. Status: design, for review.

## Why

The `visual` add-on pictures one thing: the whole `<App />`, inside a frame
padded by 16 pixels, at 800x600, with one tolerance for every picture. A
real project (condo-ledger) used it as shipped and ended up with the one
shape we do not want: nine goldens, every one of them the whole app. It also
hit the add-on's limits:

- it edited the add-on's `visual.pw.ts` to give scenarios a width, and every
  update of the add-on refuses that file since;
- its dialogs are `position: fixed`, drawn against the viewport while the
  picture is of the padded frame, so every dialog golden carries a 16-pixel
  strip of the app outside the scrim;
- on linux-x64, rounded corners at fractional positions and a scrolling list
  inside a dialog shade differently from frame to frame. With zero tolerance
  that failed three wizard goldens, which the project gave up.

ReactiveTraderCloudClone (RTC) tests visually the way we want projects to:
most pictures are small components, one per state, a reasonable number are
composed sections, and a few are the whole app. It also paid for a set of
traps (fonts, global styles, theme, content widths) that the add-on still
partly has. This change makes the add-on teach and support RTC's practice,
inherit its lessons from the first install, and fix what condo-ledger found,
without breaking the projects that already have it.

## Goals

1. **A visual testing pyramid, as guidance.** A scenario says what it mounts
   (a component, a composed section, or the whole app) and what is captured.
   The README and the `AGENTS.md` section teach where a new picture belongs.
   The shipped examples show all three levels, weighted to components.
2. **Faithful pictures.** A page picture is the bare viewport, nothing added.
   Every picture is drawn with the app's real fonts, global styles and theme.
   The traps RTC met are closed by default, not by documentation alone.
3. **Per-scenario size and tolerance.** Width and height per scenario, with
   defaults. A small global insurance budget, and three per-scenario fields
   (`strict`, `maxDiffPixels`, `pixelThreshold`) allowed only with a
   measurement written beside them.
4. **Visual reach.** `pnpm visual:coverage` reports which UI files, branches
   and functions no scenario renders, as a ranked list. No gate.
5. **Deterministic capture.** A project never has to change its app or give up
   a golden to get a steady frame. The cause is pinned in the add-on's config
   or host, proven on linux-x64, never by raising a tolerance.
6. **A working update path.** A project with the add-on installed takes the new
   version through `extending-a-project`. Its scenarios and seeding carry over
   unedited; its goldens are redrawn once. The update shows release notes that
   say what changed and what to do.

## Non-goals

- A theme matrix (skins x modes) as RTC has. A project expresses a mode as a
  field of its own scenario, as condo-ledger does.
- Interaction-driven scenarios (clicks, typing). State still goes in as data
  through the harness; "never click" stays.
- A published diff site, running the tier in the container from a laptop, more
  than one client package, a second UI framework.
- Restoring condo-ledger's wizard goldens. That is condo-ledger's work, done
  after it takes the new version; the release notes make it possible.

## Anti-goals

These would make the change a failure even if everything ran:

- **A budget that hides a real change.** RTC's cap of 100 pixels would pass
  this repository's own reference regression (the starter's "up" colour moved
  one level per channel counts 82 pixels). Insurance must stay below the
  smallest regression the tier is proven to catch.
- **Steadiness bought with tolerance**, or with a rule that a project must keep
  its dialogs on whole pixels.
- **A quota.** No gate counts pictures per level. The word is "reasonable".
- **Pictures that are not the app**: a margin around a page, a fallback font, a
  missing theme, colours absent.
- **An update that breaks a project that did not ask for anything**: example
  scenarios or goldens landing in an existing project as orphans, a starting
  file that does not compile against the project's UI.

## Constraints

- **Ownership stays as it is.** `scenarios.ts`, `seeding.ts`, `tolerance.ts`
  and `goldens/` are the project's (starting files), and so are the two new
  files, `framing.ts` and `registry.tsx`. `host/`, `visual.pw.ts`,
  `playwright.config.ts`, `goldens.ts` and `tools/visual/` are the add-on's,
  replaced by an update, refused when edited. A feature never needs an edit to
  an add-on file. New project-owned files are starting files.
- **The installer's rules hold** (`scripts/add-to-project.mts`,
  `scripts/lib/install.mts`): hashes in `tools/installed.json`, templates of
  starting files in `tools/templates/`, `movedToProject`, `retiredFiles`, and
  scope rewriting. The scope-stable formatter test
  (`scripts/scope-stable-files.test.mts`) still holds for every add-on file.
- **One update writes every starting file the project was never given.** Today
  that is how a new starting file reaches an existing project. It is also why
  new example scenarios and goldens would land in condo-ledger as orphans. See
  "The update path".
- **Playwright stays pinned** at `1.63.0`, image
  `mcr.microsoft.com/playwright:v1.63.0-noble`, held by the kit's
  `playwright-pin` gate. Anything new that brings a browser uses the same
  build.
- **The repository's way of proving things**: each claim in the README has a
  measurement or a test, every new test is shown able to fail (a mutant in
  `tests/mutants.json`), and the README's "How it was tested" says what ran
  where.

## The design

### 1. What a scenario says

The add-on gains a type it owns, `Picture` (in `host/`), for the fields it
reads. The project's `Scenario` in `scenarios.ts` carries them beside its
own state fields. Every field is optional, so a scenario written for the
current version is a valid `Picture` as it is.

| Field | Meaning | Default |
|---|---|---|
| `level` | `"component"`, `"section"` or `"page"`: where the picture sits in the pyramid | `"page"` |
| `mount` | The registry key of what is rendered | the whole `App` |
| `capture` | `"root"` (the scenario root, content height) or `"viewport"` | `"root"` for component and section, `"viewport"` for page |
| `width` | Root width, or viewport width for a viewport capture | from `framing.ts` (below) |
| `height` | Viewport height for a viewport capture; ignored for a root capture | from `framing.ts` |
| `strict` | Zero pixels, zero threshold | off |
| `maxDiffPixels` | A larger absolute cap for this scenario; exclusive with `strict` | the global |
| `pixelThreshold` | A lower per-pixel colour threshold for this scenario | the global |

A scenario with none of these is a page: the whole `App` in a 1920x1080
viewport, captured as the viewport. That is what condo-ledger's nine are.
condo-ledger's own `width` field already means the viewport width, which is
what `width` now means for a page, so its scenarios carry over unchanged.

**The defaults are the project's.** A new starting file,
`tests/visual/framing.ts`, beside `tolerance.ts`, holds the numbers a
scenario falls back on: the root width, the root padding, and the viewport
for a viewport capture. The add-on ships it as `rootWidth: 480`,
`rootPadding: 8`, `viewport: 1920x1080`, which are where a project starts,
not rules. A project with wide grids or deep shadows changes its own file and
never an add-on file. Being new, it is written into an existing project by
the update (it is not an example).

`level` decides the default capture and is reported (the run's summary counts
pictures by level, so the shape of the pyramid is visible on every run). It
is otherwise a word for people and agents to reason with.

The spec checks the fields at run time and fails a scenario with a clear
message on a contradiction: `strict` with `maxDiffPixels`, `height` with a root
capture, a `mount` the seeding cannot render.

### 2. What is mounted

`mount` names an entry in a **registry**: a new project-owned starting file,
`tests/visual/registry.tsx`. An entry turns a scenario into an element. The
registry imports the real components from `src/ui` and passes them props (a
leaf), or renders a section that reads the view model, whose state comes from
the seeding through the harness as today.

The host does not import the registry. **The seeding does.** `Seeded` (what
`seedScenario` returns) gains an optional `render`, the element to show. With
no `render` the host renders `App`. So:

- a project made before this change has no registry and no `render`, and every
  scenario of its is a page of the whole app, as before;
- a new project's `seeding.ts` (the template) imports the registry and returns
  `render` for a scenario with a `mount`;
- a scenario that names a `mount` while the seeding returns no `render` fails
  with a message that points at the seeding template.

**The theme around an isolated component.** RTC's components got no colours
until they were wrapped in the theme provider that the app puts at its root;
condo-ledger's `AppRoot` sets `data-theme` and `data-mode` the same way. The
registry therefore exports the project's theme root for isolated pictures
(`Surround` in the template: the app's providers and theme attributes, without
its layout), and the seeding's `render` wraps every component and section in
it. The starter's is a pass-through with a comment that says what belongs in
it, since the starter's theme is `index.css` alone.

### 3. What is captured

- **Root capture** (components and sections). The host renders the element in
  an element with `data-testid="scenario-root"`: a fixed width (the scenario's,
  or `framing.ts`'s), a content height, the page's own background, and a small
  padding (`framing.ts`) so a shadow or focus ring outside a component's box
  is in the picture. The spec pictures that element.

  The fixed width is RTC's "#width-flake rule" built in. A content-sized box
  takes its width from the glyphs, and on x86 RTC's widths moved by 46 to 66
  pixels between runs. Playwright cannot compare images of different sizes,
  and no tolerance absorbs that. Height follows the content.

- **Viewport capture** (pages, and overlays). The viewport is set to the
  scenario's width and height before the page loads. The host renders the
  element straight into `#root`, with no frame, padding or margin, and the spec
  pictures the viewport. The picture is the app as a person sees it at that
  size.

- **A dialog, as a component.** Mount the dialog alone (no app behind it), with
  `capture: "viewport"` and a width and height the size of the picture wanted.
  Its `position: fixed` layer, its scrim and any `vh` sizes are then drawn
  against the viewport, which is the picture: nothing is offset, nothing of
  the app shows outside the scrim. This is RTC's approach for overlays
  (`FULL_BLEED`, captured as the page). A containing block on the scenario
  root was considered and set aside: `vh` units would still read the real
  viewport, and the dialog would be drawn at a size it never has in the app.
  A dialog over the app stays a page scenario, used sparingly.

The 16-pixel frame padding goes. Its comment justified it as making a
difference "a larger share of the image", which only mattered to a ratio
budget, and it is the cause of the dialog strip.

### 4. Faithful by default: the RTC traps, closed

| Trap in RTC | What the add-on does |
|---|---|
| The app's fonts were never loaded in the harness: their imports lived in `main.tsx`, and 1,046 goldens were drawn in a fallback font | The host loads the app's real `index.css` (as today). A new fast check, `pnpm visual:check:styles` (joins `gate:fast`), fails when the client's entry (`src/main.tsx`) imports a stylesheet or font other than `index.css`: such an import is moved into `index.css`, the one file the app and the host both load |
| `document.fonts.ready` resolved before any face was used, so real glyphs swapped in after the picture (a header measured 1139 then 1180 pixels) | Before the first render, the host loads every face the page's stylesheets declare (`document.fonts`, each face's `load()`), then awaits `ready`. No list to keep in step with the app, which RTC needed a test for. A face that fails to load fails the scenario |
| A hand-copied reset in place of the global stylesheet: `color-scheme`, scrollbar colours and the motion freeze were missing, dark pages came out white | Unchanged: the host imports `#/index.css`, the real file. The README says why |
| Isolated components without the theme provider had no colours | The registry's `Surround`, used by the seeding for every component and section (section 2) |
| Content widths drift with glyph advances | Root captures have a fixed width (section 3) |
| Two browser stacks on one 2-core runner made the stable-frame check capture early | CI runs the tier with one worker (section 6) |
| (condo-ledger) A native `<select>`'s own text drew two ways across linux-x64 runs | Documented as a trap with its fix (section 6); not detectable by a check |

### 5. Tolerance

Kept in `tolerance.ts`, the project's file. Three changes:

- **The default becomes a small insurance budget**, not zero: an absolute
  `maxDiffPixels` and a low `threshold`, with no ratio (a ratio is blind on
  large captures, and every number here is about absolute pixels).
- **The numbers are chosen by measurement and held by tests.** Above the
  measured floor (zero on both systems, once capture is steady, section 6);
  below the smallest real regression the tier must catch. Two parts (my call):
  - *Held on every change, without a browser.* This repository's CI runs no
    browser on purpose, and the add-on's comparison
    (`tools/visual/lib/pixelDiff.mts`) already counts as Playwright does
    (both said 83 on a real failure). The add-on's tests build image pairs for
    a set of reference regressions and require each to fail under the
    shipped `TOLERANCE`: a colour moved as the starter's green to blue, a
    one-pixel line of low contrast removed across a component-sized image, a
    thin element removed, a block moved by one pixel. Lowering the budget's
    guard (a mutant that raises a default) must fail a test.
  - *Measured once in the browser*, in the starter: the real colour change and
    a real one-pixel shift, counted by Playwright, written in the README's
    "How it was tested" and beside the numbers in `tolerance.ts`.

  The build picks the budget from those counts. My expectation, to be
  confirmed: a `maxDiffPixels` in the low tens and a `threshold` just above a
  1-2 level shading wobble.
- **Per-scenario fields** (`strict`, `maxDiffPixels`, `pixelThreshold`), applied
  by the spec as RTC's `visual.spec.ts` does. The rule, in the README and the
  `AGENTS.md` section: a per-scenario value needs a `pnpm visual:jitter`
  measurement of that scenario and the mechanism understood, both written in a
  comment at the scenario. Looser than the global only for a measured,
  understood difference; tighter (`strict`, a lower `pixelThreshold`) whenever
  the global could hide a change that matters there (RTC's 60-pixel sash grip).

`visual:jitter` stays the way to measure, and learns to measure one scenario.

### 6. Deterministic capture

condo-ledger's measurement (2026-10-16, its PR #11, merged as `6493aa8`).
The cause is Chromium's partial raster: it redraws only the changed part of a
tile, so the same rounded corner is shaded a level or two apart from frame to
frame, and under zero tolerance a scenario never gets two equal frames.
Seven flag sets ran as Playwright projects on linux-x64 in the pinned
container (none, `--disable-partial-raster`, `--disable-lcd-text`,
`--disable-threaded-scrolling`, `--run-all-compositor-stages-before-draw`,
`--disable-gpu`, all together), each writing its own images
(`snapshotPathTemplate` with `{projectName}`), every scenario drawn twice per
run, eight runs on separate runners in parallel:

- with no flag, the scrolling-list dialog never held still; threaded
  scrolling, compositor stages and `--disable-gpu` did not help;
- with `--disable-partial-raster` every frame held still, ten of eleven
  scenarios were byte-identical across all eight runs, and no golden outside
  the two dialogs changed;
- `--disable-lcd-text` added nothing and redrew every piece of text;
- the one remaining variance was a native `<select>`'s own text, drawn one
  of two ways (7 runs to 1) while the same text in a plain element matched
  every run. Drawn as ordinary text over the select, three more parallel runs
  were byte-identical and equal to the committed set.

What the add-on carries:

- `playwright.config.ts` launches Chromium with `--disable-partial-raster`,
  in this release, with that measurement in its comment. condo-ledger carries
  the same line today in its own edited copy of the add-on's config; the new
  config has it, so taking the update loses nothing there.
- **A trap entry** (README, `AGENTS.section.md`, section 4's table): a native
  form control's own text (a `<select>`, possibly others) is not deterministic
  in the headless Linux renderer. Draw the shown value as ordinary text, or
  keep the control out of goldens.
- **The probe technique**, as a README runbook beside `visual:jitter`
  (my call: a runbook, not a command): candidate flags as Playwright projects,
  a per-project snapshot path, every scenario drawn twice, parallel runs on
  separate runners, images compared by hash (`visual:jitter` over the
  downloaded artifacts). It is how the next such cause is found.
- CI's visual job and the update workflow run Playwright with one worker:
  RTC's ADR found two browser stacks on a 2-core runner made the stable-frame
  check capture early.
- Proof, in `skills-demo` on GitHub: the update workflow run five times on one
  commit, all images byte-identical (`pnpm visual:jitter` over the five
  artifacts reports 0), including a scenario built to provoke both of
  condo-ledger's faults: a card centred at a half pixel with rounded corners,
  and a scrolling list inside a fixed layer. That scenario is skills-demo's
  own, on its own UI, and does not ship in the starter (my call). The same on
  darwin-arm64.
  Then the tolerance numbers of section 5.
- RTC's ADR rejected forcing font hinting off. Nothing here touches hinting.

### 7. Visual reach

`pnpm visual:coverage` renders every scenario in Vitest's browser mode
(Chromium through Playwright, the pinned build), through the same render path
as the host, with no picture taken, and collects coverage of
`src/ui/**/*.tsx`. The provider is v8 if it runs in browser mode on Chromium
with the project's Vitest, as Vitest documents: the same provider as the
`coverage` add-on, one dependency fewer. RTC used istanbul, believing browser
mode had no v8; istanbul is the fallback if v8 does not run (my call). It writes
`tests/visual/reports/coverage/` (json, summary, html) and prints a ranked
list: the files with code no scenario renders, most uncovered first, and under
each the lines of its uncovered branches. Those are the states no scenario
shows yet. It is a report and fails only when a scenario could not be rendered.

The render path is shared: the host's rendering moves into a function that
both the Playwright page and the Vitest run call, so coverage measures what the
pictures show.

Where the project has the `coverage` add-on, its `pnpm coverage:gaps` reads
the visual summary when one is there and prints a "Not rendered by any visual
scenario" section beside its own, with the summary's age. It does not run the
browser itself. Without the `coverage` add-on, `visual:coverage`'s own list is
the report.

New dev dependencies in `packages/client-react`: Vitest's Playwright browser
provider and its istanbul coverage provider, at versions matching the
project's Vitest.

### 8. The examples

The starter's UI is small: `App` (a heading and the price list) and
`PriceList`, whose row is a private `PriceRowView`. The starter exports the row
as `PriceRow` so it can be pictured alone. The shipped scenarios, as an
example of the shape:

- **Components**: the row in each state that matters (up, down, selected,
  stale, and one more if the starter's presenter has it), and the empty list.
- **Sections**: the list with rows moving both ways, the list with a selected
  row.
- **Page**: the whole app, once, at 1920x1080.

Names say the level and the state (`price-row-stale`). Goldens for both
systems.

### 9. Documentation

The README and `AGENTS.section.md` teach:

- **The pyramid.** Start with the small components, every state that matters,
  one scenario each, at a fixed width. Then a reasonable number of composed
  sections, chosen for how parts fit together and not to cover combinations:
  the combinations of parts' states grow multiplicatively, and each part's
  states are already pictured below. Then a few pages, the whole app at the
  sizes that matter. Run `pnpm visual:coverage` to find states nothing shows.
  The shape to avoid is a set of only whole-app pictures.
- **Where a new picture belongs**, as a short decision: a new state of one
  component goes at the component level; a section only when the way parts sit
  together is what could break; a page only for a new screen or layout size.
- **A dialog as a component** (section 3).
- **The traps** of section 4, each with its reason, the native-control text
  among them.
- **The probe runbook** (section 6).
- **The tolerance rule** (section 5).
- **One line where agents look**: the update workflow uploads the goldens as an
  artifact and does not commit; the job summary gives the commands.

### 10. The update path

**First install** is as today, with the new files.

**An update of a project that has the add-on** must carry over its scenarios
and seeding unedited. Four mechanisms:

1. **Examples are written once.** A new manifest field, `examples`, lists the
   starting files that are only examples: the shipped scenarios' goldens, and
   the registry. They are written at first install and never by an update.
   Without it, the update would write the new example goldens into
   condo-ledger, where the orphan check fails on them, and a registry that
   imports `PriceRow`, which condo-ledger does not have. The project's
   template copy is still kept in `tools/templates/`, so the files are there
   to copy from. The installer's tests cover it, with mutants.
2. **`visual.pw.ts` edits go to the scenario.** `movedToProject` gains
   `visual.pw.ts` -> `scenarios.ts`, with the note that a width or height now
   goes on the scenario. condo-ledger's edit is exactly that.
3. **Starting files whose template changed** (`seeding.ts`, `scenarios.ts`,
   `tolerance.ts`) are shown under "Yours to change", as today. The project's
   own files are untouched.
4. **Release notes.** A new manifest field, `releaseNotes`: an ordered list of
   `{ id, notes }`. On an update, the installer prints the notes of every
   release not yet recorded for the unit (a new `releasesSeen` list in
   `tools/installed.json`), then records them. A first install records them
   without printing. A record from before the field has none seen, so
   condo-ledger sees this release's notes. `extending-a-project` says to show
   them to the user unchanged. A general installer feature, first used here.

**The release notes**, written as the update will print them, say:

- every existing scenario is now a page of the whole app at 1920x1080 by
  default, with no margin: redraw every golden (`pnpm visual:update`, and the
  update workflow for `linux-x64`), and look at each one before committing it;
- a project that edited `visual.pw.ts` to set a width: the scenario's `width`
  and `height` now do that; take the update with `--force`, and move anything
  else from the kept copy;
- a project that added `--disable-partial-raster` to `playwright.config.ts`:
  the add-on's config now has it. `--force` keeps no copy of that file, and
  the notes print after it has run, so they point a config that differed by
  more than that line at
  `git show HEAD:packages/client-react/tests/visual/playwright.config.ts`;
- to add component and section scenarios: copy the registry from
  `tools/templates/`, return `render` from the seeding as the new template
  does, wrap isolated components in the app's theme root;
- Chromium now starts with `--disable-partial-raster`: scenarios given up for
  shading or a flickering list can come back, as components; a native
  control's own text still varies, so draw its shown value as ordinary text;
- the new default tolerance, and the per-scenario fields, with the rule;
- `pnpm visual:coverage`, and `pnpm visual:check:styles` in `gate:fast`.

## How it is proven

- The add-on's own tests (`pnpm vitest run addons/visual`) for every new
  piece: field checks, capture choice, the per-scenario tolerance mapping, the
  styles check, the reach ranking. Each shown able to fail, with mutants.
- The installer's tests for `examples` and `releaseNotes`, with mutants.
- **An update from the current version**: a project made from the current
  `main`, with the visual add-on, `visual.pw.ts` edited for a width and
  `playwright.config.ts` edited for the flag, as condo-ledger has them,
  updated to the new version. Its scenarios and seeding unchanged, no
  example file written, the release notes printed once, the second update
  silent, and `pnpm visual` passing after a redraw.
- In `skills-demo`: the update taken through `extending-a-project`, its own
  scenarios redrawn, at least one component, section and page scenario of its
  own added, `pnpm visual:coverage` run, and CI green. The five-run linux-x64
  measurement of section 6 is made there.
- The README's "How it was tested" and `docs/STATUS.md` updated with what ran
  where, and what did not.

## Left to the builder

- The exact names and file layout inside `host/`, as long as `host/` stays
  the add-on's and knows no field of a project's own state.
- The shipped values in `framing.ts` (480 and 8 above): my calls, to change
  if the examples say otherwise.
- The tolerance numbers, from the measurement and the reference regressions.
- Whether `visual:jitter` measures one scenario by name or by pattern.
- How the Vitest run resets the host's fake clock between scenarios.

## Where the shipped `linux-x64` goldens are drawn

They can only be drawn in the pinned container on GitHub's runners, and
skills-demo never receives the new examples. Decided with the user: a
temporary public repository, `bettersoftware-io/skills-visual-proof`, made as
skills-demo was on 2026-10-05 (a fresh project from the new version with
every add-on, nothing edited by hand). The update workflow is run five times
on one commit; the five artifacts are the shipped set and the noise
measurement, recorded in a dated `docs/` note as the 2026-10-05 run was. The
repository is deleted once the images are in this repository and the note is
written; creating, pushing to and deleting it are each confirmed with the
user at the time.
