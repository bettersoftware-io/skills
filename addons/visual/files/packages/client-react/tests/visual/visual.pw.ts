import { existsSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { FRAMING } from "./framing.ts";
import {
  describeMissingGolden,
  findOrphanGoldens,
  GOLDENS_DIRECTORY,
  locateGolden,
} from "./goldens.ts";
import { HOST_URL, READY_ATTRIBUTE, ROOT_TESTID } from "./host/address.ts";
import { resolvePicture, type Tolerance } from "./host/picture.ts";
import { scenarios } from "./scenarios.ts";
import { TOLERANCE } from "./tolerance.ts";

// One test per scenario: read what the scenario says about its picture, size
// the browser to it, open the visual host on it, wait until the host says it
// is ready, and compare the root (or the viewport) with the committed image.

for (const name of Object.keys(scenarios)) {
  test(name, async ({ page }, testInfo) => {
    // Resolved here, in the test, so a scenario that contradicts itself fails
    // only its own test, with the message that names it and the field.
    const picture = resolvePicture(name, scenarios[name], FRAMING, TOLERANCE);

    // At once, so a scenario that fails later still counts under its level.
    testInfo.annotations.push({ type: "level", description: picture.level });

    const trouble = recordTrouble(page);

    // Before the page loads, so the host lays out at the picture's size from
    // the first frame, and a `vh` or a media query reads it.
    await page.setViewportSize(picture.viewport);
    await page.goto(`/?scenario=${encodeURIComponent(name)}`);

    // The one wait. The host sets this after the scenario is seeded and the
    // fonts are loaded; nothing on the page moves after it. A scenario that
    // fails in the host (a font that did not load, a mount the seeding cannot
    // render) is an uncaught error there and never says it is ready.
    await expect(
      page.locator("html"),
      "the visual host never said it was ready",
    )
      .toHaveAttribute(READY_ATTRIBUTE, "true")
      .catch((error: unknown) => {
        throw trouble.crashes.length === 0
          ? error
          : new Error(
              `the visual host threw before it was ready:\n${trouble.crashes.join("\n")}`,
            );
      });

    expect(
      trouble.crashes,
      "the visual host threw, so the picture would be of a broken page",
    ).toEqual([]);
    expect(
      trouble.requestsElsewhere,
      "the visual host reached past its own server; a scenario must not depend on a network",
    ).toEqual([]);

    if (
      testInfo.config.updateSnapshots === "none" &&
      !existsSync(locateGolden(name))
    ) {
      throw new Error(describeMissingGolden(name));
    }

    // A root capture pictures the root; a viewport capture pictures the
    // viewport, never the whole scrolling page. The scenario's own tolerance
    // is passed as resolved: it may be the project's, or a stricter or looser
    // one the scenario asked for.
    if (picture.capture === "root") {
      await expect(page.getByTestId(ROOT_TESTID)).toHaveScreenshot(
        `${name}.png`,
        screenshotTolerance(picture.tolerance),
      );
    } else {
      await expect(page).toHaveScreenshot(`${name}.png`, {
        ...screenshotTolerance(picture.tolerance),
        fullPage: false,
      });
    }
  });
}

test("every golden belongs to a scenario", () => {
  // No folder is no verdict, not a pass. The scenario tests above fail on it.
  test.skip(
    !existsSync(GOLDENS_DIRECTORY),
    `this system has no golden set at ${GOLDENS_DIRECTORY}, so there was nothing to look through`,
  );

  expect(
    findOrphanGoldens(Object.keys(scenarios)),
    "these images have no scenario of the same name: delete them, or restore the scenario",
  ).toEqual([]);
});

/**
 * Every key of the tolerance, set or not. Playwright merges the options of a
 * call with the config's `expect.toHaveScreenshot` key by key, so a key left
 * out here would take the config's value. An old project's ratio of 0 would
 * then cap a scenario that asked for a larger `maxDiffPixels` at 0 pixels.
 */
function screenshotTolerance(tolerance: Tolerance): Tolerance {
  return {
    threshold: tolerance.threshold,
    maxDiffPixels: tolerance.maxDiffPixels,
    maxDiffPixelRatio: tolerance.maxDiffPixelRatio,
  };
}

interface Trouble {
  crashes: string[];
  requestsElsewhere: string[];
}

/** Collects what would make the picture meaningless: an uncaught error, or a request that leaves the host. */
function recordTrouble(page: Page): Trouble {
  const trouble: Trouble = { crashes: [], requestsElsewhere: [] };

  page.on("pageerror", (error) => {
    trouble.crashes.push(error.message);
  });
  page.on("request", (request) => {
    if (
      !request.url().startsWith(HOST_URL) &&
      !request.url().startsWith("data:")
    ) {
      trouble.requestsElsewhere.push(request.url());
    }
  });

  return trouble;
}
