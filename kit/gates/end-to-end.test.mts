import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PackageDeclaration, Project, ResolvedConfig } from "./lib/config.mts";
import { checkEndToEnd, E2E_CONFIG, endToEndSkipReason } from "./lib/end-to-end.mts";

const CLIENT_AND_SERVER = {
  "packages/client-react": { role: "client" },
  "packages/server": { role: "server" },
} satisfies Record<string, PackageDeclaration>;

const DRIVEN = { ...CLIENT_AND_SERVER, "packages/e2e": { role: "e2e" } } satisfies Record<string, PackageDeclaration>;

/** The e2e add-on's config as it ships: the client on its simulator, and against the server. */
const SHIPPED_CONFIG = `export default {
  tests: "packages/e2e",
  client: { cwd: "packages/client-react" },
  modes: { sim: {}, fullstack: { server: { cwd: "packages/server" } } },
};
`;

const BOTH_SPECS = ["packages/e2e/src/sim/prices.spec.ts", "packages/e2e/src/fullstack/serverPrices.spec.ts"];

describe("a project with a client, and the browser tests that drive it", () => {
  it("passes when a mode drives the client on its simulator, another against its server, and each has a spec", async () => {
    const project = createProject({ packages: DRIVEN, e2eConfig: SHIPPED_CONFIG, files: BOTH_SPECS });

    expect(endToEndSkipReason(project)).toBeUndefined();
    expect(await checkEndToEnd(project)).toEqual([]);
  });

  it("fails each client that no package of role e2e drives, and says how to add one or why not", async () => {
    const findings = await checkEndToEnd(createProject({ packages: CLIENT_AND_SERVER }));

    expect(findings.map(({ file }) => file)).toEqual(["packages/client-react"]);
    expect(findings[0]?.message).toContain('packages/client-react is a client, and no package of role "e2e" drives it in a browser');
    expect(findings[0]?.message).toContain("add-to-project.mts <project> e2e");
    expect(findings[0]?.message).toContain("withoutEndToEnd");
  });

  it("is skipped, with the project's reason, when withoutEndToEnd says why there is no e2e package", async () => {
    const project = createProject({ packages: CLIENT_AND_SERVER, withoutEndToEnd: "the app is a terminal client" });

    expect(endToEndSkipReason(project)).toBe("withoutEndToEnd in the architecture config: the app is a terminal client");
    expect(await checkEndToEnd(project)).toEqual([]);
  });

  it("fails a withoutEndToEnd left behind once a package of role e2e is there", async () => {
    const project = createProject({ packages: DRIVEN, e2eConfig: SHIPPED_CONFIG, files: BOTH_SPECS, withoutEndToEnd: "not chosen yet" });

    expect(endToEndSkipReason(project)).toBeUndefined();
    expect((await checkEndToEnd(project)).map(({ message }) => message)).toEqual([
      expect.stringContaining('withoutEndToEnd says "not chosen yet", and packages/e2e has the role "e2e". Remove withoutEndToEnd'),
    ]);
  });

  it("is skipped when no package is a client", async () => {
    const project = createProject({ packages: { "packages/server": { role: "server" } } });

    expect(endToEndSkipReason(project)).toBe("no client package is declared, so there was nothing for a browser to drive");
    expect(await checkEndToEnd(project)).toEqual([]);
  });
});

describe("what the e2e package runs", () => {
  it("fails a server that no mode starts, so the client is never seen against it", async () => {
    const findings = await checkEndToEnd(
      createProject({
        packages: DRIVEN,
        e2eConfig: SHIPPED_CONFIG.replace(', fullstack: { server: { cwd: "packages/server" } }', ""),
        files: [BOTH_SPECS[0] ?? ""],
      }),
    );

    expect(findings.map(({ file, message }) => `${file}: ${message}`)).toEqual([
      expect.stringContaining(`${E2E_CONFIG}: packages/server is a server, and no mode of ${E2E_CONFIG} starts it`),
    ]);
  });

  it("reads a server's folder written with ./ or a trailing slash as the same folder", async () => {
    const project = createProject({
      packages: DRIVEN,
      e2eConfig: SHIPPED_CONFIG.replace('server: { cwd: "packages/server" }', 'server: { cwd: "./packages/server/" }'),
      files: BOTH_SPECS,
    });

    expect(await checkEndToEnd(project)).toEqual([]);
  });

  it("fails a client that the config does not build", async () => {
    const findings = await checkEndToEnd(
      createProject({ packages: { ...DRIVEN, "packages/client-solid": { role: "client" } }, e2eConfig: SHIPPED_CONFIG, files: BOTH_SPECS }),
    );

    expect(findings.map(({ message }) => message)).toEqual([
      `packages/client-solid is a client, and ${E2E_CONFIG} builds packages/client-react only, so no browser test drives it.`,
    ]);
  });

  it("fails a mode with no spec, and one whose folder is not there at all", async () => {
    const findings = await checkEndToEnd(
      createProject({ packages: DRIVEN, e2eConfig: SHIPPED_CONFIG, files: ["packages/e2e/src/sim/pages/PriceList.page.ts"] }),
    );

    expect(findings.map(({ file }) => file)).toEqual(["packages/e2e/src/sim", "packages/e2e/src/fullstack"]);
    expect(findings[0]?.message).toBe('The mode "sim" has no spec in packages/e2e/src/sim/, so running it tests nothing.');
  });

  it("fails when the config is missing, and names the file", async () => {
    const findings = await checkEndToEnd(createProject({ packages: DRIVEN, files: BOTH_SPECS }));

    expect(findings.map(({ file }) => file)).toEqual([E2E_CONFIG]);
    expect(findings[0]?.message).toContain("is missing");
  });

  it("fails when the config has another shape, or cannot be loaded", async () => {
    const wrongShape = await checkEndToEnd(createProject({ packages: DRIVEN, e2eConfig: "export default { tests: 1 };\n", files: BOTH_SPECS }));
    const noClientFolder = await checkEndToEnd(
      createProject({ packages: DRIVEN, e2eConfig: 'export default { tests: "packages/e2e", client: {}, modes: {} };\n', files: BOTH_SPECS }),
    );
    const unloadable = await checkEndToEnd(
      createProject({ packages: DRIVEN, e2eConfig: 'import "./e2e/lib/gone.mts";\nexport default {};\n', files: BOTH_SPECS }),
    );

    expect(wrongShape.map(({ message }) => message)).toEqual([expect.stringContaining('must default-export an object with "tests", "client.cwd" and "modes"')]);
    expect(noClientFolder).toEqual(wrongShape);
    expect(unloadable.map(({ message }) => message)).toEqual([expect.stringContaining(`${E2E_CONFIG} could not be read: `)]);
  });
});

const scratch: string[] = [];

afterEach(() => {
  for (const root of scratch.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface ProjectShape {
  packages: Record<string, PackageDeclaration>;
  e2eConfig?: string;
  /** Files that only need to exist. */
  files?: string[];
  withoutEndToEnd?: string;
}

function createProject({ packages, e2eConfig, files = [], withoutEndToEnd = "" }: ProjectShape): Project {
  const root = mkdtempSync(join(tmpdir(), "end-to-end-"));

  scratch.push(root);

  if (e2eConfig !== undefined) {
    writeFile(join(root, E2E_CONFIG), e2eConfig);
  }

  for (const file of files) {
    writeFile(join(root, file), "export {};\n");
  }

  // The gate reads the declared roles and the files, and nothing of the workspace.
  return { root, config: { packages, withoutEndToEnd } as ResolvedConfig, workspace: [] };
}

function writeFile(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
