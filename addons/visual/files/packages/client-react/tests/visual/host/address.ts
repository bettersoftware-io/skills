/** Where the visual host is served. The host's Vite config and the Playwright config both read it. */
export const HOST = "127.0.0.1";
export const PORT = 4319;
export const HOST_URL = `http://${HOST}:${PORT}`;

/** The element a component or section is pictured in: a fixed width, a content height. Absent for a viewport capture. */
export const ROOT_TESTID = "scenario-root";

/** Set on `<html>` to "true" once the scenario is seeded and the fonts are loaded. A failed scenario never sets it. */
export const READY_ATTRIBUTE = "data-visual-ready";
