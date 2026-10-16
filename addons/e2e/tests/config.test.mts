import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkConfig, type E2eConfig, E2eError, findWrapper, loadConfig, selectModes } from "../files/tools/e2e/lib/config.mts";
import { createFakeProject, renderConfig, TOOLS, write } from "./support.mts";

describe("the project's e2e config", () => {
  it("is read from tools/e2e.config.mts, patterns and all", async () => {
    const { root, config } = createFakeProject();

    expect(await loadConfig(root)).toEqual(config);
  });

  it("could not be read when the file is not there, and says where it looked", async () => {
    const { root } = createFakeProject();

    rmSync(join(root, "tools/e2e.config.mts"));

    await expect(loadConfig(root)).rejects.toThrow(E2eError);
    await expect(loadConfig(root)).rejects.toThrow(`tools/e2e.config.mts not found in ${root}`);
  });

  it("refuses a file that does not hold the three parts", () => {
    expect(() => checkConfig(undefined)).toThrow('must default-export an object with "tests", "client" and "modes"');
    expect(() => checkConfig({ tests: "packages/e2e", client: {} })).toThrow(E2eError);
  });

  it("refuses a config with no mode: there would be nothing to run", () => {
    const { config } = createFakeProject();

    expect(() => checkConfig({ ...config, modes: {} })).toThrow('"modes" is empty');
  });

  it("refuses a command that is not a program and its arguments", () => {
    const { config } = createFakeProject();

    expect(() => checkConfig({ ...config, client: { ...config.client, build: "vite build" } })).toThrow('"client.build" must be a list');
    expect(() => checkConfig({ ...config, client: { ...config.client, serve: [] } })).toThrow('"client.serve" must be a list');
  });

  it("refuses a command that goes through a package manager, for the client and for a mode's server", () => {
    const { config } = createFakeProject();
    const server = config.modes.fullstack?.server;

    expect(() => checkConfig({ ...config, client: { ...config.client, serve: ["pnpm", "exec", "vite", "preview", "{outDir}"] } })).toThrow(
      '"client.serve" starts with pnpm. A package manager\'s wrapper can die on the stop signal',
    );
    expect(() =>
      checkConfig({ ...config, modes: { fullstack: { server: { ...server, command: ["npx", "tsx", "src/index.ts"] } } } }),
    ).toThrow('"modes.fullstack.server.command" starts with npx');
  });

  it("knows a package manager by its name, wherever it is installed", () => {
    expect(findWrapper(["/opt/homebrew/bin/pnpm", "dev"])).toBe("pnpm");
    expect(findWrapper(["yarn", "dev"])).toBe("yarn");
    expect(findWrapper(["node_modules/.bin/vite", "preview"])).toBeUndefined();
    expect(findWrapper(["node", "src/index.ts"])).toBeUndefined();
  });

  it("refuses a ready pattern that captures no address", () => {
    const { config } = createFakeProject();
    const server = config.modes.fullstack?.server;

    expect(() => checkConfig({ ...config, client: { ...config.client, ready: /Local:/ } })).toThrow('"client.ready" must be a regular expression whose first group');
    expect(() => checkConfig({ ...config, client: { ...config.client, ready: "Local: (.+)" } })).toThrow('"client.ready"');
    expect(() => checkConfig({ ...config, modes: { fullstack: { server: { ...server, ready: /listening/ } } } })).toThrow(
      '"modes.fullstack.server.ready"',
    );
  });

  it("refuses a build or a serve command that names no output folder", () => {
    const { config } = createFakeProject();

    expect(() => checkConfig({ ...config, client: { ...config.client, build: ["vite", "build"] } })).toThrow('"client.build" does not name OUT_DIR');
    expect(() => checkConfig({ ...config, client: { ...config.client, serve: ["vite", "preview"] } })).toThrow('"client.serve" does not name OUT_DIR');
  });

  it("accepts a mode that runs on the host, and an env that is a function to call", () => {
    const { config } = createFakeProject();
    const read = (): Promise<Record<string, string>> => Promise.resolve({ CLIENT_API_URL: "http://127.0.0.1:54321" });
    const modes = { sim: { ...config.modes.sim, host: false }, stack: { host: true, env: read } };

    expect(checkConfig({ ...config, modes }).modes).toEqual(modes);
  });

  it("refuses a host that is not true or false", () => {
    const { config } = createFakeProject();

    expect(() => checkConfig({ ...config, modes: { sim: { host: "yes" } } })).toThrow('"modes.sim.host" must be true or false');
  });

  it.each([["a string", "VITE_SERVER_URL="], ["a list", ["VITE_SERVER_URL"]], ["a number among the variables", { VITE_PORT: 4000 }]])(
    "refuses an env that is %s",
    (_what, env) => {
      const { config } = createFakeProject();

      expect(() => checkConfig({ ...config, modes: { sim: { env } } })).toThrow(
        '"modes.sim.env" must be an object of strings, or a function that resolves to one',
      );
    },
  );

  it("accepts the config the add-on ships", async () => {
    const { root } = createFakeProject();

    write(join(root, "tools/e2e.config.mts"), readFileSync(join(TOOLS, "e2e.config.mts"), "utf8"));

    const config = await loadConfig(root);

    expect(Object.keys(config.modes)).toEqual(["sim", "fullstack"]);
    expect(config.client.build[0]).toBe("node_modules/.bin/vite");
    expect(config.modes.fullstack?.server?.command).toEqual(["node", "src/index.ts"]);
  });
});

describe("the modes of a run", () => {
  it("are all of them, in the config's order, when none is asked for", () => {
    const { root, config } = createFakeProject();

    expect(selectModes(root, config, [])).toEqual({ modes: ["sim", "fullstack"] });
  });

  it("are the ones asked for, in the config's order", () => {
    const { root, config } = createFakeProject();

    expect(selectModes(root, config, ["fullstack"])).toEqual({ modes: ["fullstack"] });
    expect(selectModes(root, config, ["fullstack", "sim"])).toEqual({ modes: ["sim", "fullstack"] });
  });

  it("refuses a mode that does not exist, and names the ones that do", () => {
    const { root, config } = createFakeProject();

    expect(() => selectModes(root, config, ["live"])).toThrow('there is no mode called "live" — the modes are sim, fullstack');
  });

  it("refuses a mode with no spec: nothing to judge is not a pass", () => {
    const { root, config } = createFakeProject();

    rmSync(join(root, "packages/e2e/src/fullstack/server.spec.ts"));

    expect(() => selectModes(root, config, [])).toThrow('the mode "fullstack" has no spec in packages/e2e/src/fullstack/');
    expect(selectModes(root, config, ["sim"])).toEqual({ modes: ["sim"] });
  });

  it("refuses a spec that is in no mode's folder, which no run would start", () => {
    const { root, config } = createFakeProject();

    write(join(root, "packages/e2e/src/smoke/app.spec.ts"), "");

    expect(() => selectModes(root, config, ["sim"])).toThrow("packages/e2e/src/smoke/app.spec.ts is in no mode's folder");
  });

  it("does not look for specs in installed or generated folders", () => {
    const { root, config } = createFakeProject();

    write(join(root, "packages/e2e/src/node_modules/dep/a.spec.ts"), "");
    write(join(root, "packages/e2e/src/reports/a.spec.ts"), "");

    expect(selectModes(root, config, [])).toEqual({ modes: ["sim", "fullstack"] });
  });

  it("are the ones that say host, with --where host", () => {
    const { root, config } = createFakeProject();

    expect(selectModes(root, config, [], "host")).toEqual({ modes: [] });
    expect(selectModes(root, withHost(config, "fullstack"), [], "host")).toEqual({ modes: ["fullstack"] });
  });

  it("are the others, with --where container, a mode that says host: false among them", () => {
    const { root, config } = createFakeProject();
    const sim = { ...config.modes.sim, host: false };

    expect(selectModes(root, withHost(config, "fullstack"), [], "container")).toEqual({ modes: ["sim"] });
    expect(selectModes(root, { ...config, modes: { ...config.modes, sim } }, [], "container")).toEqual({ modes: ["sim", "fullstack"] });
  });

  it("are every mode, wherever it runs, when no place is asked for", () => {
    const { root, config } = createFakeProject();

    expect(selectModes(root, withHost(config, "fullstack"), [])).toEqual({ modes: ["sim", "fullstack"] });
  });

  it("refuse a mode asked for by name that runs in the other place", () => {
    const { root, config } = createFakeProject();

    expect(() => selectModes(root, withHost(config, "fullstack"), ["fullstack"], "container")).toThrow(
      'the mode "fullstack" runs on the host, and this run is --where container',
    );
    expect(() => selectModes(root, config, ["sim"], "host")).toThrow('the mode "sim" runs in the container, and this run is --where host');
    expect(selectModes(root, withHost(config, "fullstack"), ["fullstack"], "host")).toEqual({ modes: ["fullstack"] });
  });

  it("still refuse a spec in no mode's folder when the place leaves no mode to run", () => {
    const { root, config } = createFakeProject();

    write(join(root, "packages/e2e/src/smoke/app.spec.ts"), "");

    expect(() => selectModes(root, config, [], "host")).toThrow("packages/e2e/src/smoke/app.spec.ts is in no mode's folder");
  });

  it("refuses a tests package with no src folder", () => {
    const { root, config } = createFakeProject();

    rmSync(join(root, "packages/e2e/src"), { recursive: true });
    mkdirSync(join(root, "packages/e2e"), { recursive: true });

    expect(() => selectModes(root, config, [])).toThrow("packages/e2e/src not found");
  });
});

describe("the config as a file", () => {
  it("is written by the test support the way a project would write it", () => {
    expect(renderConfig({ tests: "t", client: { cwd: "c", build: ["b"], serve: ["s"], ready: /Local:\s+(http:\/\/[^\s/]+)/ }, modes: {} })).toContain(
      '"ready": /Local:\\s+(http:\\/\\/[^\\s/]+)/',
    );
  });
});

function withHost(config: E2eConfig, name: string): E2eConfig {
  return { ...config, modes: { ...config.modes, [name]: { ...config.modes[name], host: true } } };
}
