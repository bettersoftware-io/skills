import FakeTimers from "@sinonjs/fake-timers";
import { createRoot } from "react-dom/client";

// biome-ignore format: this file is the add-on's, and an update compares it byte for byte. The scope in this line is the project's, and a longer one would have the formatter wrap it.
import { createViewModel, ViewModelProvider } from "@app/react-bindings";

// The app's real global stylesheet, loaded the way src/main.tsx loads it. This
// is the one place the host loads it. A copy of its rules here would drift,
// and the goldens would be of a page that does not exist.
import "#/index.css";
import { App } from "#/ui/App.tsx";

import { FRAMING } from "../framing.ts";
import { type Scenario, scenarios } from "../scenarios.ts";
import { seedScenario } from "../seeding.ts";
import { TOLERANCE } from "../tolerance.ts";
import { loadEveryFace } from "./fonts.ts";
import {
  describeMissingRender,
  PictureError,
  resolvePicture,
} from "./picture.ts";
import { ScenarioFrame } from "./ScenarioFrame.tsx";
import type { HostClock, Seeded } from "./seeded.ts";

// The visual host's one job: show a scenario, faithfully, and say when it is
// ready.
//
// - State comes from the project's seeding (`../seeding.ts`), by hand, through
//   the app harness. There is no simulator, no server and no network.
// - What is shown is the element the seeding returns, or the whole `App` when
//   it returns none. A component or section is shown in a root of a fixed
//   width; a page or a dialog is shown bare, with no frame, padding or margin.
// - Time is a clock this page owns. It moves only when the seeding says a wait
//   has passed, so no timer ever fires on its own and a slow machine takes the
//   same picture as a fast one.
// - Nothing is drawn before every font face the stylesheets declare has
//   loaded. A face that fails fails the scenario.
//
// This file is the add-on's, and an update replaces it. Nothing here knows
// what a scenario holds: a new field of `Scenario` is delivered in
// `../seeding.ts`, which is the project's.

/** Any fixed moment. The UI shows no date today; if it ever does, the goldens will not change by the hour. */
const NOW = new Date("2026-01-01T12:00:00Z");

/** A scenario on screen. `ready` resolves once its state is in. */
export interface Shown {
  ready: Promise<void>;
  unmount: () => void;
}

export async function showScenario(
  name: string,
  container: HTMLElement,
): Promise<Shown> {
  const scenario: Scenario | undefined = (
    scenarios as Record<string, Scenario>
  )[name];

  if (scenario === undefined) {
    throw new Error(
      `No scenario called "${name}". The address needs ?scenario=<name>, one of: ${Object.keys(scenarios).join(", ")}`,
    );
  }

  const picture = resolvePicture(name, scenario, FRAMING, TOLERANCE);

  // Only the timer functions and the date are replaced. React's own scheduling
  // is left alone, so rendering is not held up by the stopped clock.
  const clock = FakeTimers.install({
    now: NOW,
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });

  try {
    // After the clock is installed: whatever the seeding builds reads this clock.
    const hostClock: HostClock = {
      tick: (milliseconds: number): void => {
        clock.tick(milliseconds);
      },
    };

    const seeded: Seeded = seedScenario(scenario, hostClock);

    if (picture.mount !== undefined && seeded.render === undefined) {
      throw new PictureError(describeMissingRender(name));
    }

    // Before the first render: a face still loading would be drawn in a
    // fallback face, and the glyphs would swap in after the picture.
    await loadEveryFace(document.fonts);

    const root = createRoot(container);

    // The executor runs at once, so the render starts here; the promise
    // resolves when the frame has put the state in.
    const ready = new Promise<void>((resolve) => {
      root.render(
        <ViewModelProvider viewModel={createViewModel(seeded.app)}>
          <ScenarioFrame
            seed={seeded.deliver}
            root={picture.root}
            onReady={resolve}
          >
            {seeded.render?.() ?? <App />}
          </ScenarioFrame>
        </ViewModelProvider>,
      );
    });

    return {
      ready,
      unmount: () => {
        root.unmount();
        clock.uninstall();
      },
    };
  } catch (error) {
    clock.uninstall();

    throw error;
  }
}
