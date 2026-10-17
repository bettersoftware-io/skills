import type { ReactElement, ReactNode } from "react";

import { PriceList } from "#/ui/PriceList.tsx";
import { PriceRow } from "#/ui/PriceRow.tsx";

import type { Scenario } from "./scenarios.ts";

// What a scenario's `mount` names: the parts of the UI that are pictured on
// their own. This file is the project's. A new component gets an entry here,
// and its states get scenarios in `scenarios.ts`.
//
// An entry turns a scenario into an element. A leaf takes its props from the
// scenario. A section reads the view model, whose state the seeding puts in
// through the harness, as it does for the whole app.

/** Turns a scenario into the element it pictures. */
type Entry = (scenario: Scenario) => ReactElement;

const registry: Record<string, Entry> = {
  "price-row": (scenario: Scenario): ReactElement => {
    return (
      <table>
        <tbody>
          <PriceRow
            row={rowOf(scenario)}
            selected={scenario.selected === scenario.row?.symbol}
            onSelect={ignoreSelect}
          />
        </tbody>
      </table>
    );
  },
  "price-list": (): ReactElement => {
    return <PriceList />;
  },
};

interface SurroundProps {
  children: ReactNode;
}

/**
 * What the app puts around everything it draws: its theme providers and the
 * attributes its styles read (a `data-theme` on a wrapper, say), without its
 * layout. A component pictured on its own would otherwise have none of them,
 * and no colours. The starter's theme is `index.css` alone, so this passes
 * its children through.
 */
function Surround({ children }: SurroundProps): ReactElement {
  return <>{children}</>;
}

interface MountProps {
  scenario: Scenario;
}

/** The entry a scenario's `mount` names, in the app's surround. */
export function Mount({ scenario }: MountProps): ReactElement {
  const key = scenario.mount ?? "";
  const entry: Entry | undefined = registry[key];

  if (entry === undefined) {
    throw new Error(
      `No entry "${key}" in registry.tsx. Its entries: ${Object.keys(registry).join(", ")}`,
    );
  }

  return <Surround>{entry(scenario)}</Surround>;
}

function rowOf(scenario: Scenario): NonNullable<Scenario["row"]> {
  if (scenario.row === undefined) {
    throw new Error(
      'A "price-row" mount shows the scenario\'s `row`, and this one has none.',
    );
  }

  return scenario.row;
}

/** A picture is never clicked. */
function ignoreSelect(): void {
  // Nothing to do.
}
