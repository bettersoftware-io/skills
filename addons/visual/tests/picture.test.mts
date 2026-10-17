import { describe, expect, it } from "vitest";

import { FRAMING } from "../files/packages/client-react/tests/visual/framing.ts";
import { describeMissingRender, PictureError, resolvePicture } from "../files/packages/client-react/tests/visual/host/picture.ts";

// What a scenario says about its picture, resolved against the project's
// framing and tolerance. Pure, so the Playwright spec and the browser host
// resolve the same fields the same way.

const GLOBAL = { threshold: 0.01, maxDiffPixels: 8 };

describe("FRAMING", () => {
  it("starts a project at a 480px root with 8px of padding and a 1920x1080 viewport", () => {
    expect(FRAMING).toEqual({ rootWidth: 480, rootPadding: 8, viewport: { width: 1920, height: 1080 } });
  });
});

describe("resolvePicture", () => {
  it("makes a scenario with no picture field a page: the whole App, a 1920x1080 viewport", () => {
    expect(resolvePicture("p", {}, FRAMING, GLOBAL)).toEqual({
      level: "page",
      capture: "viewport",
      mount: undefined,
      viewport: { width: 1920, height: 1080 },
      root: undefined,
      tolerance: { threshold: 0.01, maxDiffPixels: 8 },
    });
  });

  it("captures a component by its root, at the framing's width and padding", () => {
    const picture = resolvePicture("c", { level: "component" }, FRAMING, GLOBAL);

    expect(picture.capture).toBe("root");
    expect(picture.root).toEqual({ width: 480, padding: 8 });
    expect(picture.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it("reads the root width from the framing it is given", () => {
    const picture = resolvePicture("c", { level: "component" }, { ...FRAMING, rootWidth: 333, rootPadding: 3 }, GLOBAL);

    expect(picture.root).toEqual({ width: 333, padding: 3 });
  });

  it("takes a section's width as the root width", () => {
    expect(resolvePicture("s", { level: "section", width: 920 }, FRAMING, GLOBAL).root?.width).toBe(920);
  });

  it("takes a page's width as the viewport width (condo-ledger's shape)", () => {
    const picture = resolvePicture("w", { width: 1280 }, FRAMING, GLOBAL);

    expect(picture.level).toBe("page");
    expect(picture.viewport).toEqual({ width: 1280, height: 1080 });
  });

  it("sets the viewport from width and height for a viewport capture, with no root", () => {
    const picture = resolvePicture("v", { level: "component", capture: "viewport", width: 720, height: 560 }, FRAMING, GLOBAL);

    expect(picture.viewport).toEqual({ width: 720, height: 560 });
    expect(picture.root).toBeUndefined();
  });

  it("carries the mount", () => {
    expect(resolvePicture("m", { level: "component", mount: "PriceRow" }, FRAMING, GLOBAL).mount).toBe("PriceRow");
  });

  it("keeps the scenario's own state fields out of the way", () => {
    expect(resolvePicture("m", { prices: [1], selected: "a" }, FRAMING, GLOBAL).level).toBe("page");
  });

  describe("tolerance", () => {
    it("is the global when the scenario says nothing", () => {
      expect(resolvePicture("t", {}, FRAMING, GLOBAL).tolerance).toEqual({ threshold: 0.01, maxDiffPixels: 8 });
    });

    it("is zero pixels and zero threshold for strict", () => {
      expect(resolvePicture("t", { strict: true }, FRAMING, GLOBAL).tolerance).toEqual({ threshold: 0, maxDiffPixels: 0 });
    });

    it("takes a larger maxDiffPixels", () => {
      expect(resolvePicture("t", { maxDiffPixels: 40 }, FRAMING, GLOBAL).tolerance).toEqual({ threshold: 0.01, maxDiffPixels: 40 });
    });

    it("takes a lower pixelThreshold", () => {
      expect(resolvePicture("t", { pixelThreshold: 0.005 }, FRAMING, GLOBAL).tolerance).toEqual({ threshold: 0.005, maxDiffPixels: 8 });
    });

    it("drops an old global's ratio when the scenario sets its own cap", () => {
      expect(resolvePicture("t", { maxDiffPixels: 50 }, FRAMING, { maxDiffPixelRatio: 0, threshold: 0 }).tolerance).toStrictEqual({ threshold: 0, maxDiffPixels: 50 });
    });

    it("keeps an old global's ratio when the scenario sets only a threshold", () => {
      expect(resolvePicture("t", { pixelThreshold: 0.005 }, FRAMING, { maxDiffPixelRatio: 0, threshold: 0.01 }).tolerance).toStrictEqual({ threshold: 0.005, maxDiffPixelRatio: 0 });
    });

    it("reads an old global (a ratio, no maxDiffPixels) unchanged", () => {
      expect(resolvePicture("t", {}, FRAMING, { maxDiffPixelRatio: 0, threshold: 0 }).tolerance).toEqual({ threshold: 0, maxDiffPixelRatio: 0 });
    });

    it("counts a missing cap in the global as 0, so any positive maxDiffPixels is above it", () => {
      expect(resolvePicture("t", { maxDiffPixels: 1 }, FRAMING, { maxDiffPixelRatio: 0, threshold: 0.01 }).tolerance.maxDiffPixels).toBe(1);
      expect(() => resolvePicture("t", { maxDiffPixels: 0 }, FRAMING, { maxDiffPixelRatio: 0, threshold: 0.01 })).toThrow(PictureError);
    });
  });

  describe("fails the scenario, naming it and the field", () => {
    const cases: [string, unknown, string][] = [
      ["level", { level: "x" }, "level"],
      ["capture", { capture: "page" }, "capture"],
      ["width: a string", { width: "wide" }, "width"],
      ["width: zero", { width: 0 }, "width"],
      ["width: a fraction", { width: 12.5 }, "width"],
      ["height with a root capture", { level: "component", height: 300 }, "height"],
      ["height: a string, with a viewport capture", { height: "tall" }, "height"],
      ["strict with maxDiffPixels", { strict: true, maxDiffPixels: 40 }, "strict"],
      ["strict with pixelThreshold", { strict: true, pixelThreshold: 0.001 }, "strict"],
      ["strict: false", { strict: false }, "strict"],
      ["maxDiffPixels not above the global", { maxDiffPixels: 4 }, "maxDiffPixels"],
      ["maxDiffPixels equal to the global", { maxDiffPixels: 8 }, "maxDiffPixels"],
      ["maxDiffPixels: a string", { maxDiffPixels: "lots" }, "maxDiffPixels"],
      ["pixelThreshold not below the global", { pixelThreshold: 0.02 }, "pixelThreshold"],
      ["pixelThreshold equal to the global", { pixelThreshold: 0.01 }, "pixelThreshold"],
      ["pixelThreshold: a string", { pixelThreshold: "low" }, "pixelThreshold"],
      ["mount: empty", { mount: "" }, "mount"],
      ["mount: a number", { mount: 3 }, "mount"],
    ];

    it.each(cases)("%s", (_label, scenario, field) => {
      expect(() => resolvePicture("price-row", scenario, FRAMING, GLOBAL)).toThrow(PictureError);
      expect(() => resolvePicture("price-row", scenario, FRAMING, GLOBAL)).toThrow(/price-row/);
      expect(() => resolvePicture("price-row", scenario, FRAMING, GLOBAL)).toThrow(new RegExp(field));
    });

    it.each([null, "scenario", 4, [{}]])("a scenario that is not an object: %j", (scenario) => {
      expect(() => resolvePicture("price-row", scenario, FRAMING, GLOBAL)).toThrow(PictureError);
      expect(() => resolvePicture("price-row", scenario, FRAMING, GLOBAL)).toThrow(/price-row/);
    });
  });
});

describe("describeMissingRender", () => {
  it("names the scenario, the seeding, `render` and the template to copy from", () => {
    const message = describeMissingRender("x");

    expect(message).toContain("x");
    expect(message).toContain("seeding.ts");
    expect(message).toContain("render");
    expect(message).toContain("tools/templates/visual.packages__client-react__tests__visual__seeding.ts.txt");
  });
});
