import { describe, expect, it } from "vitest";

import { loadEveryFace } from "../files/packages/client-react/tests/visual/host/fonts.ts";

// The host must not take a picture before every face the page declares has
// loaded, and a face that cannot load must fail the scenario, never leave a
// picture drawn in a fallback font.

interface FakeFace {
  family: string;
  weight: string;
  style: string;
  load: () => Promise<unknown>;
}

function createFace(family: string, weight: string, log: string[], failure?: string): FakeFace {
  return {
    family,
    weight,
    style: "normal",
    load: async () => {
      log.push(`load ${family} ${weight}`);

      if (failure !== undefined) {
        throw new Error(failure);
      }

      return undefined;
    },
  };
}

function createSet(faces: FakeFace[], log: string[]): Iterable<FakeFace> & { ready: Promise<unknown> } {
  return {
    [Symbol.iterator]: () => faces[Symbol.iterator](),
    ready: Promise.resolve().then(() => {
      log.push("ready");
    }),
  };
}

describe("loadEveryFace", () => {
  it("loads each of the three faces, then waits for ready", async () => {
    const log: string[] = [];
    const set = createSet([createFace("Inter", "400", log), createFace("Inter", "700", log), createFace("Mono", "400", log)], log);

    await loadEveryFace(set);

    expect(log.filter((entry) => entry.startsWith("load")).sort()).toEqual(["load Inter 400", "load Inter 700", "load Mono 400"]);
    expect(log.at(-1)).toBe("ready");
  });

  it("does not resolve before ready does", async () => {
    let release: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let done = false;
    const pending = loadEveryFace({ [Symbol.iterator]: () => [][Symbol.iterator](), ready }).then(() => {
      done = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(done).toBe(false);
    release();
    await pending;
    expect(done).toBe(true);
  });

  it("fails naming the family, weight, style and reason of a face that did not load", async () => {
    const log: string[] = [];
    const set = createSet([createFace("Inter", "400", log), createFace("Inter", "700", log, "network error")], log);

    await expect(loadEveryFace(set)).rejects.toThrow("the font Inter 700 normal did not load: network error");
  });

  it("resolves for a page that declares no faces", async () => {
    await expect(loadEveryFace(createSet([], []))).resolves.toBeUndefined();
  });
});
