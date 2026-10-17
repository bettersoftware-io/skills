import type { ReactElement } from "react";

import { useViewModel } from "@app/react-bindings";

import { PriceRow } from "./PriceRow.tsx";
import { TESTIDS } from "./testids.ts";

/**
 * A dumb component: it renders the rows the view model gives it and reports a
 * click. Order, movement and staleness are already decided by the core.
 */
export function PriceList(): ReactElement {
  const { usePrices, useSelection } = useViewModel();
  const rows = usePrices();
  const selection = useSelection();

  return (
    <table data-testid={TESTIDS.priceList}>
      <thead>
        <tr>
          <th scope="col">Symbol</th>
          <th scope="col">Mid</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          return (
            <PriceRow
              key={row.symbol}
              row={row}
              selected={selection.state.selected === row.symbol}
              onSelect={selection.select}
            />
          );
        })}
      </tbody>
    </table>
  );
}
