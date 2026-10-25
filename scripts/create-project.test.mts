import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { addToProject, listAddons } from "./add-to-project.mts";
import { createProject, parseArguments, ProjectError, projectReadme, type ProjectSteps } from "./create-project.mts";
import { findIgnored } from "./lib/git-ignored.mts";

describe("creating a project from the starter", () => {
  it("copies the starter and names the root package after the target folder", () => {
    const { destination: project } = createProject({ target: createTarget("price-desk") });

    expect(JSON.parse(readFileSync(join(project, "package.json"), "utf8")).name).toBe("price-desk");
    expect(existsSync(join(project, "packages/domain/src/ports/pricePort.ts"))).toBe(true);
    expect(existsSync(join(project, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(project, ".claude/settings.json"))).toBe(true);
    expect(existsSync(join(project, ".codex/hooks.json"))).toBe(true);
  });

  it("puts a real copy of the kit at tools/arch, without the kit's own tests and fixtures", () => {
    const { destination: project } = createProject({ target: createTarget("price-desk") });
    const kit = join(project, "tools/arch");

    expect(lstatSync(kit).isSymbolicLink()).toBe(false);
    expect(existsSync(join(kit, "gates/run.mts"))).toBe(true);
    expect(existsSync(join(kit, "hooks/after-edit.mts"))).toBe(true);
    expect(existsSync(join(kit, "eslint-rules/newspaper-order.mts"))).toBe(true);
    expect(existsSync(join(kit, "gates/fixtures"))).toBe(false);
    expect(listFiles(kit).filter((file) => file.endsWith(".test.mts"))).toEqual([]);
  });

  it("leaves out anything installed or generated", () => {
    const { destination: project } = createProject({ target: createTarget("price-desk") });

    expect(listFiles(project).filter((file) => /\/(node_modules|dist|\.turbo)\//.test(file))).toEqual([]);
  });

  it("renames the package scope everywhere, the lockfile included", () => {
    const { destination: project } = createProject({ target: createTarget("price-desk"), scope: "@acme" });
    const withOldScope = listFiles(project)
      .filter((file) => !file.includes("/tools/"))
      .filter((file) => readFileSync(file, "utf8").includes("@app/"));

    expect(withOldScope).toEqual([]);
    expect(readFileSync(join(project, "packages/domain/package.json"), "utf8")).toContain('"@acme/domain"');
    expect(readFileSync(join(project, "pnpm-lock.yaml"), "utf8")).toContain("'@acme/domain'");
  });

  it("leaves a kit update with nothing to say about a project it has just created, under any scope", () => {
    const { destination: project } = createProject({ target: createTarget("price-desk"), scope: "@acme" });

    const update = addToProject({ project, unit: "kit" });

    expect(update.files.written).toEqual([]);
    expect(update.yours).toEqual([]);
    expect(update.newGates).toEqual([]);
    expect(readFileSync(join(project, "tools/arch/templates/AGENTS.md.txt"), "utf8")).toBe(readFileSync(join(project, "AGENTS.md"), "utf8"));
  });

  // Nothing the kit or an add-on installs is meant to stay out of a commit. So
  // a project that ignores one of those files has a rule to change, and the
  // installer says so with no list of files to leave out.
  it("ignores none of the files it was created with, with every add-on, once it is a repository", () => {
    const { destination: project } = createProject({ target: createTarget("price-desk"), addons: listAddons().map(({ name }) => name) });

    const files = listFiles(project).map((file) => relative(project, file));

    expect(files).toContain(".claude/commands/workflow/status.md");
    expect(spawnSync("git", ["-C", project, "init", "--quiet"]).status).toBe(0);
    // The project's own rules only: the person's ignore file is not the project's.
    expect(spawnSync("git", ["-C", project, "config", "core.excludesFile", "/dev/null"]).status).toBe(0);
    expect(findIgnored(project, files)).toEqual([]);
    expect(findIgnored(project, ["node_modules/x/package.json", "coverage/lcov.info"])).not.toEqual([]);
  });

  it("refuses a target that already holds files", () => {
    const target = createTarget("taken");

    writeFileSync(join(target, "notes.txt"), "mine");

    expect(() => createProject({ target })).toThrow(ProjectError);
    expect(readdirSync(target)).toEqual(["notes.txt"]);
  });

  it("adds the add-ons asked for, in the order given", () => {
    const added: string[] = [];
    const { addons } = createProject(
      { target: createTarget("price-desk"), addons: ["coverage", "format-lint"] },
      createStepsThatRecord(added),
    );

    expect(added).toEqual(["coverage", "format-lint"]);
    expect(addons).toEqual(["coverage", "format-lint"]);
  });

  it("adds every recommended add-on when asked for the recommended set, and no other", () => {
    const added: string[] = [];

    createProject({ target: createTarget("price-desk"), addons: ["recommended"] }, createStepsThatRecord(added));

    expect(added).toEqual(["coverage", "format-lint"]);
  });

  it("lists what each add-on asks to be run once, in order, for the person to run after installing", () => {
    const { firstRuns } = createProject(
      { target: createTarget("price-desk"), addons: ["coverage", "format-lint"] },
      { ...createStepsThatRecord([]), addAddon: (_project, name) => (name === "format-lint" ? { firstRun: "pnpm biome:fix" } : {}) },
    );

    expect(firstRuns).toEqual(["pnpm biome:fix"]);
  });

  it("passes an option on with its add-on, and names the add-on with it", () => {
    const added: string[] = [];
    const { addons } = createProject({ target: createTarget("price-desk"), addons: ["visual:dark", "coverage"] }, createStepsThatRecord(added));

    expect(added).toEqual(["visual:dark", "coverage"]);
    expect(addons).toEqual(["visual:dark", "coverage"]);
  });

  it("adds an add-on once when it is named twice, with the option that was asked for, in the place it was first named", () => {
    const added: string[] = [];

    createProject({ target: createTarget("price-desk"), addons: ["visual", "coverage", "visual:dark", "coverage"] }, createStepsThatRecord(added));

    expect(added).toEqual(["visual:dark", "coverage"]);
  });

  it("refuses an option the add-on does not have, an option of an add-on with none, and two options of one choice, before writing anything", () => {
    const target = createTarget("price-desk");
    const create = (addons: string[]) => (): unknown => createProject({ target, addons }, createStepsThatRecord([]));

    expect(create(["visual:sepia"])).toThrow('the add-on "visual" has no option "sepia" — it has: light, dark');
    expect(create(["coverage:fast"])).toThrow('the add-on "coverage" has no options, so "coverage:fast" means nothing');
    expect(create(["visual:light", "visual:dark"])).toThrow('"visual:light" and "visual:dark" are two options of one choice');
    expect(readdirSync(target)).toEqual([]);
  });

  it("says in the README which option the project was created with, and what the add-on says about it", () => {
    const { destination } = createProject({ target: createTarget("price-desk"), addons: ["visual:dark"] }, createStepsThatRecord([]));

    expect(readReadme(destination)).toContain("- `visual:dark`: Goldens. Dark goldens.\n");
  });

  it("says what the default option is when none is named, in the README and in what it returns to print", () => {
    const { destination, options } = createProject({ target: createTarget("price-desk"), addons: ["visual", "coverage"] }, createStepsThatRecord([]));

    expect(readReadme(destination)).toContain("- `visual`: Goldens. Light goldens.\n");
    expect(options).toEqual(["visual, option light: Light goldens."]);
  });

  it("returns the option that was asked for, and nothing for an add-on with no choice", () => {
    const { options } = createProject({ target: createTarget("price-desk"), addons: ["coverage", "visual:dark"] }, createStepsThatRecord([]));

    expect(options).toEqual(["visual, option dark: Dark goldens."]);
  });

  it("adds none unless asked", () => {
    const added: string[] = [];

    createProject({ target: createTarget("price-desk") }, createStepsThatRecord(added));

    expect(added).toEqual([]);
  });

  it("refuses an add-on that does not exist before writing anything, and names the ones that do", () => {
    const target = createTarget("price-desk");
    const create = (): unknown => createProject({ target, addons: ["coverge"] }, createStepsThatRecord([]));

    expect(create).toThrow(/"coverge" is not an add-on.*coverage, format-lint, visual/s);
    expect(readdirSync(target)).toEqual([]);
  });

  it("reads the choice from the command line as one list", () => {
    expect(parseArguments(["desk", "--with", "coverage,format-lint"]).addons).toEqual(["coverage", "format-lint"]);
    expect(parseArguments(["desk", "--with", "recommended"]).addons).toEqual(["recommended"]);
    expect(parseArguments(["desk"]).addons).toBeUndefined();
  });

  it("has nothing left for a person to do after a normal run", () => {
    expect(createProject({ target: createTarget("price-desk") }).notes).toEqual([]);
  });

  it("runs every check of the kit in the gate, not only as a script somebody may call", () => {
    const target = createTarget("price-desk");

    createProject({ target });

    const { scripts } = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as { scripts: Record<string, string> };

    expect(scripts["gate:fast"]).toBe("pnpm gates && pnpm check:react-policies && pnpm check:compiler && pnpm lint && pnpm typecheck");
    expect(scripts["gate:full"]).toBe("pnpm gate:fast && pnpm test && pnpm build");
    expect(scripts.gates).toBe("node tools/arch/gates/run.mts");
    expect(scripts["check:react-policies"]).toBe("node tools/arch/check-react-policies.mts");
    expect(scripts["check:compiler"]).toBe("node tools/arch/check-compiler.mts");
    expect(scripts.lint).toBe("eslint --flag unstable_native_nodejs_ts_config --max-warnings 0 .");
  });

  it("passes on what the kit's setup could not do", () => {
    const { notes } = createProject({ target: createTarget("price-desk") }, { installKit: () => ({ notes: ["copy the hook file yourself"] }) });

    expect(notes).toEqual(["copy the hook file yourself"]);
  });

  it("leaves nothing behind in a folder that was empty, when a step fails", () => {
    const target = createTarget("half-made");

    expect(() => createProject({ target }, { installKit: failToInstall })).toThrow(/removed what it had written.*disk full/s);
    expect(readdirSync(target)).toEqual([]);
  });

  it("removes a folder it made itself, when a step fails", () => {
    const target = join(createTarget("parent"), "half-made");

    expect(() => createProject({ target }, { installKit: failToInstall })).toThrow(ProjectError);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a scope or a name that is not a valid package name", () => {
    expect(() => createProject({ target: createTarget("ok"), scope: "acme" })).toThrow(/not a package scope/);
    expect(() => createProject({ target: createTarget("ok"), name: "My App" })).toThrow(/not a package name/);
  });
});

describe("the README of a created project", () => {
  it("is titled with the project's name, and does not describe the starter", () => {
    const readme = readReadme(createProject({ target: createTarget("price-desk") }).destination);

    expect(readme.split("\n")[0]).toBe("# price-desk");
    expect(readme).not.toMatch(/starter/i);
  });

  it("takes the title from --name when one is given", () => {
    const readme = readReadme(createProject({ target: createTarget("some-folder"), name: "rates-board" }).destination);

    expect(readme.split("\n")[0]).toBe("# rates-board");
  });

  it("shows the project's own scope in every command and import, and never the starter's", () => {
    const readme = readReadme(createProject({ target: createTarget("price-desk"), scope: "@acme" }).destination);

    expect(readme).toContain("pnpm --filter @acme/domain test");
    expect(readme).toContain('import type { PricePort } from "@acme/domain";');
    expect(readme).not.toContain("@app");
  });

  it("names the add-ons the project was created with, each with what it gives, in the order added", () => {
    const { destination } = createProject({ target: createTarget("price-desk"), addons: ["format-lint", "coverage"] }, createStepsThatRecord([]));

    expect(readReadme(destination)).toContain(
      "Added when the project was created:\n\n- `format-lint`: A formatter and a linter.\n- `coverage`: A coverage gate.\n",
    );
  });

  it("says that no add-on was added when none was", () => {
    const readme = readReadme(createProject({ target: createTarget("price-desk") }).destination);

    expect(readme).toContain("None was added when the project was created.");
    expect(readme).not.toContain("Added when the project was created:");
  });

  it("gives the first commands in the order they are run, with what an add-on asks to be run once before the gate", () => {
    const { destination } = createProject(
      { target: createTarget("price-desk"), addons: ["format-lint"] },
      { ...createStepsThatRecord([]), addAddon: () => ({ firstRun: "pnpm biome:fix" }) },
    );
    const first = /## First\n\n```bash\n([^`]*)```/.exec(readReadme(destination))?.[1] ?? "";

    expect(first.split("\n").map((line) => line.replace(/\s+#.*$/, ""))).toEqual(["git init", "pnpm install", "pnpm biome:fix", "pnpm gate:full", ""]);
  });

  it("leaves no placeholder unfilled", () => {
    expect(readReadme(createProject({ target: createTarget("price-desk") }).destination)).not.toMatch(/\{\{|\}\}/);
  });

  it("refuses a template that asks for something a project does not have", () => {
    const write = (): string => projectReadme({ name: "price-desk", scope: "@acme", addons: [], firstRuns: [] }, "# {{name}} by {{author}}\n");

    expect(write).toThrow(ProjectError);
    expect(write).toThrow('the README template asks for "{{author}}"');
  });

  // The template is prose, so nothing else notices when the starter drops a
  // script or a file the README still names.
  it("names only scripts the starter has, and links only to files a project has", () => {
    const { destination } = createProject({ target: createTarget("price-desk") });
    const readme = readReadme(destination);
    const scripts = Object.keys(JSON.parse(readFileSync(join(destination, "package.json"), "utf8")).scripts);
    const named = [...readme.matchAll(/^pnpm (?!install|--filter)([\w:-]+)/gm)].map((match) => match[1]);
    const linked = [...readme.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1] as string);

    expect(named).toEqual(["gate:full", "dev", "dev:fs", "gate:fast", "gate:full", "gate:full:quiet"]);
    expect(named.filter((script) => !scripts.includes(script as string))).toEqual([]);
    expect(linked).toEqual(["AGENTS.md", "tools/arch/README.md"]);
    expect(linked.filter((path) => !existsSync(join(destination, path)))).toEqual([]);
    expect(existsSync(join(destination, "packages/domain/src/ports/pricePort.ts"))).toBe(true);
  });
});

describe("the AGENTS.md of a created project", () => {
  // Without this section, Codex asked for end-to-end tests or CI security checks
  // in a created project read AGENTS.md, skipped the skill and planned to write
  // the add-on by hand, in 4 runs of 6 (pnpm evals:codex, 2026-10-16). With it,
  // in none of 12.
  it("tells an agent that a check comes through the installer, by the record it keeps and the skill that runs it", () => {
    const { destination } = createProject({ target: createTarget("price-desk") });
    const agents = readFileSync(join(destination, "AGENTS.md"), "utf8");
    const section = agents.slice(agents.indexOf("## Adding a check"), agents.indexOf("## Reviewing a change"));

    expect(section).toContain("`tools/installed.json`");
    expect(section).toContain("`extending-a-project`");
    expect(section).toContain("run with no arguments it lists the add-ons");
    expect(existsSync(join(destination, "tools/installed.json"))).toBe(true);
    expect(existsSync(new URL("../skills/extending-a-project/SKILL.md", import.meta.url))).toBe(true);
  });
});

function readReadme(project: string): string {
  return readFileSync(join(project, "README.md"), "utf8");
}

/** Steps with three add-ons to choose from, two of them recommended and one with a choice, that record what was added. */
function createStepsThatRecord(added: string[]): Partial<ProjectSteps> {
  return {
    listAddons: () => [
      { name: "coverage", summary: "A coverage gate.", recommended: true },
      { name: "format-lint", summary: "A formatter and a linter.", recommended: true },
      { name: "visual", summary: "Goldens.", recommended: false, choice: { default: "light", options: { light: "Light goldens.", dark: "Dark goldens." } } },
    ],
    addAddon: (_project, name) => {
      added.push(name);

      return {};
    },
  };
}

function failToInstall(): never {
  throw new Error("disk full");
}

/** An empty folder with the given name, inside a fresh temporary folder. */
function createTarget(name: string): string {
  const target = join(mkdtempSync(join(tmpdir(), "create-project-")), name);

  mkdirSync(target);

  return target;
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
