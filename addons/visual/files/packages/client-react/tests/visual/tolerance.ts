// The one place the visual tier's tolerance is set. The Playwright config and
// `pnpm visual:jitter` both read it from here.
//
// There are two knobs, and they hide different things:
//
//   threshold       how far ONE pixel's colour may move before that pixel
//                   counts as different (0 = any move counts, 1 = nothing
//                   ever does). It is applied first.
//   maxDiffPixels   how many pixels may count as different before the test
//                   fails. An absolute number, not a share: a share is blind
//                   on a large capture, and every number here is about pixels.
//
// Zero is not strict by itself. Playwright's default threshold is 0.2, and at
// 0.2 a pixel can change a great deal and not count. Measured on the starter's
// price list: the "up" colour changed from green (#1a8f4c) to blue (#1a4c8f)
// counts 0 pixels at 0.2 and 83 at 0.01. Set both on purpose.
//
// These are the starting values: a small insurance budget above a noise floor
// that measured zero (the same commit captured 5 times on darwin-arm64 and on
// linux-x64 in the pinned Playwright container, every image byte-identical).
// Why 8 and 0.01: a step of 1 or 2 levels on every channel moves a pixel by
// less than the threshold limit (about 3.5 on pixelmatch's scale at 0.01), so
// it is hidden; 3 levels or more counts. The budget is held by reference
// regressions in addons/visual/tests/budget.test.mts, built as 480x48 images
// beside a row of text-like strokes. Hard-edged shapes count every changed
// pixel; shapes with smoothed edges (several grey levels on the rim) lose the
// rim pixels that pixelmatch takes for anti-aliasing. Changed pixels, counted
// at these values:
//   up colour #1a8f4c to #1a4c8f over an 83-pixel glyph area   83 changed, 83 counted
//   the same change on two smoothed rings (14 px across)       280 changed, 160 counted
//   a 1x120 line of #d9d9d9 on white removed                   120 changed, 120 counted
//   a 4x4 hard-edged icon removed                               16 changed, 16 counted
//   a 6x6 smoothed round icon removed                           32 changed, 16 counted
//   a 60x20 box with a 1px #888 border moved right by one       76 changed, 76 counted
//   40 pixels moved by 2 levels on each channel                 40 changed, 0 counted
// The smallest regression is 16, and the budget is at most half of it. The
// pairs model hard and smoothed edges; they are not captures of real text.
// If a machine nobody measured draws a pixel differently, a test will fail with
// nothing changed. Do not raise a number to make it pass. Measure first:
// capture one commit several times (`pnpm visual:jitter --runs 5` on your
// machine; for CI, several runs of the update workflow, then
// `pnpm visual:jitter <dirA> <dirB> ...`), set each number just above the
// floor it reports, and write the measurement here.
//
// A scenario may differ from these, in `scenarios.ts`:
//
//   strict           zero pixels and zero threshold; exclusive with the two below
//   maxDiffPixels    a larger cap than the one here (it must be above it)
//   pixelThreshold   a lower threshold than the one here (it must be below it)
//
// Each needs a `pnpm visual:jitter` measurement of that scenario and the
// mechanism understood, both written in a comment at the scenario. Looser than
// this file only for a measured, understood difference. Tighter (`strict`, a
// lower `pixelThreshold`) whenever the global could hide a change that matters
// there.
import type { Tolerance } from "./host/picture.ts";

export const TOLERANCE: Tolerance = {
  maxDiffPixels: 8,
  threshold: 0.01,
};
