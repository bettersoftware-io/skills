import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { ROOT_TESTID } from "./address.ts";

interface ScenarioFrameProps {
  /** Puts the scenario's state into the application. Called once, after the UI below has subscribed. */
  seed: () => void;
  /** A width and padding for a root capture; none for a viewport capture, which has no wrapper at all. */
  root: { width: number; padding: number } | undefined;
  /** Called once, after the state is in. */
  onReady: () => void;
  children: ReactNode;
}

/**
 * Seeds the scenario once its children are mounted, then says it is ready once
 * the seeded state has rendered. The
 * spec waits for that signal and for nothing else: no sleep, no "wait for the
 * network".
 *
 * With a `root`, the children sit in the element a picture is taken of: a
 * fixed width and a content height, `content-box` so the padding adds to the
 * width and the content keeps all of it. Without one they are rendered bare,
 * straight into the page, with no frame, padding or margin.
 *
 * Seeding happens in this component's effect because a parent's effect runs
 * after its children's. By then the UI has subscribed, so a delivery is not
 * lost.
 */
export function ScenarioFrame({
  seed,
  root,
  onReady,
  children,
}: ScenarioFrameProps): ReactElement {
  const seeding = useRef(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeding.current) {
      return;
    }

    seeding.current = true;
    seed();
    setSeeded(true);
  }, [seed]);

  // A second effect, run after the commit that follows the deliveries: ready
  // means the seeded state is on the page, not that it was handed to React.
  useEffect(() => {
    if (seeded) {
      onReady();
    }
  }, [seeded, onReady]);

  if (root === undefined) {
    return <>{children}</>;
  }

  return (
    <div
      data-testid={ROOT_TESTID}
      style={{
        width: root.width,
        padding: root.padding,
        boxSizing: "content-box",
      }}
    >
      {children}
    </div>
  );
}
