import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));
const ADDON_CONFIG = "addons/ci-security/choice/renovate/files/.github/renovate.json5";

interface Rule {
  groupName?: string;
  matchPackageNames?: string[];
  matchDatasources?: string[];
  dependencyDashboardApproval?: boolean;
  enabled?: boolean;
}

interface Config {
  extends: string[];
  minimumReleaseAge: string;
  internalChecksFilter: string;
  schedule: string[];
  prConcurrentLimit: number;
  vulnerabilityAlerts: { enabled: boolean };
  ignorePaths: string[];
  customManagers: { managerFilePatterns: string[]; matchStrings: string[]; depNameTemplate?: string }[];
  packageRules: Rule[];
}

const config = readConfig(".github/renovate.json5");

describe("this repository's Renovate config", () => {
  it("keeps the policy the ci-security add-on ships: the same presets, wait, schedule and limit", () => {
    const addon = readConfig(ADDON_CONFIG);

    expect(config.extends).toEqual(addon.extends);
    expect(config.minimumReleaseAge).toBe(addon.minimumReleaseAge);
    expect(config.internalChecksFilter).toBe(addon.internalChecksFilter);
    expect(config.schedule).toEqual(addon.schedule);
    expect(config.prConcurrentLimit).toBe(addon.prConcurrentLimit);
  });

  it("opens the security fixes, which Dependabot cannot under the starter's Node", () => {
    expect(config.vulnerabilityAlerts).toEqual({ enabled: true });
  });

  it("leaves the tests' fixtures alone", () => {
    expect(config.ignorePaths).toContain("**/fixtures/**");
    expect(config.ignorePaths).toContain("**/tests/**");
  });

  it("reads every version an add-on adds to a project", () => {
    const manager = managerFor("addons/format-lint/addon.json");

    const paths = readdirSync(join(REPOSITORY, "addons"))
      .map((folder) => `addons/${folder}/addon.json`)
      .filter((path) => existsSync(join(REPOSITORY, path)));

    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      const text = readFileSync(join(REPOSITORY, path), "utf8");
      const named = Object.values((JSON.parse(text) as { packageJson?: Record<string, Record<string, Record<string, string>>> }).packageJson ?? {}).flatMap((fields) =>
        ["dependencies", "devDependencies"].flatMap((field) => Object.entries(fields[field] ?? {}).map(([name, version]) => `${name}@${version}`)),
      );
      const read = [...text.matchAll(new RegExp(manager.matchStrings[0] as string, "g"))].map((match) => `${match.groups?.depName}@${match.groups?.currentValue}`);

      expect(managerFor(path)).toBe(manager);
      expect(read).toEqual(named);
    }
  });

  it("moves each workflow's Playwright image with @playwright/test, never as an image of its own", () => {
    const workflows = listWorkflows().filter((path) => readFileSync(join(REPOSITORY, path), "utf8").includes("mcr.microsoft.com/playwright"));

    expect(workflows.length).toBeGreaterThan(0);

    for (const path of workflows) {
      const manager = managerFor(path);
      const text = readFileSync(join(REPOSITORY, path), "utf8");

      expect(manager.depNameTemplate).toBe("@playwright/test");
      expect(text.match(/mcr\.microsoft\.com\/playwright:\S+/g)?.length).toBe([...text.matchAll(new RegExp(manager.matchStrings[0] as string, "g"))].length);
    }

    expect(config.packageRules).toContainEqual({ matchDatasources: ["docker"], matchPackageNames: ["mcr.microsoft.com/playwright"], enabled: false });
  });

  it("moves Playwright only when someone asks for it on the Dependency Dashboard", () => {
    const rule = config.packageRules.find((candidate) => candidate.groupName === "playwright");

    expect(rule?.matchPackageNames).toEqual(expect.arrayContaining(["playwright", "@playwright/test"]));
    expect(rule?.dependencyDashboardApproval).toBe(true);
  });
});

/** The custom manager whose file pattern takes this path; it fails the test when none or two do. */
function managerFor(path: string): Config["customManagers"][number] {
  const managers = config.customManagers.filter(({ managerFilePatterns }) => managerFilePatterns.some((pattern) => new RegExp(pattern.slice(1, -1)).test(path)));

  expect(managers, path).toHaveLength(1);

  return managers[0] as Config["customManagers"][number];
}

/** Every workflow git knows of that is not a test's fixture. */
function listWorkflows(): string[] {
  return spawnSync("git", ["ls-files", "*.yml", "*.yaml"], { cwd: REPOSITORY, encoding: "utf8" })
    .stdout.split("\n")
    .filter((path) => /(^|\/)\.github\/workflows\/[^/]+$/.test(path) && !/(^|\/)(fixtures|tests)\//.test(path));
}

/** A Renovate config written as JSON with whole-line comments. */
function readConfig(path: string): Config {
  return JSON.parse(
    readFileSync(join(REPOSITORY, path), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n"),
  ) as Config;
}
