import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Tolerance } from "../files/packages/client-react/tests/visual/host/picture.ts";

import { createToleranceOf, judgeNoise, measureNoise, type Measurement, scenarioNameOf } from "../files/tools/visual/lib/measure.mts";
import { BLACK, createFlatPng, createPng, type Rgba, WHITE } from "./support/createPng.mts";

describe("measureNoise", () => {
  it("finds no noise in captures that are the same", () => {
    const captures = [createCapture({ "a.png": createFlatPng(10, 10, WHITE) }), createCapture({ "a.png": createFlatPng(10, 10, WHITE) })];

    expect(measureNoise(captures, 0.2).images).toEqual([
      { image: "a.png", different: 0, total: 0, largestColourMove: 0, sizeChanged: false, ratio: 0 },
    ]);
  });

  it("keeps the worst difference of any two captures, per image", () => {
    const captures = [
      createCapture({ "a.png": createFlatPng(10, 10, WHITE) }),
      createCapture({ "a.png": createBlockPng(2) }),
      createCapture({ "a.png": createBlockPng(5) }),
    ];

    const [noise] = measureNoise(captures, 0.2).images;

    // White against a 5-row block is the largest of the three pairs.
    expect(noise).toMatchObject({ image: "a.png", different: 50, total: 100, ratio: 0.5 });
  });

  it("counts with the threshold it is given, like the tier does", () => {
    const captures = [
      createCapture({ "a.png": createFlatPng(10, 10, [200, 200, 200, 255]) }),
      createCapture({ "a.png": createFlatPng(10, 10, [210, 210, 210, 255]) }),
    ];

    expect(measureNoise(captures, 0.2).images[0]?.different).toBe(0);
    expect(measureNoise(captures, 0.01).images[0]?.different).toBe(100);
  });

  it("lists an image that is missing from one capture as not compared", () => {
    const captures = [
      createCapture({ "a.png": createFlatPng(4, 4, WHITE), "nested/b.png": createFlatPng(4, 4, WHITE) }),
      createCapture({ "a.png": createFlatPng(4, 4, WHITE) }),
    ];

    const measurement = measureNoise(captures, 0.2);

    expect(measurement.images.map((noise) => noise.image)).toEqual(["a.png"]);
    expect(measurement.incomplete).toEqual(["nested/b.png"]);
  });
});

describe("judgeNoise", () => {
  const strict = of({ maxDiffPixelRatio: 0, threshold: 0.01 });

  it("passes when no pixel differed", () => {
    const verdict = judgeNoise(createMeasurement({ different: 0, total: 0, largestColourMove: 0 }), strict);

    expect(verdict.exitCode).toBe(0);
    expect(verdict.lines.join("\n")).toContain("PASS: no pixel differed");
  });

  it("passes when the noise is below both knobs, and reports the two floors", () => {
    const verdict = judgeNoise(createMeasurement({ different: 3, total: 1000, largestColourMove: 0.004 }), of({ maxDiffPixelRatio: 0.01, threshold: 0.01 }));

    expect(verdict.exitCode).toBe(0);
    expect(verdict.lines).toContain("Noise floor for maxDiffPixelRatio: 0.003000 (set: 0.01)");
    expect(verdict.lines).toContain("Noise floor in pixels:              3");
    expect(verdict.lines).toContain("Noise floor for threshold:         0.0040 (set: 0.01)");
  });

  it("fails when the same commit differs from itself by more than the tolerance allows", () => {
    const verdict = judgeNoise(createMeasurement({ different: 3, total: 1000, largestColourMove: 0.3 }), strict);

    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines.join("\n")).toContain("the tier can fail with no change to the UI");
  });

  it("fails when an image changed size between captures, whatever the tolerance", () => {
    const verdict = judgeNoise(createMeasurement({ different: 16, total: 16, largestColourMove: 1, sizeChanged: true }), of({ maxDiffPixelRatio: 1, threshold: 1 }));

    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines.join("\n")).toContain("came out at two sizes");
  });

  it("gives no verdict on fewer than two captures, even with an image to show", () => {
    const verdict = judgeNoise({ ...createMeasurement({ different: 0, total: 0, largestColourMove: 0 }), captures: 1 }, strict);

    expect(verdict.exitCode).toBe(2);
    expect(verdict.lines.join("\n")).toContain("at least two are needed");
  });

  it("gives no verdict when the captures share no image", () => {
    const verdict = judgeNoise({ captures: 2, images: [], incomplete: ["a.png"] }, strict);

    expect(verdict.exitCode).toBe(2);
    expect(verdict.lines.join("\n")).toContain("nothing was compared");
  });

  it("gives no verdict when an image is missing from a capture, even if the rest matched", () => {
    const measurement = { ...createMeasurement({ different: 0, total: 0, largestColourMove: 0 }), incomplete: ["b.png"] };
    const verdict = judgeNoise(measurement, strict);

    expect(verdict.exitCode).toBe(2);
    expect(verdict.lines.join("\n")).toContain("b.png is not in every capture");
  });
});

describe("judgeNoise, one tolerance per image", () => {
  const global: Tolerance = { maxDiffPixels: 8, threshold: 0.01 };

  function twoImages(first: number, second: number): Measurement {
    return {
      captures: 2,
      images: [
        { image: "a.png", different: first, total: 1000, largestColourMove: 0.3, sizeChanged: false, ratio: first / 1000 },
        { image: "b.png", different: second, total: 1000, largestColourMove: 0.3, sizeChanged: false, ratio: second / 1000 },
      ],
      incomplete: [],
    };
  }

  it("lets 30 differing pixels pass for the image whose scenario allows 40, and fails the other", () => {
    const toleranceOf = (image: string): Tolerance => (image === "a.png" ? { maxDiffPixels: 40, threshold: 0.01 } : global);

    const verdict = judgeNoise(twoImages(30, 30), toleranceOf);

    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines.join("\n")).toContain("b.png");
    expect(verdict.lines.join("\n")).not.toMatch(/FAIL:.*a\.png/);
  });

  it("passes when every image is within its own cap", () => {
    const toleranceOf = (image: string): Tolerance => (image === "a.png" ? { maxDiffPixels: 40, threshold: 0.01 } : global);

    expect(judgeNoise(twoImages(30, 8), toleranceOf).exitCode).toBe(0);
  });

  it("fails an image over a strict scenario's zero, though the global would allow it", () => {
    const toleranceOf = (image: string): Tolerance => (image === "a.png" ? { maxDiffPixels: 0, threshold: 0 } : global);
    const verdict = judgeNoise(twoImages(1, 1), toleranceOf);

    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines.join("\n")).toMatch(/FAIL:.*a\.png/);
    expect(verdict.lines.join("\n")).not.toMatch(/FAIL:.*b\.png/);
  });

  it("judges an old-shape tolerance (a ratio, no pixel cap) by the ratio", () => {
    const old: Tolerance = { maxDiffPixelRatio: 0, threshold: 0 };

    expect(judgeNoise(twoImages(0, 0), () => old).exitCode).toBe(0);
    expect(judgeNoise(twoImages(0, 1), () => old).exitCode).toBe(1);
    expect(judgeNoise(twoImages(1, 1), () => ({ maxDiffPixelRatio: 0.002, threshold: 0 })).exitCode).toBe(0);
  });

  it("lets a tolerance with no cap at all allow nothing", () => {
    expect(judgeNoise(twoImages(0, 1), () => ({ threshold: 0.01 })).exitCode).toBe(1);
    expect(judgeNoise(twoImages(0, 0), () => ({ threshold: 0.01 })).exitCode).toBe(0);
  });

  it("holds an image to both caps when a tolerance sets both", () => {
    const both: Tolerance = { maxDiffPixels: 50, maxDiffPixelRatio: 0.001, threshold: 0.01 };

    expect(judgeNoise(twoImages(1, 2), () => both).exitCode).toBe(1);
  });

  it("names each image's own cap beside its floor", () => {
    const toleranceOf = (image: string): Tolerance => (image === "a.png" ? { maxDiffPixels: 40, threshold: 0.01 } : global);
    const text = judgeNoise(twoImages(3, 2), toleranceOf).lines.join("\n");

    expect(text).toContain("a.png: 3 of 1000 pixels differ");
    expect(text).toContain("allows 40");
    expect(text).toContain("allows 8");
  });
});

describe("measureNoise, one threshold per image", () => {
  it("counts each image at the threshold its function gives", () => {
    const captures = [
      createCapture({ "a.png": createFlatPng(10, 10, [200, 200, 200, 255]), "b.png": createFlatPng(10, 10, [200, 200, 200, 255]) }),
      createCapture({ "a.png": createFlatPng(10, 10, [210, 210, 210, 255]), "b.png": createFlatPng(10, 10, [210, 210, 210, 255]) }),
    ];
    const images = measureNoise(captures, (image) => (image === "a.png" ? 0.2 : 0.01)).images;

    expect(images.map((noise) => noise.different)).toEqual([0, 100]);
  });
});

describe("createToleranceOf", () => {
  const framing = { rootWidth: 480, rootPadding: 8, viewport: { width: 100, height: 100 } };
  const scenarios = { plain: {}, "plain-wide": {}, loose: { maxDiffPixels: 40 }, tight: { strict: true as const } };
  const global: Tolerance = { maxDiffPixels: 8, threshold: 0.01 };

  it("resolves each image by its own scenario", () => {
    const toleranceOf = createToleranceOf(scenarios, framing, global);

    expect(toleranceOf("plain.png")).toEqual(global);
    expect(toleranceOf("loose.png")).toEqual({ maxDiffPixels: 40, threshold: 0.01 });
    expect(toleranceOf("tight.png")).toEqual({ maxDiffPixels: 0, threshold: 0 });
  });

  it("judges an image no scenario owns by the global tolerance", () => {
    expect(createToleranceOf(scenarios, framing, global)("orphan.png")).toEqual(global);
  });

  it("still reads an old tolerance.ts: a ratio of 0, and a scenario's cap replaces it", () => {
    const old: Tolerance = { maxDiffPixelRatio: 0, threshold: 0 };
    const toleranceOf = createToleranceOf({ plain: {}, loose: { maxDiffPixels: 40 } }, framing, old);

    expect(toleranceOf("plain.png")).toEqual(old);
    expect(toleranceOf("loose.png")).toEqual({ maxDiffPixels: 40, threshold: 0 });
  });

  it("refuses a scenario that contradicts itself, naming it", () => {
    expect(() => createToleranceOf({ bad: { maxDiffPixels: 2 } }, framing, global)).toThrow(/Scenario "bad"/);
  });
});

describe("scenarioNameOf", () => {
  it("drops the .png, and keeps a nested path whole so it matches nothing", () => {
    expect(scenarioNameOf("price-row-up.png")).toBe("price-row-up");
    expect(scenarioNameOf("linux-x64/price-row-up.png")).toBe("linux-x64/price-row-up");
  });
});

const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A folder of images, as one run of the tier leaves it. */
function createCapture(images: Record<string, Buffer>): string {
  const directory = mkdtempSync(join(tmpdir(), "visual-capture-"));

  scratch.push(directory);

  for (const [name, bytes] of Object.entries(images)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), bytes);
  }

  return directory;
}

/** White, 10 by 10, with the top `rows` rows black. */
function createBlockPng(rows: number): Buffer {
  return createPng(10, 10, (_x, y): Rgba => (y < rows ? BLACK : WHITE));
}

function createMeasurement(noise: { different: number; total: number; largestColourMove: number; sizeChanged?: boolean }): Measurement {
  return {
    captures: 2,
    images: [{ image: "a.png", sizeChanged: false, ...noise, ratio: noise.total === 0 ? 0 : noise.different / noise.total }],
    incomplete: [],
  };
}

/** A fixed tolerance for every image. */
function of(tolerance: Tolerance): (image: string) => Tolerance {
  return () => tolerance;
}
