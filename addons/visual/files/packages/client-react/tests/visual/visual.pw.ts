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
import { resolvePicture } from "./host/picture.ts";
import { scenarios } from "./scenarios.ts";
import { TOLERANCE } from "./tolerance.ts";

// One test per scenario: open the visual host on it, wait until the host says
// it is ready, and compare the root (or the page) with the committed image.

for (const name of Object.keys(scenarios)) {
  test(name, async ({ page }, testInfo) => {
    const trouble = recordTrouble(page);

    await page.goto(`/?scenario=${encodeURIComponent(name)}`);

    const picture = resolvePicture(name, scenarios[name], FRAMING, TOLERANCE);

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

    // A root capture pictures the root; a viewport capture pictures the page.
    if (picture.capture === "root") {
      await expect(page.getByTestId(ROOT_TESTID)).toHaveScreenshot(
        `${name}.png`,
      );
    } else {
      await expect(page).toHaveScreenshot(`${name}.png`);
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
