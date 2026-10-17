# Visual pyramid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `visual` add-on pictures components, sections and pages faithfully and steadily, with per-scenario size and tolerance, a visual-reach report, and an update path that carries existing projects over.

**Architecture:** An add-on-owned `Picture` model (`host/picture.ts`) is resolved the same way by the Playwright spec (Node) and the host (browser). The host renders what the project's seeding returns (a registry entry, or `App`), inside a fixed-width root or straight into the viewport. The installer learns two fields, `examples` and `releaseNotes`.

**Tech Stack:** TypeScript (Node 26, `.mts` tools), React 19, Playwright 1.63.0, Vitest 5 (browser mode, v8 coverage), pnpm 12.6.

**Spec:** `docs/superpowers/specs/2026-10-16-visual-pyramid-design.md`

## Global Constraints

- Work on branch `worktree-visual-pyramid` in a worktree; the spec and this plan are its first commit.
- Paths below starting `VISUAL/` mean `addons/visual/files/packages/client-react/tests/visual/`; `TOOLS/` means `addons/visual/files/tools/visual/`.
- Project-owned (starting files): `scenarios.ts`, `seeding.ts`, `tolerance.ts`, `framing.ts`, `registry.tsx`, `goldens/`. Everything else in the add-on is the add-on's.
- `examples` (written at first install only): `goldens/` and `registry.tsx`.
- `framing.ts` ships `rootWidth: 480`, `rootPadding: 8`, `viewport: { width: 1920, height: 1080 }`.
- A scenario with no `Picture` field is a page: `App`, viewport 1920x1080, captured as the viewport, no margin.
- Playwright stays exactly `1.63.0`; image `mcr.microsoft.com/playwright:v1.63.0-noble`; Chromium launched with `--disable-partial-raster`.
- Every add-on file that names `@app/` must pass `scripts/scope-stable-files.test.mts` (use the existing `biome-ignore format` comment pattern on long scope imports).
- Every new test is shown able to fail: a mutant in the add-on's `tests/mutants.json` or `scripts/mutants/<topic>.json`, run with `node addons/coverage/files/tools/coverage/mutation-check.mts <spec>`, all killed. `scripts/mutants.test.mts` must stay green.
- Release id `0.19.0`; `.codex-plugin/plugin.json` goes from `0.18.1` to `0.19.0`.
- Writing style of comments, READMEs and messages: the repository's (short plain sentences, say what was measured).
- Commit messages: conventional (`feat(visual): ...`), ending with the session's attribution lines.
- Outward actions (create/push/delete a GitHub repository, push to skills-demo, dispatch workflows) are confirmed with the user at the time.

## Review Focus

1. **A project's old `tolerance.ts`** (`{ maxDiffPixelRatio: 0, threshold: 0 }`, no `maxDiffPixels`) must still drive the spec and `visual:jitter`: they read either shape. Test in Task 3 and Task 11.
2. **A project field that collides with a `Picture` field** (`level: "x"`, `width: "wide"`) fails that scenario with its name and the field, never a silent default. Test in Task 3.
3. **A scenario with `mount` while the seeding returns no `render`** (an old project's seeding) fails with a message pointing at `tools/templates/visual.…seeding.ts.txt`. Test in Task 3 (`describeMissingRender`) and Task 5.
4. **A web font that fails to load** fails the scenario, never a picture in a fallback face. Test in Task 5.
5. **An old record with no `starting` list** (`given === undefined`) must neither write nor name an example file on update. Test in Task 1.

---

### Task 1: The installer's `examples` field

**Files:**
- Modify: `scripts/add-to-project.mts` (`AddonManifest`, `addAddon` around the starting-files loop at ~632-660)
- Test: `scripts/add-to-project.test.mts` (new `describe("an example starting file", …)`, beside the block at ~1487)
- Mutants: `scripts/mutants/examples.json`

**Interfaces:**
- Produces: `AddonManifest.examples?: string[]`, same pattern syntax as `startingFiles` (a path, or a folder ending in `/`). Every example must also be a starting file; otherwise `addAddon` throws `InstallError("the add-on \"<name>\" cannot be installed: <path> is an example and not a starting file")`.

- [ ] **Step 1: Write the failing tests** (use the existing `withStartingFiles`/`createWorld` helpers; add `withExamples(repository)` that lists one golden folder and one `.tsx` as examples)
  - `it("writes an example at first install")`: the example files exist after the first `addToProject`.
  - `it("never brings an example in with an update, even one this version is the first to ship")`: install, then add a new example file to the add-on, update: the file is absent, `created` does not list it, and the record's `starting` lists it.
  - `it("neither writes nor names an example in a project whose record has no starting list")`: `forgetStartingFiles(project)`, add a new example, update: absent, and `describe(result)` does not mention it.
  - `it("still writes a new starting file that is not an example")`: same update with a new non-example starting file: written.
  - `it("refuses an example that is not a starting file")`: throws the message above, nothing written.
- [ ] **Step 2: Run** `pnpm vitest run scripts/add-to-project.test.mts -t "example"` — expect FAIL.
- [ ] **Step 3: Implement.** In `addAddon`, `const isExample = (path: string) => matchesPattern(path, manifest.examples ?? [])` (reuse the matching `takeStartingFiles` uses). The write branch becomes `firstTime || (neverGiven(path) && !isExample(path))`; the `unseen` branch skips examples. Validate before anything is written.
- [ ] **Step 4: Run** the same command — PASS; then `pnpm vitest run scripts` — PASS.
- [ ] **Step 5: Mutants** in `scripts/mutants/examples.json`: drop `!isExample(path)` from the write branch; drop it from the `unseen` branch; drop the validation. Run `node addons/coverage/files/tools/coverage/mutation-check.mts scripts/mutants/examples.json` — all killed.
- [ ] **Step 6: Commit** `feat(installer): an add-on's examples are written at first install only`.

### Task 2: The installer's `releaseNotes` field

**Files:**
- Modify: `scripts/add-to-project.mts` (`AddonManifest`, `AddResult`, `addAddon`, `describe` at ~1270)
- Modify: `scripts/lib/install.mts` (`InstalledRecord`, new record functions beside `recordStarting`)
- Modify: `skills/extending-a-project/SKILL.md` (step 3)
- Test: `scripts/add-to-project.test.mts`; Mutants: `scripts/mutants/release-notes.json`

**Interfaces:**
- Produces: `AddonManifest.releaseNotes?: { id: string; notes: string[] }[]` (oldest first); `InstalledRecord[unit].releasesSeen?: string[]`; `installedReleases(project, unit): string[] | undefined` and `recordReleases(project, unit, ids: string[]): void` in `lib/install.mts`; `AddResult.releaseNotes: { id: string; notes: string[] }[]`.
- `describe()` prints, after the file summary and before "Still to do by hand":
  ```
  Release notes:
    0.19.0
      - <note>
  ```

- [ ] **Step 1: Write the failing tests**
  - `it("prints no notes at first install, and records them as seen")`.
  - `it("prints the notes of a release the project has not seen, once")`: install with release `a`; add release `b`; update → `releaseNotes` is `[b]`; update again → `[]`.
  - `it("prints every release to a project whose record is from before release notes")`: delete `releasesSeen` from the record; update → every release, in manifest order.
  - `it("keeps releasesSeen through an update that changes other files")`.
  - `it("shows the notes under 'Release notes:' before what is still to do")` on `describe()`.
- [ ] **Step 2: Run** `pnpm vitest run scripts/add-to-project.test.mts -t "notes"` — FAIL.
- [ ] **Step 3: Implement** as the Interfaces say. On first install, `recordReleases` with every id and return `[]`.
- [ ] **Step 4: Run** — PASS; `pnpm vitest run scripts` — PASS.
- [ ] **Step 5:** In `extending-a-project/SKILL.md` step 3 add: "If it prints "Release notes", show them to the user unchanged: they say what the new version changes and what to do." Run `pnpm vitest run scripts/evals.test.mts scripts/plugin-manifests.test.mts` — PASS.
- [ ] **Step 6: Mutants** (record nothing at first install; never record; print seen ones) — all killed.
- [ ] **Step 7: Commit** `feat(installer): an add-on's release notes, printed once per release`.

### Task 3: The `Picture` model, `framing.ts` and the tolerance's new shape

**Files:**
- Create: `VISUAL/host/picture.ts`, `VISUAL/framing.ts`
- Modify: `VISUAL/tolerance.ts`, `addons/visual/addon.json` (`startingFiles` += `framing.ts`)
- Test: `addons/visual/tests/picture.test.mts` (imports `picture.ts` directly; it has no DOM or React import)

**Interfaces:**
- Produces, in `host/picture.ts`:
  ```ts
  export type Level = "component" | "section" | "page";
  export type Capture = "root" | "viewport";
  export interface Picture { level?: Level; mount?: string; capture?: Capture; width?: number; height?: number; strict?: true; maxDiffPixels?: number; pixelThreshold?: number }
  export interface Framing { rootWidth: number; rootPadding: number; viewport: { width: number; height: number } }
  export interface Tolerance { threshold: number; maxDiffPixels?: number; maxDiffPixelRatio?: number }
  export interface ResolvedPicture { level: Level; capture: Capture; mount: string | undefined; viewport: { width: number; height: number }; root: { width: number; padding: number } | undefined; tolerance: Tolerance }
  export class PictureError extends Error {}
  export function resolvePicture(name: string, scenario: unknown, framing: Framing, global: Tolerance): ResolvedPicture;
  export function describeMissingRender(name: string): string;
  ```
- `framing.ts`: `export const FRAMING: Framing = { rootWidth: 480, rootPadding: 8, viewport: { width: 1920, height: 1080 } };` with a comment that these are where the project starts and are its to change.
- `tolerance.ts`: `export const TOLERANCE: Tolerance = { maxDiffPixels: 8, threshold: 0.01 };` — starting values; Task 4 confirms or lowers them and writes the measurement. The comment keeps the two-knob explanation, drops the ratio, and states the per-scenario rule (spec §5).

- [ ] **Step 1: Write the failing tests** (`describe("resolvePicture")`, `FRAMING` and a global of `{ threshold: 0.01, maxDiffPixels: 8 }`):
  - `{}` → `{ level: "page", capture: "viewport", mount: undefined, viewport: {1920,1080}, root: undefined }`.
  - `{ level: "component" }` → `capture "root"`, `root { width: 480, padding: 8 }`, viewport 1920x1080.
  - `{ level: "section", width: 920 }` → `root.width 920`.
  - `{ width: 1280 }` (condo-ledger's shape) → page, viewport `{1280, 1080}`.
  - `{ level: "component", capture: "viewport", width: 720, height: 560 }` → viewport `{720, 560}`, `root undefined`.
  - Tolerance: `{}` → `{ threshold: 0.01, maxDiffPixels: 8 }`; `{ strict: true }` → `{ threshold: 0, maxDiffPixels: 0 }`; `{ maxDiffPixels: 40 }` → 40; `{ pixelThreshold: 0.005 }` → threshold 0.005; old global `{ maxDiffPixelRatio: 0, threshold: 0 }` with `{}` → `{ threshold: 0, maxDiffPixelRatio: 0 }`.
  - Each throws `PictureError` whose message names the scenario and the field: `level: "x"`; `capture: "page"`; `width: "wide"`, `0`, `12.5`; `height` with a root capture; `strict` with `maxDiffPixels`; `strict: false`; `maxDiffPixels: 4` (not above the global 8); `pixelThreshold: 0.02` (not below 0.01); `mount: ""`; a non-object scenario.
  - `describeMissingRender("x")` names the scenario, `seeding.ts`, `render`, and `tools/templates/visual.packages__client-react__tests__visual__seeding.ts.txt`.
- [ ] **Step 2: Run** `pnpm vitest run addons/visual/tests/picture.test.mts` — FAIL.
- [ ] **Step 3: Implement** `resolvePicture` and `describeMissingRender` in `host/picture.ts`; write `framing.ts`; rewrite `tolerance.ts`. Keep `picture.ts` free of imports so Node and the browser both load it. Until Task 11, `TOOLS/lib/measure.mts` takes `Tolerance` from `picture.ts` and reads `maxDiffPixelRatio ?? 0`, so the root `pnpm typecheck` stays green.
- [ ] **Step 4: Run** — PASS. `pnpm vitest run addons/visual` — PASS.
- [ ] **Step 5: Mutants** in `addons/visual/tests/mutants.json`: swap the default capture for a component; ignore `framing.rootWidth`; let `strict` keep the global threshold; skip the "above the global" check — all killed.
- [ ] **Step 6: Commit** `feat(visual): a picture says its level, mount, capture, size and tolerance`.

### Task 4: The insurance budget, held by reference regressions

**Files:**
- Create: `addons/visual/tests/budget.test.mts`
- Modify: `VISUAL/tolerance.ts` (numbers and their measurement comment)
- Uses: `TOOLS/lib/pixelDiff.mts` (`comparePixels`), `TOOLS/lib/png.mts`, `addons/visual/tests/support/createPng.mts`

**Interfaces:**
- Consumes: `TOLERANCE` from `VISUAL/tolerance.ts`; `comparePixels(first: Image, second: Image, threshold: number): PixelDifference`.

- [ ] **Step 1: Write the tests.** A helper `counted(before, after) = comparePixels(before, after, TOLERANCE.threshold).different`. On a 480x48 white image with a row of text-like dark strokes, each regression must give `counted > TOLERANCE.maxDiffPixels`:
  - `it("catches the starter's up colour turned blue")`: an 83-pixel glyph area `#1a8f4c` → `#1a4c8f`.
  - `it("catches a one-pixel line of low contrast removed")`: a 1x120 line `#d9d9d9` on white, removed.
  - `it("catches a 4x4 icon removed")`.
  - `it("catches a bordered box moved by one pixel")`: a 60x20 box with a 1px `#888` border, shifted right by one.
  - `it("lets through a one- or two-level shading wobble")`: 40 corner pixels moved by 2 levels on each channel → `counted === 0`.
  - `it("keeps the budget at most half the smallest regression")`: computes all four counts and asserts `TOLERANCE.maxDiffPixels * 2 <= min(counts)`.
- [ ] **Step 2: Run** `pnpm vitest run addons/visual/tests/budget.test.mts`. If a regression is not counted (pixelmatch drops it as anti-aliasing) or the half-rule fails, lower `maxDiffPixels` or `threshold` until all pass, and never raise them. If a regression cannot register at any budget, keep it as `it.fails` with a comment that says why the tier is blind to it. List that limit in the README in Task 12.
- [ ] **Step 3:** Write the final numbers and each regression's count into `tolerance.ts`'s comment.
- [ ] **Step 4: Mutants:** raise `maxDiffPixels` to 100 (RTC's); raise `threshold` to 0.2 (Playwright's default) — both killed.
- [ ] **Step 5: Commit** `feat(visual): the default tolerance is a small insurance budget, held by reference regressions`.

### Task 5: The host renders what the seeding returns, faithfully

**Files:**
- Create: `VISUAL/host/fonts.ts`, `VISUAL/host/render.tsx`
- Modify: `VISUAL/host/main.tsx`, `VISUAL/host/ScenarioFrame.tsx`, `VISUAL/host/seeded.ts`, `VISUAL/host/address.ts`
- Delete: `VISUAL/host/host.css` (its `body { margin: 0 }` made pages differ from the app)
- Test: `addons/visual/tests/fonts.test.mts`, `addons/visual/tests/addon.test.mts`

**Interfaces:**
- Consumes: `resolvePicture`, `describeMissingRender`, `PictureError` (Task 3); `FRAMING`, `TOLERANCE`, `scenarios`, `seedScenario`.
- Produces:
  - `fonts.ts`: `export async function loadEveryFace(fonts: Iterable<FontFace> & { ready: Promise<unknown> }): Promise<void>`: loads every declared face, then awaits `ready`; a face that rejects throws `Error("the font <family> <weight> <style> did not load: <reason>")`.
  - `seeded.ts`: `Seeded` gains `render?: () => ReactElement`.
  - `render.tsx`: `export interface Shown { ready: Promise<void>; unmount: () => void }` and `export async function showScenario(name: string, container: HTMLElement): Promise<Shown>`. It imports `#/index.css` (the one place it is loaded), looks the scenario up (unknown → the current message listing names), resolves the picture, installs the fake clock (as today: timers and `Date`), seeds, throws `PictureError(describeMissingRender(name))` when `mount` is set and `render` is not, awaits `loadEveryFace(document.fonts)`, then renders `seeded.render?.() ?? <App />` in `ScenarioFrame`. `unmount` unmounts the root and uninstalls the clock.
  - `ScenarioFrame` props: `{ seed: () => void; root: { width: number; padding: number } | undefined; onReady: () => void; children: ReactNode }`. With `root`, children go in `<div data-testid={ROOT_TESTID} style={{ width, padding, boxSizing: "content-box" }}>`; without it, children are rendered bare. Seeds once in its effect, then calls `onReady`.
  - `address.ts`: `ROOT_TESTID = "scenario-root"`, `READY_ATTRIBUTE = "data-visual-ready"` (set on `<html>`); `FRAME_TESTID` goes.
  - `main.tsx`: reads `?scenario=`, `const shown = await showScenario(name, root)`, `await shown.ready`, then sets `READY_ATTRIBUTE="true"` on `document.documentElement`.

- [ ] **Step 1: Write the failing tests**
  - `fonts.test.mts`: a fake set of three faces → each `load()` called, then `ready` awaited; one face rejecting → throws naming its family and weight; empty set → resolves.
  - `addon.test.mts`: update the who-owns-what tests. `scenarioFields()` reads the project fields of `Scenario` (it now `extends Picture`); `host/render.tsx`, `ScenarioFrame.tsx`, `seeded.ts`, `main.tsx` name none of them and no harness. `render.tsx` installs the clock before `seedScenario(`, calls `loadEveryFace(` before `.render(`, imports `#/index.css`. No `host.css` is shipped.
- [ ] **Step 2: Run** `pnpm vitest run addons/visual/tests/fonts.test.mts addons/visual/tests/addon.test.mts` — FAIL.
- [ ] **Step 3: Implement** as the Interfaces say. Keep the `biome-ignore format` line on the `@app/react-bindings` import (now in `render.tsx`).
- [ ] **Step 4: Run** — PASS; `pnpm vitest run addons/visual scripts/scope-stable-files.test.mts` — PASS.
- [ ] **Step 5: Mutants:** load fonts after render; skip the missing-render check; swallow a font rejection — all killed.
- [ ] **Step 6: Commit** `feat(visual): the host renders the seeding's element, in a fixed root or the bare viewport, after every font has loaded`.

### Task 6: The spec and config: size, capture, tolerance per scenario, a steady frame

**Files:**
- Modify: `VISUAL/visual.pw.ts`, `VISUAL/playwright.config.ts`, `TOOLS/summary.mts`, `addons/visual/addon.json` (`movedToProject` += `visual.pw.ts` → `scenarios.ts`, note: "A width or height a scenario needs now goes on the scenario: `width` and `height` set the viewport of a page.")
- Test: `addons/visual/tests/summary.test.mts`, `addons/visual/tests/addon.test.mts`

**Interfaces:**
- Consumes: `resolvePicture` (Task 3); `ROOT_TESTID`, `READY_ATTRIBUTE` (Task 5).
- The spec per scenario: resolve (a `PictureError` fails that test with its message); `page.setViewportSize(resolved.viewport)` before `goto`; wait for `html[data-visual-ready="true"]`; the trouble checks and missing-golden check as today; `testInfo.annotations.push({ type: "level", description: resolved.level })`; screenshot `page.getByTestId(ROOT_TESTID)` for `root`, `page` (viewport, not `fullPage`) for `viewport`, with `resolved.tolerance`.
- Config: `launchOptions: { args: ["--disable-partial-raster"] }` with condo-ledger's measurement (spec §6) in the comment; `workers: process.env.CI === undefined ? undefined : 1` with RTC's one-browser-stack reason; `viewport` from `FRAMING.viewport`; `expect.toHaveScreenshot` keeps `animations`, `caret`, `scale`, and `...TOLERANCE` as the fallback.
- `summary.mts`: `Summary` gains `levels: Record<Level, number>`, read from each test's `level` annotation; the summary prints `Pictures: N components, N sections, N pages`.

- [ ] **Step 1: Write the failing tests:** `summary.test.mts` counts levels from a report with annotations, and prints the line; a report without annotations counts every scenario as a page. `addon.test.mts`: the manifest sends `visual.pw.ts` to `scenarios.ts`; the config has the flag and one CI worker.
- [ ] **Step 2: Run** `pnpm vitest run addons/visual` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. `pnpm vitest run scripts/add-to-project.test.mts` (the manifest's handovers must validate) — PASS.
- [ ] **Step 5: Mutants:** capture the root for a page; drop the flag; skip `setViewportSize` — killed.
- [ ] **Step 6: Commit** `feat(visual): each scenario sets its viewport, capture and tolerance; Chromium without partial raster, one worker in CI`.

### Task 7: The starter's examples at three levels, and their macOS goldens

**Files:**
- Modify: `starter/packages/client-react/src/ui/PriceList.tsx` (export `PriceRow`, the former `PriceRowView`)
- Modify: `VISUAL/scenarios.ts`, `VISUAL/seeding.ts`
- Create: `VISUAL/registry.tsx`
- Replace: `VISUAL/goldens/darwin-arm64/*.png` (the four old ones go); `goldens/linux-x64/` is emptied here and filled in Task 15
- Modify: `addons/visual/addon.json` (`startingFiles` += `registry.tsx`; `examples: ["packages/client-react/tests/visual/goldens/", "packages/client-react/tests/visual/registry.tsx"]`)

**Interfaces:**
- `scenarios.ts`: `export interface Scenario extends Picture { stalePrices?; prices; selected?; row?: PriceRow }` (`Picture` from `./host/picture.ts`, `PriceRow` from `@app/client-core`).
- `registry.tsx`: `export function Surround({ children }: { children: ReactNode }): ReactElement` (a pass-through, with a comment saying the app's theme providers and attributes, without its layout, go here); `export const registry: Record<string, (scenario: Scenario) => ReactElement>` with `"price-row"` (a `PriceRow` from `scenario.row` in `<table><tbody>`, `onSelect` a no-op) and `"price-list"` (`<PriceList />`); `export function renderMount(scenario: Scenario): ReactElement` (wraps in `Surround`; an unknown key throws, naming the known ones).
- `seeding.ts`: returns `render: scenario.mount === undefined ? undefined : () => renderMount(scenario)` beside `app` and `deliver`.
- Scenarios: components `price-row-up`, `price-row-down`, `price-row-flat`, `price-row-selected`, `price-row-stale`, `price-list-empty`; sections `price-list-moving`, `price-list-selected`; page `app` (whole app, prices moving, no mount).

- [ ] **Step 1: Write the failing test** in `addon.test.mts`: the shipped scenarios cover all three levels, components are the most numerous, at most two are pages, and every `mount` is a registry key (read both files as text).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4:** In the scratchpad, `node scripts/create-project.mts <dir> --scope @demo`, add `kit` then `visual` from this branch, `pnpm install`, `pnpm visual:update`; open every image and check it shows what its name says, with the starter's real font and no margin on `app`; `pnpm visual` → 10 of 10 pass (9 scenarios and the orphan check). Copy the nine PNGs into `VISUAL/goldens/darwin-arm64/`.
- [ ] **Step 5:** `pnpm gate:full` in that project — PASS (knip must accept the exported `PriceRow`; if not, record why and fix in the starter). `pnpm vitest run` at this repository's root — PASS.
- [ ] **Step 6: Commit** `feat(visual): example scenarios at three levels, with a registry; the starter exports PriceRow`.

### Task 8: `pnpm visual:check:styles`

**Files:**
- Create: `TOOLS/check-styles.mts`; Test: `addons/visual/tests/check-styles.test.mts`
- Modify: `addons/visual/addon.json` (script `"visual:check:styles": "node tools/visual/check-styles.mts"`; `gates.fast` += it)

**Interfaces:**
- `export interface StylesVerdict { exitCode: 0 | 1 | 2; lines: string[] }` and `export function checkStyles(root: string): StylesVerdict`. Reads `packages/client-react/src/main.tsx`. Fails (1) on an import whose specifier ends in `.css`, `.scss`, `.woff`, `.woff2` or contains `@fontsource`, other than `./index.css` or `#/index.css`, naming file and line and saying to move it into `index.css`. No file → 0 with `SKIP`. Unreadable → 2. Output prefix `PASS|FAIL|SKIP visual-styles`.

- [ ] **Step 1: Tests** (temp folders): the starter's `main.tsx` passes; `import "./fonts.css"` fails with line 3; `import "@fontsource/inter/400.css"` fails; `import x from "./logo.svg"` passes; a missing file skips.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Mutants** (allow any `.css`; skip `@fontsource`) — killed.
- [ ] **Step 6: Commit** `feat(visual): a fast check that every stylesheet and font the app loads comes through index.css`.

### Task 9: `pnpm visual:coverage`

**Files:**
- Create: `VISUAL/reach/vitest.config.ts`, `VISUAL/reach/reach.browser.tsx` (not `*.spec`/`*.test`: the package's jsdom runner must not collect it), `TOOLS/coverage.mts`, `TOOLS/lib/reach.mts`
- Test: `addons/visual/tests/reach.test.mts`
- Modify: `addons/visual/addon.json`: root script `"visual:coverage": "node tools/visual/coverage.mts"`; client devDependencies `"@vitest/browser-playwright": "^5.0.3"`, `"@vitest/coverage-v8": "^5.0.3"`, `"playwright": "1.63.0"`

**Interfaces:**
- Consumes: `showScenario` (Task 5).
- Config: browser mode, `playwright({ launchOptions: { args: ["--disable-partial-raster"] } })`, one `chromium` instance, viewport `FRAMING.viewport`, `include: ["tests/visual/reach/reach.browser.tsx"]`, `root` the package; coverage `provider: "v8"`, `include: ["src/ui/**/*.tsx"]`, `exclude: ["src/ui/**/*.test.tsx", "src/ui/**/*.page.tsx"]`, `reporter: ["json", "json-summary", "html"]`, `reportsDirectory: "tests/visual/reports/coverage"`. If v8 does not run in browser mode, switch to `@vitest/coverage-istanbul` and say why in the config comment.
- `reach.browser.tsx`: one `it` per scenario: append a container, `showScenario`, await `ready`, `unmount`, remove the container.
- `lib/reach.mts`: `export interface ReachGap { file: string; uncoveredStatements: number; statementsPct: number; branchLines: number[]; functions: string[] }`; `export function rankReach(coverage: Record<string, IstanbulFile>, root: string): ReachGap[]` (most uncovered statements first, then lower percentage, then path); `export function formatReach(gaps: ReachGap[], limit: number): string` (one line per file, and under it `branches never taken at lines 12, 40` and `functions never called: x`).
- `coverage.mts`: runs the package's `node_modules/.bin/vitest run --config tests/visual/reach/vitest.config.ts --coverage`; on failure prints the full output and exits 2; else prints `formatReach(rankReach(...), limit)` (`--limit`, default 30) and exits 0.

- [ ] **Step 1: Tests** on `rankReach`/`formatReach` with a hand-written two-file istanbul map: ranking order, branch lines unique and sorted, a fully covered file left out, paths relative to the root.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5:** In the Task 7 project (reinstalled from this branch): `pnpm install`, `pnpm visual:coverage` → exit 0, the list names starter UI lines, and `gate:full` passes (playwright-pin accepts `playwright@1.63.0`).
- [ ] **Step 6: Mutants** (ranking order; a covered file listed) — killed.
- [ ] **Step 7: Commit** `feat(visual): pnpm visual:coverage reports what no scenario renders`.

### Task 10: `coverage:gaps` shows visual reach

**Files:**
- Create: `addons/coverage/files/tools/coverage/lib/visualReach.mts`; Test: `addons/coverage/tests/visualReach.test.mts`
- Modify: `addons/coverage/files/tools/coverage/gaps.mts`

**Interfaces:**
- `export const VISUAL_SUMMARY = "packages/client-react/tests/visual/reports/coverage/coverage-summary.json"`; `export function readVisualReach(root: string): { files: FileCoverage[]; writtenAt: Date } | undefined` (undefined when absent).
- `gaps.mts` prints, after its table, `Not rendered by any visual scenario (pnpm visual:coverage, written <formatDate>):` and the files with uncovered lines, ranked as `rankGaps` ranks; `--json` gains `visualReach`. It never runs the browser.

- [ ] **Step 1: Tests:** absent file → undefined and no section; a summary with two files → section lists the uncovered one with its date.
- [ ] **Step 2-4:** FAIL, implement, PASS (`pnpm vitest run addons/coverage`).
- [ ] **Step 5: Mutant** (section printed without a summary) — killed.
- [ ] **Step 6: Commit** `feat(coverage): gaps shows what no visual scenario renders, when the report is there`.

### Task 11: `visual:jitter` judges each scenario by its own tolerance

**Files:**
- Modify: `TOOLS/lib/measure.mts`, `TOOLS/jitter.mts`, `TOOLS/lib/arguments.mts`
- Test: `addons/visual/tests/measure.test.mts`, `addons/visual/tests/jitter.test.mts`

**Interfaces:**
- `measure.mts`: `Tolerance` becomes the `Tolerance` of `host/picture.ts`; `judgeNoise(measurement, toleranceOf: (image: string) => Tolerance)`; it reports the floor in pixels and the threshold, and fails when an image's worst `different` exceeds its `maxDiffPixels` (or its ratio, for an old-shape tolerance).
- `arguments.mts`: `--scenario <name>` (repeatable) captures only those (`playwright test -g`).
- `jitter.mts`: `toleranceOf` resolves each image's scenario with `resolvePicture` and `TOLERANCE`.

- [ ] **Step 1: Tests:** a per-scenario `maxDiffPixels: 40` passes 30 differing pixels for that image only; an old-shape `{ maxDiffPixelRatio: 0, threshold: 0 }` still judges; `--scenario a --scenario b` parses.
- [ ] **Step 2-4:** FAIL, implement, PASS.
- [ ] **Step 5: Mutants** (judge every image by the global) — killed.
- [ ] **Step 6: Commit** `feat(visual): jitter measures one scenario and judges each by its own tolerance`.

### Task 12: The docs, the release notes, the version

**Files:**
- Modify: `addons/visual/README.md`, `addons/visual/AGENTS.section.md`, `addons/visual/addon.json` (`releaseNotes`), `.codex-plugin/plugin.json` (`0.19.0`), `docs/inventory.md` (visual reach: built), `docs/STATUS.md` (replace "The visual add-on lacks two changes condo-ledger made" and the visual "Not built" line)

**Content:**
- README and `AGENTS.section.md` teach spec §9, in this order: the pyramid ("start with the small components, every state that matters; then a reasonable number of sections and pages; the combinations grow multiplicatively and the parts are already pictured; a set of only whole-app pictures is the shape to avoid"); where a new picture belongs (the three-line decision of spec §9); a dialog as a component (spec §3); `framing.ts`; the traps of spec §4 with their reasons; the tolerance and its rule (spec §5) with Task 4's numbers; `pnpm visual:coverage`; one line: "The `Update visual goldens` workflow uploads the images as an artifact and commits nothing; its job summary gives the commands." The README's "Not built" loses the per-scenario tolerance and visual reach lines.
- `releaseNotes`: one entry `{ "id": "0.19.0", "notes": [...] }` carrying the six notes of spec §10, each one sentence or two, plus: "A page now defaults to 1080 pixels tall: a scenario that was drawn 720 tall sets `height: 720`."

- [ ] **Step 1:** Write them. **Step 2:** `pnpm vitest run` at the root — PASS (agent-docs, addons-listed, plugin-manifests, check:status). **Step 3: Commit** `docs(visual): the pyramid, the traps and the tolerance rule; release notes for 0.19.0`.

### Task 13: Proof — an update from the current version

**Files:**
- Create: `docs/visual-update-2026-10-17.md` (the record)

- [ ] **Step 1:** `git worktree add <scratch>/main-at-d9e338c d9e338c`; from it, create a project (`--scope @demo`), add `kit` and `visual`, `pnpm install`; then edit `visual.pw.ts` (condo-ledger's `setViewportSize({ width: scenario.width, height: 720 })`, with `width` added to its `Scenario` and its four scenarios) and add `launchOptions: { args: ["--disable-partial-raster"] }` to `playwright.config.ts`; commit in that project.
- [ ] **Step 2:** From this branch: `node scripts/add-to-project.mts <project> visual` → refuses, naming both files, and under `visual.pw.ts` says where the edit goes. Then with `--force` → `visual.pw.ts`'s copy kept; release notes printed; no example written (`git status` shows no new PNG, no `registry.tsx`); `framing.ts` written; "Yours to change" lists `seeding.ts`, `scenarios.ts`, `tolerance.ts`.
- [ ] **Step 3:** `pnpm install`, `pnpm visual` → the four scenarios fail as redrawn pages (expected); `pnpm visual:update`; look at the four images (whole app, viewport, no margin); `pnpm visual` → pass; `pnpm gate:full` → pass. A second `add-to-project` writes nothing and prints no notes.
- [ ] **Step 4:** Record each command and result in the doc. **Commit** `docs: an update of visual from 0.18.1 to 0.19.0, tried`.

### Task 14: Proof — skills-demo

- [ ] **Step 1:** In `../skills-demo` on a new branch, run the update through `extending-a-project` (as a user would), `--force` only if it refuses an edited add-on file.
- [ ] **Step 2:** Add its own scenarios at the three levels on its UI (Directory, UserList, CategoryList), including the hard case of spec §6: a card centred at a half pixel with rounded corners and a scrolling list in a `position: fixed` layer, as a component with `capture: "viewport"`.
- [ ] **Step 3:** `pnpm visual:update`, look at every image, `pnpm visual`, `pnpm visual:jitter --runs 5` → 0 differing, `pnpm visual:coverage`, `pnpm gate:full` — all pass.
- [ ] **Step 4:** Ask the user, then push and open a PR; dispatch `Update visual goldens` five times on its head; `gh run download` the five; `pnpm visual:jitter <five dirs>` → 0; commit the set; the PR's `Visual goldens` passes. Record run ids in `docs/visual-update-2026-10-17.md`.

### Task 15: The shipped `linux-x64` goldens, from a temporary repository

- [ ] **Step 1:** Create a project from this branch exactly as Task 7 Step 4, with every add-on, nothing edited by hand; `pnpm gate:full` passes.
- [ ] **Step 2:** Ask the user, then `gh repo create bettersoftware-io/skills-visual-proof --public` and push.
- [ ] **Step 3:** Dispatch `Update visual goldens` five times on one commit; download the five artifacts; `node tools/visual/jitter.mts <five dirs>` → 0 differing pixels; by checksum the copies agree.
- [ ] **Step 4:** Copy one set into `VISUAL/goldens/linux-x64/`; push that commit to the scratch repository and see `Visual goldens` pass there.
- [ ] **Step 5:** With the colour change (`#1a8f4c` → `#1a4c8f`) and a one-pixel shift in the starter's CSS, run `pnpm visual` locally: record Playwright's counts in the README's "How it was tested" and in `tolerance.ts` (spec §5's browser measurement).
- [ ] **Step 6:** Write the run ids and results into `docs/visual-update-2026-10-17.md`; update the README's "How it was tested" and `docs/STATUS.md`. Commit `feat(visual): the linux-x64 set of the new examples, drawn five times on GitHub`.
- [ ] **Step 7:** Ask the user, then `gh repo delete bettersoftware-io/skills-visual-proof --yes`.
- [ ] **Step 8:** `pnpm vitest run` at the root, every mutant spec touched by this plan run once more — PASS, all killed. Then superpowers:finishing-a-development-branch.
