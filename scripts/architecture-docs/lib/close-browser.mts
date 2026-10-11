// Closing the browser a run started, so that it is always gone afterwards.

/** The two things used of a browser to end it. */
export interface Closable {
  close(): Promise<void>;
  /** The browser's own process, or null when this did not start it. */
  process(): { kill(signal: "SIGKILL"): boolean } | null;
}

/** How long a browser has to close by itself. One that is idle closes in well under a second. */
const GRACE_MS = 5000;

/**
 * Asks the browser to close, and kills it when it has not in `graceMs`, or
 * when asking failed.
 *
 * On a busy machine a browser sometimes does not answer. A script that waited
 * for it would never end, and a browser left running is the one thing a
 * person at the machine sees of all this. So the wait has an end, and the
 * browser is gone when this returns.
 */
export async function closeBrowser(browser: Closable, graceMs: number = GRACE_MS): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const closed = browser.close().then(
    () => true,
    () => false,
  );
  const waited = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), graceMs);
  });

  if (!(await Promise.race([closed, waited]))) {
    browser.process()?.kill("SIGKILL");
  }

  clearTimeout(timer);
}
