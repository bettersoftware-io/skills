// End-to-end gate: a project with a client drives it in a real browser.
//
// Unit, contract and visual tests each stop at a seam. None of them builds the
// client, serves it and clicks through it, on its simulator and against the
// server that ships. A project with a client and no package of role "e2e" has
// nothing that would see the two halves fail to meet, and nothing says so: in
// one adopting project, five add-ons were installed and this one was not.
//
// The e2e add-on is that package. A project that cannot take it says why in
// `withoutEndToEnd`, and the reason is shown wherever the gate is skipped.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Finding, Project } from "./config.mts";
import { packagesWithRole } from "./config.mts";
import { listSourceFiles } from "./files.mts";

const GATE = "end-to-end";

/** Where the e2e add-on keeps what it runs, from the project root. */
export const E2E_CONFIG = "tools/e2e.config.mts";

const SPEC = /\.spec\.[cm]?tsx?$/;

/** The parts of the e2e add-on's config this gate reads. The add-on's runner checks the rest. */
interface EndToEndSettings {
  tests: string;
  client: { cwd: string };
  modes: Record<string, { server?: { cwd?: string } }>;
}

/** Why this gate judged nothing, if it did. */
export function endToEndSkipReason({ config }: Project): string | undefined {
  if (packagesWithRole(config, "client").length === 0) {
    return "no client package is declared, so there was nothing for a browser to drive";
  }

  if (config.withoutEndToEnd !== "" && packagesWithRole(config, "e2e").length === 0) {
    return `withoutEndToEnd in the architecture config: ${config.withoutEndToEnd}`;
  }

  return undefined;
}

export async function checkEndToEnd(project: Project): Promise<Finding[]> {
  const { root, config } = project;

  if (endToEndSkipReason(project) !== undefined) {
    return [];
  }

  const clients = packagesWithRole(config, "client");
  const drivers = packagesWithRole(config, "e2e");

  if (drivers.length === 0) {
    return clients.map((client) => ({
      gate: GATE,
      file: client.path,
      message: `${client.path} is a client, and no package of role "e2e" drives it in a browser, so nothing sees the built client fail against its simulator or its server. Add the e2e add-on (add-to-project.mts <project> e2e), or write in withoutEndToEnd, in the architecture config, why this project has none.`,
    }));
  }

  if (config.withoutEndToEnd !== "") {
    return [
      {
        gate: GATE,
        message: `withoutEndToEnd says "${config.withoutEndToEnd}", and ${drivers.map(({ path }) => path).join(", ")} has the role "e2e". Remove withoutEndToEnd from the architecture config: the reason no longer holds, and while it is there it hides this gate's findings.`,
      },
    ];
  }

  const settings = await readSettings(root);

  if (typeof settings === "string") {
    return [{ gate: GATE, file: E2E_CONFIG, message: settings }];
  }

  // Server folder → the first mode that starts it.
  const started = new Map(
    Object.entries(settings.modes)
      .reverse()
      .flatMap(([mode, { server }]) => (server?.cwd === undefined ? [] : [[stripSlashes(server.cwd), mode] as const])),
  );
  const serverPaths = new Set(packagesWithRole(config, "server").map(({ path }) => path));
  const exempt = config.serversWithoutEndToEnd;

  return [
    ...clients
      .filter((client) => client.path !== stripSlashes(settings.client.cwd))
      .map((client) => ({
        gate: GATE,
        file: E2E_CONFIG,
        message: `${client.path} is a client, and ${E2E_CONFIG} builds ${settings.client.cwd} only, so no browser test drives it.`,
      })),
    ...packagesWithRole(config, "server")
      .filter((server) => !started.has(server.path) && exempt[server.path] === undefined)
      .map((server) => ({
        gate: GATE,
        file: E2E_CONFIG,
        message: `${server.path} is a server, and no mode of ${E2E_CONFIG} starts it, so the client is never seen against it. Add a mode whose server runs it, as the add-on's "fullstack" mode does, or write in serversWithoutEndToEnd, in the architecture config, why it has none yet.`,
      })),
    ...Object.entries(exempt).flatMap(([path, reason]) => {
      const mode = started.get(path);

      if (!serverPaths.has(path)) {
        return [{ gate: GATE, message: `serversWithoutEndToEnd names ${path}, which is not a package of role "server". Remove the entry, or correct the path.` }];
      }

      return mode === undefined
        ? []
        : [
            {
              gate: GATE,
              message: `serversWithoutEndToEnd says ${path} has no end-to-end mode ("${reason}"), and the mode "${mode}" starts it. Remove the entry: the reason no longer holds.`,
            },
          ];
    }),
    ...Object.keys(settings.modes)
      .filter((mode) => !listSourceFiles(root, join(settings.tests, "src", mode)).some((file) => SPEC.test(file)))
      .map((mode) => ({
        gate: GATE,
        file: `${settings.tests}/src/${mode}`,
        message: `The mode "${mode}" has no spec in ${settings.tests}/src/${mode}/, so running it tests nothing.`,
      })),
  ];
}

/** The e2e add-on's config, or what is wrong with it. */
async function readSettings(root: string): Promise<EndToEndSettings | string> {
  const file = join(root, E2E_CONFIG);

  if (!existsSync(file)) {
    return `A package has the role "e2e", and ${E2E_CONFIG}, which says what it builds and runs, is missing. Add the e2e add-on again, or write the file.`;
  }

  try {
    const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };

    return isSettings(loaded.default)
      ? loaded.default
      : `${E2E_CONFIG} must default-export an object with "tests", "client.cwd" and "modes", as the e2e add-on writes it.`;
  } catch (error) {
    return `${E2E_CONFIG} could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function isSettings(value: unknown): value is EndToEndSettings {
  if (!isRecord(value) || typeof value.tests !== "string" || !isRecord(value.client) || !isRecord(value.modes)) {
    return false;
  }

  return typeof value.client.cwd === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripSlashes(path: string): string {
  return path.replace(/^\.\//, "").replace(/\/+$/, "");
}
