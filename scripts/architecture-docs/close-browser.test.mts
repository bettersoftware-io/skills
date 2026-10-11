import { describe, expect, it } from "vitest";

import { closeBrowser, type Closable } from "./lib/close-browser.mts";

/** A browser that closes the way `close` says, and records whether it was killed. */
function createBrowser(close: () => Promise<void>, owned: boolean = true): { browser: Closable; killed: string[] } {
  const killed: string[] = [];

  return {
    killed,
    browser: {
      close,
      process: () =>
        owned
          ? {
              kill: (signal) => {
                killed.push(signal);

                return true;
              },
            }
          : null,
    },
  };
}

describe("closing the browser", () => {
  it("leaves alone a browser that closes when asked", async () => {
    const { browser, killed } = createBrowser(() => Promise.resolve());

    await closeBrowser(browser, 50);

    expect(killed).toEqual([]);
  });

  it("kills a browser that does not answer, and does not wait for it", async () => {
    const { browser, killed } = createBrowser(() => new Promise(() => {}));
    const started = Date.now();

    await closeBrowser(browser, 50);

    expect(killed).toEqual(["SIGKILL"]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("kills a browser that could not be asked", async () => {
    const { browser, killed } = createBrowser(() => Promise.reject(new Error("Protocol error: Target closed")));

    await closeBrowser(browser, 50);

    expect(killed).toEqual(["SIGKILL"]);
  });

  it("ends without an error for a browser whose process is not its own", async () => {
    const { browser, killed } = createBrowser(() => new Promise(() => {}), false);

    await closeBrowser(browser, 50);

    expect(killed).toEqual([]);
  });
});
