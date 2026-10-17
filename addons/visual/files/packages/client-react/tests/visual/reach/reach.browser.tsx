import { it } from "vitest";

import { showScenario } from "../host/render.tsx";
import { scenarios } from "../scenarios.ts";

// Renders every scenario the way the visual host does, one at a time, so
// `pnpm visual:coverage` measures what the pictures show. Nothing is pictured
// and nothing is compared: a scenario fails here only when it cannot be shown.
//
// This file is the add-on's, and an update replaces it.

for (const name of Object.keys(scenarios)) {
  it(name, async () => {
    const container = document.createElement("div");

    document.body.append(container);

    try {
      const shown = await showScenario(name, container);

      try {
        await shown.ready;
      } finally {
        shown.unmount();
      }
    } finally {
      container.remove();
    }
  });
}
