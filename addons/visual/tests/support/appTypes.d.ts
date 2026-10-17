// The two app packages `scenarios.ts` takes types from. A project has them;
// this repository does not, and `pnpm typecheck` follows `jitter.mts` into
// `scenarios.ts`. Only the shapes the starting scenarios use are declared.
// Node strips these imports (they are `import type`), so nothing of the app is
// loaded when `pnpm visual:jitter` runs.

declare module "@app/domain" {
  export interface Price {
    symbol: string;
    mid: number;
  }
}

declare module "@app/client-core" {
  export interface PriceRow {
    symbol: string;
    mid: number;
    movement: "up" | "down" | "flat";
    stale: boolean;
  }
}
