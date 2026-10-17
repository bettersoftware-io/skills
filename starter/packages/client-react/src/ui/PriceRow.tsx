import type { ReactElement } from "react";

import type { PriceRow as Row } from "@app/client-core";

import { TESTIDS } from "./testids.ts";

/**
 * One row of the price list, from props alone. Its own component, so it can
 * be shown alone (the visual tests picture each state the presenter gives a
 * row).
 */
export function PriceRow({
  row,
  selected,
  onSelect,
}: PriceRowProps): ReactElement {
  function selectRow(): void {
    onSelect(row.symbol);
  }

  return (
    <tr
      data-testid={TESTIDS.priceRow}
      data-selected={selected}
      data-stale={row.stale}
      onClick={selectRow}
    >
      <th scope="row">{row.symbol}</th>
      <td data-movement={row.movement}>{row.mid.toFixed(4)}</td>
    </tr>
  );
}

interface PriceRowProps {
  row: Row;
  selected: boolean;
  onSelect: (symbol: string) => void;
}
