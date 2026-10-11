// The plugin is described in four files: one manifest and one marketplace
// listing for each host (Claude Code, Codex). Nothing makes them agree except
// these tests.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY = dirname(dirname(fileURLToPath(import.meta.url)));
const SKILLS = join(REPOSITORY, "skills");

describe("the plugin manifests", () => {
  it("name the plugin the same for both hosts", () => {
    const claude = readManifest(".claude-plugin/plugin.json");
    const codex = readManifest(".codex-plugin/plugin.json");

    expect(codex.name).toBe(claude.name);
    expect(codex.description).toBe(claude.description);
    expect(codex.license).toBe(claude.license);
    expect(codex.repository).toBe(claude.repository);
  });

  it("are listed under the same names in both marketplaces", () => {
    const plugin = readManifest(".claude-plugin/plugin.json");
    const claude = readMarketplace(".claude-plugin/marketplace.json");
    const codex = readMarketplace(".agents/plugins/marketplace.json");

    expect(codex.name).toBe(claude.name);
    expect(claude.plugins.map((entry) => entry.name)).toEqual([plugin.name]);
    expect(codex.plugins.map((entry) => entry.name)).toEqual([plugin.name]);
  });

  it("point each marketplace entry at a folder that holds the plugin", () => {
    const claude = readMarketplace(".claude-plugin/marketplace.json");
    const codex = readMarketplace(".agents/plugins/marketplace.json");

    for (const entry of claude.plugins) {
      expect(typeof entry.source).toBe("string");
      expect(existsSync(resolve(REPOSITORY, String(entry.source), ".claude-plugin/plugin.json"))).toBe(true);
    }

    for (const entry of codex.plugins) {
      const source = entry.source as { url: string };

      expect(existsSync(resolve(REPOSITORY, source.url, ".codex-plugin/plugin.json"))).toBe(true);
    }
  });

  it("give Codex a skills folder that exists", () => {
    const codex = readManifest(".codex-plugin/plugin.json");

    expect(resolve(REPOSITORY, String(codex.skills))).toBe(SKILLS);
  });
});

describe("every skill", () => {
  const skills = readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it("is found", () => {
    expect(skills.length).toBeGreaterThan(0);
  });

  it.each(skills)("%s is named after its folder", (skill) => {
    expect(readFrontmatter(skill).name).toBe(skill);
  });

  it.each(skills)("%s has a description that says when to use it, and nothing else", (skill) => {
    const { description } = readFrontmatter(skill);

    expect(description).toMatch(/^Use when /);
    expect(description.length).toBeLessThanOrEqual(500);
  });
});

describe("reviewing-architecture", () => {
  it("says the same as the copy every project carries in tools/arch/docs/review.md", () => {
    const skill = readFileSync(join(SKILLS, "reviewing-architecture", "SKILL.md"), "utf8");
    const inProjects = readFileSync(join(REPOSITORY, "kit", "docs", "review.md"), "utf8");

    expect(skill.replace(/^---\n[\s\S]*?\n---\n\n/, "")).toBe(inProjects);
  });
});

describe("creating-a-project", () => {
  it("finds the script where it tells the agent to look: two folders above the skill", () => {
    const skillFile = join(SKILLS, "creating-a-project", "SKILL.md");
    const pluginRoot = resolve(dirname(skillFile), "..", "..");

    expect(readFileSync(skillFile, "utf8")).toContain("scripts/create-project.mts");
    expect(existsSync(join(pluginRoot, "scripts", "create-project.mts"))).toBe(true);
    expect(existsSync(join(pluginRoot, "starter", "package.json"))).toBe(true);
    expect(existsSync(join(pluginRoot, "kit", "gates", "run.mts"))).toBe(true);
  });
});

describe("documenting-architecture", () => {
  const skillFolder = join(SKILLS, "documenting-architecture");
  const skill = readFileSync(join(skillFolder, "SKILL.md"), "utf8");
  const pluginRoot = resolve(skillFolder, "..", "..");

  it("finds every script where it tells the agent to look: two folders above the skill", () => {
    const named = [...skill.matchAll(/node <plugin root>\/(\S+\.mts)/g)].map((match) => match[1] as string);

    expect([...new Set(named)].sort()).toEqual([
      "addons/repo-hygiene/files/tools/repo-hygiene/check-doc-links.mts",
      "scripts/architecture-docs/build-site.mts",
      "scripts/architecture-docs/check-cited-paths.mts",
      "scripts/architecture-docs/check-diagrams.mts",
    ]);

    for (const script of named) {
      expect(existsSync(join(pluginRoot, script)), script).toBe(true);
    }
  });

  it("links only to files that ship beside it", () => {
    const linked = [...skill.matchAll(/\]\(([a-z-]+\.md)\)/g)].map((match) => match[1] as string);

    expect([...new Set(linked)].sort()).toEqual(["briefs.md", "mermaid.md"]);

    for (const file of linked) {
      expect(existsSync(join(skillFolder, file)), file).toBe(true);
    }
  });

  it("does not let the set be called finished before it is fact-checked", () => {
    expect(skill).toContain("**Do not report the set as finished before this step.**");
    expect(skill).toContain("Not checked is not passed.");
  });

  it("says the size of what the first run fetches as the lockfile makes it", () => {
    // The skill tells the person what the first run costs. If the toolset changes, look again.
    const toolset = JSON.parse(readFileSync(join(pluginRoot, "scripts/architecture-docs/toolset/toolset.json"), "utf8")) as { dependencies: Record<string, string> };

    expect(toolset.dependencies).toEqual({ marked: "15.0.12", mermaid: "12.1.0", "puppeteer-core": "25.13.0" });
    expect(skill).toContain("(about 230 MB, once per machine)");
  });
});

interface Manifest {
  name: string;
  description: string;
  license: string;
  repository: string;
  skills?: string;
}

interface Marketplace {
  name: string;
  plugins: { name: string; source: unknown }[];
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(join(REPOSITORY, path), "utf8")) as Manifest;
}

function readMarketplace(path: string): Marketplace {
  return JSON.parse(readFileSync(join(REPOSITORY, path), "utf8")) as Marketplace;
}

function readFrontmatter(skill: string): { name: string; description: string } {
  const text = readFileSync(join(SKILLS, skill, "SKILL.md"), "utf8");
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  const field = (key: string): string => new RegExp(`^${key}: (.*)$`, "m").exec(block)?.[1] ?? "";

  return { name: field("name"), description: field("description") };
}
