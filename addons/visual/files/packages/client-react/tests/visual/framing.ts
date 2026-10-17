// The numbers a scenario falls back on when it does not say. These are where
// the project starts, not rules: change them here (never in an add-on file) to
// suit what you build. Wide grids or deep shadows may want a wider root or
// more padding; a different target screen wants another viewport.
//
//   rootWidth     width of a component or section root capture, in CSS pixels
//   rootPadding   margin around the root inside the capture, so shadows show
//   viewport      the browser window for a page, or a viewport capture
import type { Framing } from "./host/picture.ts";

export const FRAMING: Framing = {
  rootWidth: 480,
  rootPadding: 8,
  viewport: { width: 1920, height: 1080 },
};
