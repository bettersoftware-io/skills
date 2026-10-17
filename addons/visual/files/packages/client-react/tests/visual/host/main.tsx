import { READY_ATTRIBUTE } from "./address.ts";
import { type Shown, showScenario } from "./render.tsx";

// Shows the one scenario named in the address (`/?scenario=app`), then
// says it is ready.
//
// A failure is not caught here. A scenario that is unknown, contradicts
// itself, mounts what the seeding cannot render or names a font that did not
// load rejects `showScenario`; the rejection reaches the page as an uncaught
// error, which the spec fails the test on. The ready attribute is set only
// after the scenario is up, so a failed one is never pictured.
//
// This file is the add-on's, and an update replaces it.

const name = new URLSearchParams(window.location.search).get("scenario");
const container = document.getElementById("root");

if (container === null) {
  throw new Error("the visual host's index.html has no #root element");
}

const shown: Shown = await showScenario(name ?? "", container);

await shown.ready;

document.documentElement.setAttribute(READY_ATTRIBUTE, "true");
