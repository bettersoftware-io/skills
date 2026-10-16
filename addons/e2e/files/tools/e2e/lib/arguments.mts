// What `pnpm e2e` was asked to do.

export class UsageError extends Error {}

/** Where a mode runs: in the Playwright container, or on the machine itself (`host: true` in its config). */
export type Where = "container" | "host";

const PLACES: readonly string[] = ["container", "host"] satisfies Where[];

export interface Request {
  /** The modes named with --mode. Empty: every mode. */
  modes: string[];
  /** The place named with --where: only the modes that run there. Left out: every mode, wherever it runs. */
  where?: Where;
  /** Everything else, handed to the test runner as it is. */
  forwarded: string[];
}

export const USAGE = [
  "usage: pnpm e2e [--mode <name>]... [--where container|host] [-- <arguments for playwright test>]",
  "",
  "  pnpm e2e                                   every mode, every spec",
  "  pnpm e2e --mode sim                        one mode: only what it needs is built and started",
  "  pnpm e2e --where host                      the modes that say host: true (they need what the container lacks, such as Docker)",
  "  pnpm e2e --where container                 the other modes",
  "  pnpm e2e src/sim/priceList.spec.ts         one spec",
  '  pnpm e2e -g "selects the row"              the tests whose title matches',
  "  pnpm e2e --mode sim --headed               a visible browser",
].join("\n");

export function parseArguments(argv: string[]): Request {
  const request: Request = { modes: [], forwarded: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;

    if (argument === "--") {
      // pnpm hands the separator on. What follows is the test runner's.
      request.forwarded.push(...argv.slice(index + 1));
      break;
    }

    if (argument === "--mode") {
      const name = argv[index + 1];

      if (name === undefined || name.startsWith("-")) {
        throw new UsageError('"--mode" needs the name of a mode');
      }

      request.modes.push(name);
      index += 1;
    } else if (argument.startsWith("--mode=")) {
      request.modes.push(argument.slice("--mode=".length));
    } else if (argument === "--where") {
      request.where = readWhere(argv[index + 1], request.where);
      index += 1;
    } else if (argument.startsWith("--where=")) {
      request.where = readWhere(argument.slice("--where=".length), request.where);
    } else {
      request.forwarded.push(argument);
    }
  }

  return { ...request, modes: [...new Set(request.modes)] };
}

function readWhere(value: string | undefined, before: Where | undefined): Where {
  if (value === undefined || !isWhere(value)) {
    throw new UsageError('"--where" takes "container" or "host"');
  }

  if (before !== undefined && before !== value) {
    throw new UsageError(`"--where" is given twice, as "${before}" and as "${value}"`);
  }

  return value;
}

function isWhere(value: string): value is Where {
  return PLACES.includes(value);
}
