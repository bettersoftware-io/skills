import { act, render } from "@testing-library/react";
import { type ReactElement, StrictMode } from "react";

import type { Machine } from "@app/client-core";

import { type MachineView, useMachine } from "./useMachine.ts";

export interface MachinePage<TState, TIntents> {
  state: () => TState;
  send: (use: (intents: TIntents) => void) => Promise<void>;
  unmount: () => Promise<void>;
}

interface MountOptions {
  strict?: boolean;
}

interface MachineHolderProps<TState, TIntents extends object> {
  createMachine: () => Machine<TState, TIntents>;
  onView: (view: MachineView<TState, TIntents>) => void;
}

/** Mounts a component that does nothing but hold a machine, and reports what it sees. */
export function mountMachine<TState, TIntents extends object>(
  createMachine: () => Machine<TState, TIntents>,
  { strict = false }: MountOptions = {},
): MachinePage<TState, TIntents> {
  let view: MachineView<TState, TIntents> | undefined;

  function keepView(seen: MachineView<TState, TIntents>): void {
    view = seen;
  }

  const holder = (
    <MachineHolder createMachine={createMachine} onView={keepView} />
  );
  const rendered = render(strict ? <StrictMode>{holder}</StrictMode> : holder);

  function currentView(): MachineView<TState, TIntents> {
    if (view === undefined) {
      throw new Error("the machine holder has not rendered");
    }

    return view;
  }

  return {
    state: (): TState => {
      return currentView().state;
    },
    send: async (use: (intents: TIntents) => void): Promise<void> => {
      await act(async () => {
        use(currentView());
      });
    },
    unmount: async (): Promise<void> => {
      await act(async () => {
        rendered.unmount();
      });
    },
  };
}

/**
 * A component that does nothing but hold a machine, and hands each view it
 * renders to `onView`. It is defined here, not inside `mountMachine`, so that
 * React sees one component type across renders.
 */
function MachineHolder<TState, TIntents extends object>({
  createMachine,
  onView,
}: MachineHolderProps<TState, TIntents>): ReactElement {
  onView(useMachine(createMachine));

  return <output />;
}
