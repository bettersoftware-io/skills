// The noise measurement: the same commit captured several times, every capture
// compared with every other, and the worst difference per image kept. That
// worst case is what the tier's tolerance has to sit above.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { comparePixels, type PixelDifference } from "./pixelDiff.mts";
import { decodePng } from "./png.mts";

import { type Framing, resolvePicture, type Tolerance } from "../../../packages/client-react/tests/visual/host/picture.ts";

export interface ImageNoise extends PixelDifference {
  /** The image's path inside each capture, e.g. `row-stale.png`. */
  image: string;
  /** Share of the image's pixels that count as different, 0 to 1. */
  ratio: number;
}

export interface Measurement {
  captures: number;
  /** One entry per image found in every capture, with its worst pairwise difference. */
  images: ImageNoise[];
  /** Images found in some captures but not all. They could not be compared. */
  incomplete: string[];
}

export interface Verdict {
  /** 0: measured, and the tolerance sits above the noise. 1: it does not. 2: nothing could be measured. */
  exitCode: 0 | 1 | 2;
  lines: string[];
}

/** Every PNG under `directory`, keyed by its path from there. A missing folder holds none. */
export function listPngs(directory: string): Map<string, string> {
  const found = new Map<string, string>();

  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".png")) {
        found.set(relative(directory, path).split(sep).join("/"), path);
      }
    }
  }

  if (existsSync(directory)) {
    walk(directory);
  }

  return found;
}

/** The name of the scenario an image belongs to: the golden's file name without `.png`. */
export function scenarioNameOf(image: string): string {
  return image.endsWith(".png") ? image.slice(0, -".png".length) : image;
}

/**
 * The tolerance each image is judged by: the one its scenario resolves to, as
 * the Playwright spec resolves it. An image no scenario owns (an orphan, or a
 * folder of another layout) is judged by the global one. Throws `PictureError`
 * for a scenario that contradicts itself, naming it.
 */
export function createToleranceOf(scenarios: Record<string, unknown>, framing: Framing, global: Tolerance): (image: string) => Tolerance {
  const resolved = new Map<string, Tolerance>();

  for (const [name, scenario] of Object.entries(scenarios)) {
    resolved.set(name, resolvePicture(name, scenario, framing, global).tolerance);
  }

  return (image) => resolved.get(scenarioNameOf(image)) ?? global;
}

/** Counts pixels at one threshold, or at the threshold of each image's own scenario. */
export function measureNoise(directories: string[], threshold: number | ((image: string) => number)): Measurement {
  const captures = directories.map(listPngs);
  const everyImage = [...new Set(captures.flatMap((capture) => [...capture.keys()]))].sort();
  const shared = everyImage.filter((image) => captures.every((capture) => capture.has(image)));

  return {
    captures: directories.length,
    images: shared.map((image) => worstDifference(image, captures, typeof threshold === "number" ? threshold : threshold(image))),
    incomplete: everyImage.filter((image) => !shared.includes(image)),
  };
}

function worstDifference(image: string, captures: Map<string, string>[], threshold: number): ImageNoise {
  const files = captures.map((capture) => readFileSync(capture.get(image) as string));
  let worst: PixelDifference = { different: 0, total: 0, largestColourMove: 0, sizeChanged: false };

  for (let first = 0; first < files.length; first += 1) {
    for (let second = first + 1; second < files.length; second += 1) {
      const one = files[first] as Buffer;
      const other = files[second] as Buffer;

      // Most captures of one commit are the same bytes, and need no decoding.
      if (one.equals(other)) {
        continue;
      }

      const difference = comparePixels(decodePng(one), decodePng(other), threshold);

      worst = {
        different: Math.max(worst.different, difference.different),
        total: Math.max(worst.total, difference.total),
        largestColourMove: Math.max(worst.largestColourMove, difference.largestColourMove),
        sizeChanged: worst.sizeChanged || difference.sizeChanged,
      };
    }
  }

  return { image, ...worst, ratio: worst.total === 0 ? 0 : worst.different / worst.total };
}

/** True when the image's worst difference is more than its tolerance allows. A tolerance with neither cap allows nothing. */
function exceeds(noise: ImageNoise, tolerance: Tolerance): boolean {
  const { maxDiffPixels, maxDiffPixelRatio } = tolerance;

  if (maxDiffPixels === undefined && maxDiffPixelRatio === undefined) {
    return noise.different > 0;
  }

  return (
    (maxDiffPixels !== undefined && noise.different > maxDiffPixels) ||
    (maxDiffPixelRatio !== undefined && noise.ratio > maxDiffPixelRatio)
  );
}

/** The caps a tolerance sets, in words. */
function describeAllowed(tolerance: Tolerance): string {
  const caps: string[] = [];

  if (tolerance.maxDiffPixels !== undefined) {
    caps.push(`${tolerance.maxDiffPixels} pixels`);
  }

  if (tolerance.maxDiffPixelRatio !== undefined) {
    caps.push(`ratio ${tolerance.maxDiffPixelRatio}`);
  }

  return `allows ${caps.length === 0 ? "0 pixels" : caps.join(" and ")}`;
}

/** The image with the largest value of `measure`, the first one on a tie. */
function worstOf(images: ImageNoise[], measure: (noise: ImageNoise) => number): ImageNoise {
  return images.reduce((worst, noise) => (measure(noise) > measure(worst) ? noise : worst));
}

/**
 * Says whether each image's tolerance stands on the measurement. Every image is
 * judged by the tolerance `toleranceOf` gives it, so a scenario that asked for
 * more (or less) than the global is held to what it asked for. A measurement
 * of nothing is exit 2, never a pass.
 */
export function judgeNoise(measurement: Measurement, toleranceOf: (image: string) => Tolerance): Verdict {
  if (measurement.captures < 2) {
    return { exitCode: 2, lines: ["No measurement: noise is a difference between captures, so at least two are needed."] };
  }

  if (measurement.images.length === 0) {
    return { exitCode: 2, lines: ["No measurement: the captures have no image in common, so nothing was compared."] };
  }

  const lines = [
    `${measurement.captures} captures, ${measurement.images.length} image(s) compared, each at its own scenario's threshold.`,
    "",
    ...measurement.images.map((noise) => describeImage(noise, toleranceOf(noise.image))),
    "",
  ];

  if (measurement.incomplete.length > 0) {
    return {
      exitCode: 2,
      lines: [
        ...lines,
        `No verdict: ${measurement.incomplete.join(", ")} is not in every capture, so it was not compared. A capture run failed part-way, or the captures are of different commits.`,
      ],
    };
  }

  const resized = measurement.images.filter((image) => image.sizeChanged);
  const over = measurement.images.filter((image) => exceeds(image, toleranceOf(image.image)));
  const worstPixels = worstOf(measurement.images, (noise) => noise.different);
  const worstRatio = worstOf(measurement.images, (noise) => noise.ratio);
  const largestMove = worstOf(measurement.images, (noise) => noise.largestColourMove);
  const pixelsSet = toleranceOf(worstPixels.image).maxDiffPixels;
  const ratioSet = toleranceOf(worstRatio.image).maxDiffPixelRatio;

  lines.push(`Noise floor in pixels:              ${worstPixels.different}${pixelsSet === undefined ? "" : ` (set: ${pixelsSet})`}`);

  if (measurement.images.some((image) => toleranceOf(image.image).maxDiffPixelRatio !== undefined)) {
    lines.push(`Noise floor for maxDiffPixelRatio: ${formatRatio(worstRatio.ratio)}${ratioSet === undefined ? "" : ` (set: ${ratioSet})`}`);
  }

  lines.push(
    `Noise floor for threshold:         ${formatThreshold(largestMove.largestColourMove)} (set: ${toleranceOf(largestMove.image).threshold})`,
    "",
  );

  if (resized.length > 0) {
    return {
      exitCode: 1,
      lines: [
        ...lines,
        `FAIL: ${resized.map((image) => image.image).join(", ")} came out at two sizes from one commit. That is not noise: the scenario is not deterministic. Pin what moves (a timer, an animation, a font that loads late) before trusting any tolerance.`,
      ],
    };
  }

  if (over.length > 0) {
    return {
      exitCode: 1,
      lines: [
        ...lines,
        `FAIL: ${over.map((image) => image.image).join(", ")} differ(s) from itself by more than its tolerance allows, so the tier can fail with no change to the UI.`,
        "Look at the images that differ first. If one scenario moves, pin its frame; a tolerance cannot make it trustworthy.",
        "Only if the difference is rendering noise, raise that scenario's `maxDiffPixels` (or the global in tolerance.ts) to just above its floor and write this measurement beside it.",
      ],
    };
  }

  return {
    exitCode: 0,
    lines: [
      ...lines,
      worstPixels.different === 0 && largestMove.largestColourMove === 0
        ? "PASS: no pixel differed between captures. The tolerance is not hiding any noise here; anything above zero is headroom for machines this run did not see."
        : "PASS: every image's tolerance sits above its measured noise.",
      "This is the floor on this machine only. CI's floor is measured from several runs of the update workflow on one commit.",
    ],
  };
}

function describeImage(noise: ImageNoise, tolerance: Tolerance): string {
  if (noise.sizeChanged) {
    return `  ${noise.image}: size changed between captures`;
  }

  if (noise.largestColourMove === 0) {
    return `  ${noise.image}: identical in every capture`;
  }

  return `  ${noise.image}: ${noise.different} of ${noise.total} pixels differ (ratio ${formatRatio(noise.ratio)}, ${describeAllowed(tolerance)}); largest colour move ${formatThreshold(noise.largestColourMove)}`;
}

function formatRatio(ratio: number): string {
  return ratio === 0 ? "0" : ratio.toFixed(6);
}

function formatThreshold(move: number): string {
  return move === 0 ? "0" : move.toFixed(4);
}
