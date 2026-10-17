import type { PriceRow } from "@app/client-core";
import type { Price } from "@app/domain";

import type { Picture } from "./host/picture.ts";

/**
 * One picture: a name and the state the screen is in when it is taken. The
 * state is data, never a click. The visual host turns it into deliveries on
 * the app harness, so the real presenters decide what the rows look like.
 *
 * The fields of `Picture` say what is pictured: `level`, `mount` (a key of
 * `registry.tsx`; none is the whole app), `capture`, `width`, `height` and the
 * tolerance. A scenario with none of them is a page: the whole app in a
 * 1920x1080 viewport.
 */
export interface Scenario extends Picture {
  /**
   * Prices that arrived long enough ago for their rows to have gone stale.
   * Delivered first, in order; then the stale wait passes on the host's clock.
   */
  stalePrices?: readonly Price[];
  /**
   * Prices that have just arrived, in order. A second price for a symbol shows
   * as a movement against the first.
   */
  prices: readonly Price[];
  /** The symbol of the row that is selected. */
  selected?: string;
  /** The row a `price-row` mount shows, as the presenter hands it over. */
  row?: PriceRow;
}

/** Two symbols that have each moved once: EURUSD up, GBPUSD down. */
const MOVES: readonly Price[] = [
  { symbol: "EURUSD", mid: 1.1 },
  { symbol: "GBPUSD", mid: 1.25 },
  { symbol: "EURUSD", mid: 1.1012 },
  { symbol: "GBPUSD", mid: 1.2488 },
];

const USDJPY: Price = { symbol: "USDJPY", mid: 151.2 };

/**
 * Every scenario, keyed by name. The name is the golden's file name
 * (`goldens/<platform>/<name>.png`) and the test's title, so keep it short,
 * lower-case and dashed, and start it with what is pictured. Each scenario
 * needs a golden on every platform that runs the tier; `pnpm visual` says
 * which are missing.
 *
 * The shape to keep is a pyramid. Many components, one scenario for each state
 * that matters. A few sections, for how the parts sit together. A page or two,
 * for the whole app at a size that matters.
 */
export const scenarios: Record<string, Scenario> = {
  // Components: one row, from props, in each state the presenter gives one.
  "price-row-up": {
    level: "component",
    mount: "price-row",
    prices: [],
    row: { symbol: "EURUSD", mid: 1.1012, movement: "up", stale: false },
  },
  "price-row-down": {
    level: "component",
    mount: "price-row",
    prices: [],
    row: { symbol: "GBPUSD", mid: 1.2488, movement: "down", stale: false },
  },
  "price-row-flat": {
    level: "component",
    mount: "price-row",
    prices: [],
    row: { symbol: "USDJPY", mid: 151.2, movement: "flat", stale: false },
  },
  "price-row-selected": {
    level: "component",
    mount: "price-row",
    prices: [],
    row: { symbol: "GBPUSD", mid: 1.2488, movement: "down", stale: false },
    selected: "GBPUSD",
  },
  "price-row-stale": {
    level: "component",
    mount: "price-row",
    prices: [],
    row: { symbol: "USDJPY", mid: 151.2, movement: "flat", stale: true },
  },
  "price-list-empty": {
    level: "component",
    mount: "price-list",
    prices: [],
  },

  // Sections: the list on the real presenters, rows side by side.
  "price-list-moving": {
    level: "section",
    mount: "price-list",
    prices: [...MOVES, USDJPY],
  },
  "price-list-selected": {
    level: "section",
    mount: "price-list",
    prices: [...MOVES, USDJPY],
    selected: "GBPUSD",
  },

  // Page: the whole app, once, at the framing's viewport.
  app: {
    prices: [...MOVES, USDJPY],
  },
};
