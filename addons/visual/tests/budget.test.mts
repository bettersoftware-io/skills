// The default tolerance is a small insurance budget. These tests hold it from
// both sides, without a browser: it must hide a one- or two-level shading
// wobble, and it must still count each reference regression. Raising a default
// until a regression slips through fails here.

import { describe, expect, it } from "vitest";

import { TOLERANCE } from "../files/packages/client-react/tests/visual/tolerance.ts";
import { comparePixels } from "../files/tools/visual/lib/pixelDiff.mts";
import { decodePng, type Image } from "../files/tools/visual/lib/png.mts";
import { createPng, type Rgba, WHITE } from "./support/createPng.mts";

const WIDTH = 480;
const HEIGHT = 48;
const INK: Rgba = [34, 34, 34, 255];
const EDGE: Rgba = [150, 150, 150, 255];
const GREEN: Rgba = [0x1a, 0x8f, 0x4c, 255];
const BLUE: Rgba = [0x1a, 0x4c, 0x8f, 255];
const LOW_CONTRAST: Rgba = [0xd9, 0xd9, 0xd9, 255];
const BORDER: Rgba = [0x88, 0x88, 0x88, 255];
const BUDGET = TOLERANCE.maxDiffPixels ?? 0;

/** The colour a layer paints at a pixel, or nothing to let the layer below show. */
type Paint = (x: number, y: number) => Rgba | undefined;

type Box = readonly [left: number, top: number, width: number, height: number];

function within(x: number, y: number, [left, top, width, height]: Box): boolean {
  return x >= left && x < left + width && y >= top && y < top + height;
}

/** A row of text-like strokes: 2 px stems with a grey column beside each, 12 px tall, every 6 px. */
const text: Paint = (x, y) => {
  if (!within(x, y, [8, 10, 332, 12])) {
    return undefined;
  }

  const column = (x - 8) % 6;

  if (column === 1 || column === 2) {
    return INK;
  }

  return column === 0 || column === 3 ? EDGE : undefined;
};

/** 83 pixels: four stems of 2x10 and a run of three. */
function glyphArea(colour: Rgba): Paint {
  return (x, y) => {
    const stem = within(x, y, [360, 28, 24, 10]) && (x - 360) % 6 < 2;
    const run = within(x, y, [360, 40, 3, 1]);

    return stem || run ? colour : undefined;
  };
}

const line = (colour: Rgba): Paint => (x, y) => (within(x, y, [100, 44, 120, 1]) ? colour : undefined);
const icon: Paint = (x, y) => (within(x, y, [420, 20, 4, 4]) ? INK : undefined);

/** A 60x20 box with a 1 px border, its left edge at `left`. */
function box(left: number): Paint {
  return (x, y) => {
    const onBorder = x === left || x === left + 59 || y === 26 || y === 45;

    return within(x, y, [left, 26, 60, 20]) && onBorder ? BORDER : undefined;
  };
}

function picture(...layers: Paint[]): Image {
  return decodePng(
    createPng(WIDTH, HEIGHT, (x, y) => {
      for (const layer of layers) {
        const colour = layer(x, y);

        if (colour !== undefined) {
          return colour;
        }
      }

      return WHITE;
    }),
  );
}

function counted(before: Image, after: Image): number {
  return comparePixels(before, after, TOLERANCE.threshold).different;
}

/** Pixels that differ at all, whatever the threshold. */
function changed(before: Image, after: Image): number {
  let total = 0;

  for (let at = 0; at < before.data.length; at += 4) {
    if (before.data[at] !== after.data[at] || before.data[at + 1] !== after.data[at + 1] || before.data[at + 2] !== after.data[at + 2]) {
      total += 1;
    }
  }

  return total;
}

const regressions = [
  {
    name: "catches the starter's up colour turned blue",
    before: picture(glyphArea(GREEN), text),
    after: picture(glyphArea(BLUE), text),
    changed: 83,
  },
  {
    name: "catches a one-pixel line of low contrast removed",
    before: picture(line(LOW_CONTRAST), text),
    after: picture(text),
    changed: 120,
  },
  { name: "catches a 4x4 icon removed", before: picture(icon, text), after: picture(text), changed: 16 },
  {
    name: "catches a bordered box moved by one pixel",
    before: picture(box(400), text),
    after: picture(box(401), text),
    changed: 76,
  },
];

describe("the default tolerance", () => {
  for (const regression of regressions) {
    it(regression.name, () => {
      const count = counted(regression.before, regression.after);

      process.stdout.write(`budget: ${regression.name}: changed ${changed(regression.before, regression.after)}, counted ${count}\n`);

      expect(changed(regression.before, regression.after)).toBe(regression.changed);
      expect(count).toBeGreaterThan(BUDGET);
    });
  }

  it("lets through a one- or two-level shading wobble", () => {
    const shade = (level: number): Paint => (x, y) => (within(x, y, [0, 0, 8, 5]) ? [level, level, level, 255] : undefined);
    const before = picture(shade(200), text);
    const after = picture(shade(202), text);

    expect(changed(before, after)).toBe(40);
    expect(counted(before, after)).toBe(0);
  });

  it("keeps the budget at most half the smallest regression", () => {
    const counts = regressions.map(({ before, after }) => counted(before, after));

    expect(BUDGET * 2).toBeLessThanOrEqual(Math.min(...counts));
  });
});
