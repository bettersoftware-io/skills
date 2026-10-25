// The change under review: each price shows, on hover, when it arrived, and
// the time comes from a `Clock` so that a test can fix it. The clock is a
// port, and the change declares it in `packages/shared`, the package of the
// wire protocol. A port belongs in the domain's ports folder (question 1 of
// the review). The core may import `shared`, so no gate looks at it, and an
// interface beside a "shared utility" reads as tidy.
//
// Run by fixture.sh in a project just created. It fails, so the run scores 0
// and says why, when the starter no longer has a line it changes.

import { readFileSync, writeFileSync } from "node:fs";

/** Replaces `before` in `file`, which must hold it exactly once. */
function edit(file: string, before: string, after: string): void {
  const source = readFileSync(file, "utf8");

  if (source.split(before).length !== 2) {
    throw new Error(`${file} no longer holds, once, the text this change follows: ${before.trim().split("\n")[0]}`);
  }

  writeFileSync(file, source.replace(before, after));
}

writeFileSync(
  "packages/shared/src/clock.ts",
  [
    "/** The current time, behind an interface so that a test can fix it. */",
    "export interface Clock {",
    "  now(): number;",
    "}",
    "",
    "/** The clock of the machine the code runs on. */",
    "export const systemClock: Clock = {",
    "  now: (): number => {",
    "    return Date.now();",
    "  },",
    "};",
    "",
  ].join("\n"),
);

edit("packages/shared/src/index.ts", "export {\n", 'export { type Clock, systemClock } from "./clock.ts";\nexport {\n');

edit("packages/client-core/src/composition.ts", 'import type { PricePort } from "@acme/domain";\n', 'import type { PricePort } from "@acme/domain";\nimport { type Clock, systemClock } from "@acme/shared";\n');
edit(
  "packages/client-core/src/composition.ts",
  "  price: PricePort;\n}",
  "  price: PricePort;\n  /** When a price arrived. The machine's own clock unless a test gives one. */\n  clock?: Clock;\n}",
);
edit("packages/client-core/src/composition.ts", "createPricesPresenter(ports.price),", "createPricesPresenter(ports.price, ports.clock ?? systemClock),");

const PRESENTER = "packages/client-core/src/presenters/pricesPresenter.ts";

edit(PRESENTER, '} from "@acme/domain";\n', '} from "@acme/domain";\nimport type { Clock } from "@acme/shared";\n');
edit(PRESENTER, "  stale: boolean;\n}", "  stale: boolean;\n  /** When its latest price arrived, in milliseconds since the epoch. */\n  receivedAt: number;\n}");
edit(PRESENTER, "export function createPricesPresenter(port: PricePort): PricesPresenter {", "export function createPricesPresenter(port: PricePort, clock: Clock): PricesPresenter {");
edit(
  PRESENTER,
  "      return ticksOfSymbol$.pipe(switchMap(showThenAge));",
  "      return ticksOfSymbol$.pipe(\n        map((tick) => {\n          return { ...tick, receivedAt: clock.now() };\n        }),\n        switchMap(showThenAge),\n      );",
);
edit(
  PRESENTER,
  "/** The row as fresh now, and again as stale if nothing replaces it in time. */\nfunction showThenAge(tick: PriceTick): Observable<PriceRow> {",
  "/** A tick with the time it arrived. */\ninterface ReceivedTick extends PriceTick {\n  receivedAt: number;\n}\n\n/** The row as fresh now, and again as stale if nothing replaces it in time. */\nfunction showThenAge(tick: ReceivedTick): Observable<PriceRow> {",
);

edit(
  "packages/client-react/src/ui/PriceRow.tsx",
  "      <td data-movement={row.movement}>{row.mid.toFixed(4)}</td>",
  "      <td\n        data-movement={row.movement}\n        title={`received ${new Date(row.receivedAt).toLocaleTimeString()}`}\n      >\n        {row.mid.toFixed(4)}\n      </td>",
);

// The presenter's tests, on a clock that stands still.
const TESTS = "packages/client-core/src/presenters/pricesPresenter.test.ts";

edit(TESTS, 'import type { Price } from "@acme/domain";\n', 'import type { Price } from "@acme/domain";\nimport type { Clock } from "@acme/shared";\n');
edit(TESTS, "        return prices$;\n      },\n    });\n", "        return prices$;\n      },\n    }, CLOCK);\n");
edit(TESTS, "      return prices$;\n    },\n  });\n", "      return prices$;\n    },\n  }, CLOCK);\n");

for (const row of [
  '{ symbol: "EURUSD", mid: 1.1, movement: "flat", stale: false }',
  '{ symbol: "GBPUSD", mid: 1.24, movement: "down", stale: false }',
  '{ symbol: "EURUSD", mid: 1.2, movement: "up", stale: false }',
]) {
  edit(TESTS, row, row.replace(" }", ", receivedAt: 1000 }"));
}

writeFileSync(TESTS, `${readFileSync(TESTS, "utf8")}\n/** A clock that stands still. */\nconst CLOCK: Clock = {\n  now: () => {\n    return 1000;\n  },\n};\n`);
