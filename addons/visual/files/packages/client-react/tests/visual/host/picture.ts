// What a scenario says about its picture, and how the fields resolve against
// the project's framing and tolerance. Pure and import-free: the Playwright
// spec (Node) and the browser host both load it, and both must read a scenario
// the same way.
//
// Every field is optional. A scenario with none is a page: the whole App in a
// viewport, captured as the viewport.

export type Level = "component" | "section" | "page";
type Capture = "root" | "viewport";

/**
 * The fields of a scenario this add-on reads. The project's own state fields sit beside them.
 *
 * @public Only the project's `scenarios.ts` extends it, and that file is the project's. Without the tag, knip reports it unused until the project has made that edit.
 */
export interface Picture {
  level?: Level;
  mount?: string;
  capture?: Capture;
  width?: number;
  height?: number;
  strict?: true;
  maxDiffPixels?: number;
  pixelThreshold?: number;
}

/** The numbers a scenario falls back on. The project's, in `framing.ts`. */
export interface Framing {
  rootWidth: number;
  rootPadding: number;
  viewport: { width: number; height: number };
}

/** The tolerance's knobs. `maxDiffPixelRatio` is read only from a project's older `tolerance.ts`. */
export interface Tolerance {
  threshold: number;
  maxDiffPixels?: number;
  maxDiffPixelRatio?: number;
}

export interface ResolvedPicture {
  level: Level;
  capture: Capture;
  mount: string | undefined;
  viewport: { width: number; height: number };
  root: { width: number; padding: number } | undefined;
  tolerance: Tolerance;
}

/** A scenario that contradicts itself or holds a value its field cannot. The message names both. */
export class PictureError extends Error {}

const LEVELS: readonly string[] = ["component", "section", "page"];
const CAPTURES: readonly string[] = ["root", "viewport"];

function fail(name: string, field: string, problem: string): never {
  throw new PictureError(`Scenario "${name}": \`${field}\` ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSize(
  name: string,
  field: string,
  value: unknown,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fail(
      name,
      field,
      `must be a whole number of pixels above 0, got ${JSON.stringify(value)}.`,
    );
  }

  return value;
}

function readNumber(
  name: string,
  field: string,
  value: unknown,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fail(
      name,
      field,
      `must be a number of 0 or more, got ${JSON.stringify(value)}.`,
    );
  }

  return value;
}

function resolveTolerance(
  name: string,
  scenario: Record<string, unknown>,
  global: Tolerance,
): Tolerance {
  const maxDiffPixels = readNumber(
    name,
    "maxDiffPixels",
    scenario.maxDiffPixels,
  );

  const pixelThreshold = readNumber(
    name,
    "pixelThreshold",
    scenario.pixelThreshold,
  );

  if (scenario.strict !== undefined) {
    if (scenario.strict !== true) {
      return fail(
        name,
        "strict",
        `must be \`true\` when present, got ${JSON.stringify(scenario.strict)}. Remove it to use the global tolerance.`,
      );
    }

    if (maxDiffPixels !== undefined || pixelThreshold !== undefined) {
      return fail(
        name,
        "strict",
        "is zero pixels and zero threshold, so it cannot go with `maxDiffPixels` or `pixelThreshold`.",
      );
    }

    return { threshold: 0, maxDiffPixels: 0 };
  }

  const resolved: Tolerance = { ...global };

  if (maxDiffPixels !== undefined) {
    // A global with no cap (an older tolerance.ts) counts as a cap of 0.
    const cap = global.maxDiffPixels ?? 0;

    if (maxDiffPixels <= cap) {
      return fail(
        name,
        "maxDiffPixels",
        `is ${maxDiffPixels}, which is not above the global ${cap}. A per-scenario cap is a larger one; remove it, or use \`strict\` for a tighter one.`,
      );
    }

    resolved.maxDiffPixels = maxDiffPixels;
    // The scenario's absolute cap replaces an older global's ratio. Kept, a
    // ratio of 0 would still cap the scenario at 0 pixels.
    delete resolved.maxDiffPixelRatio;
  }

  if (pixelThreshold !== undefined) {
    if (pixelThreshold >= global.threshold) {
      return fail(
        name,
        "pixelThreshold",
        `is ${pixelThreshold}, which is not below the global ${global.threshold}. A per-scenario threshold is a lower one.`,
      );
    }

    resolved.threshold = pixelThreshold;
  }

  return resolved;
}

export function resolvePicture(
  name: string,
  scenario: unknown,
  framing: Framing,
  global: Tolerance,
): ResolvedPicture {
  if (!isRecord(scenario)) {
    throw new PictureError(
      `Scenario "${name}": must be an object, got ${JSON.stringify(scenario) ?? String(scenario)}.`,
    );
  }

  const level = scenario.level ?? "page";

  if (typeof level !== "string" || !LEVELS.includes(level)) {
    return fail(
      name,
      "level",
      `must be "component", "section" or "page", got ${JSON.stringify(scenario.level)}.`,
    );
  }

  const capture = scenario.capture ?? (level === "page" ? "viewport" : "root");

  if (typeof capture !== "string" || !CAPTURES.includes(capture)) {
    return fail(
      name,
      "capture",
      `must be "root" or "viewport", got ${JSON.stringify(scenario.capture)}.`,
    );
  }

  if (
    scenario.mount !== undefined &&
    (typeof scenario.mount !== "string" || scenario.mount === "")
  ) {
    return fail(
      name,
      "mount",
      `must be the registry key of what is rendered, a non-empty string, got ${JSON.stringify(scenario.mount)}.`,
    );
  }

  const width = readSize(name, "width", scenario.width);

  if (capture === "root" && scenario.height !== undefined) {
    return fail(
      name,
      "height",
      'is the viewport height, and a root capture has the height of its content. Remove it, or set `capture: "viewport"`.',
    );
  }

  const height = readSize(name, "height", scenario.height);
  const tolerance = resolveTolerance(name, scenario, global);
  const mount = scenario.mount;

  if (capture === "root") {
    return {
      level: level as Level,
      capture,
      mount,
      viewport: { ...framing.viewport },
      root: { width: width ?? framing.rootWidth, padding: framing.rootPadding },
      tolerance,
    };
  }

  return {
    level: level as Level,
    capture: "viewport",
    mount,
    viewport: {
      width: width ?? framing.viewport.width,
      height: height ?? framing.viewport.height,
    },
    root: undefined,
    tolerance,
  };
}

/** The failure for a scenario with a `mount` when the project's seeding returns no `render`. */
export function describeMissingRender(name: string): string {
  return `Scenario "${name}" has a \`mount\`, but \`seedScenario\` in seeding.ts returns no \`render\`. An older seeding does not; copy the \`render\` part from tools/templates/visual.packages__client-react__tests__visual__seeding.ts.txt.`;
}
