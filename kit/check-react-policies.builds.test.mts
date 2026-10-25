import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { buildsOf } from "./check-react-policies.mts";

describe("the builds that include a package", () => {
  it("are the packages with a Vite config that depend on it, directly or through others, and no package without one", () => {
    const root = createWorkspace({
      "packages/catalog": { name: "@fx/catalog" },
      "packages/bridge": { name: "@fx/bridge", dependencies: ["@fx/catalog"] },
      "apps/web": { name: "@fx/web", dependencies: ["@fx/bridge"], vite: true },
      "apps/docs": { name: "@fx/docs", devDependencies: ["@fx/catalog"], vite: true },
      "apps/other": { name: "@fx/other", vite: true },
    });

    expect(buildsOf(root, "packages/catalog")).toEqual(["apps/docs", "apps/web"]);
  });

  it("are found through a cycle without going round it for ever", () => {
    const root = createWorkspace({
      "packages/catalog": { name: "@fx/catalog" },
      "packages/a": { name: "@fx/a", dependencies: ["@fx/b"], vite: true },
      "packages/b": { name: "@fx/b", dependencies: ["@fx/a", "@fx/catalog"] },
      "packages/c": { name: "@fx/c", dependencies: ["@fx/d"], vite: true },
      "packages/d": { name: "@fx/d", dependencies: ["@fx/c"] },
    });

    expect(buildsOf(root, "packages/catalog")).toEqual(["packages/a"]);
  });
});

interface Fake {
  name: string;
  dependencies?: string[];
  devDependencies?: string[];
  vite?: boolean;
}

function createWorkspace(packages: Record<string, Fake>): { root: string; workspace: { path: string; name: string }[] } {
  const root = mkdtempSync(join(tmpdir(), "builds-of-"));

  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });

  for (const [path, { name, dependencies = [], devDependencies = [], vite = false }] of Object.entries(packages)) {
    const linked = (names: string[]) => Object.fromEntries(names.map((dependency) => [dependency, "workspace:*"]));

    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "package.json"), JSON.stringify({ name, dependencies: linked(dependencies), devDependencies: linked(devDependencies) }));

    if (vite) {
      writeFileSync(join(root, path, "vite.config.ts"), "export default {};\n");
    }
  }

  return { root, workspace: Object.entries(packages).map(([path, { name }]) => ({ path, name })) };
}
