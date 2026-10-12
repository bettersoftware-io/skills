import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createDownload, extractWithTar, findCommand, hasCommand, runCaptured, runInherited } from "../files/tools/ci-security/lib/system.mts";
import { ADDON, createFolder } from "./support.mts";

describe("createDownload", () => {
  it("returns the bytes of the response", async () => {
    const download = createDownload(() => Promise.resolve(new Response("the archive")));

    expect(Buffer.from(await download("https://example.test/a.tar.gz")).toString()).toBe("the archive");
  });

  it("follows the redirect a release download answers with, and gives up after a minute", async () => {
    const requests: { url: string; redirect?: string; hasTimeout: boolean }[] = [];
    const download = createDownload((url, init) => {
      requests.push({ url: String(url), redirect: init?.redirect, hasTimeout: init?.signal instanceof AbortSignal });

      return Promise.resolve(new Response(""));
    });

    await download("https://example.test/a.tar.gz");

    expect(requests).toEqual([{ url: "https://example.test/a.tar.gz", redirect: "follow", hasTimeout: true }]);
  });

  it("fails on an answer that is not the file, such as a 404 page", async () => {
    const download = createDownload(() => Promise.resolve(new Response("not found", { status: 404, statusText: "Not Found" })));

    await expect(download("https://example.test/a.tar.gz")).rejects.toThrow("the server answered 404 Not Found");
  });

  it("gives the reason under fetch's own 'fetch failed'", async () => {
    const download = createDownload(() => Promise.reject(new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND github.com") })));

    await expect(download("https://example.test/a.tar.gz")).rejects.toThrow("getaddrinfo ENOTFOUND github.com");
  });
});

describe("extractWithTar", () => {
  it("takes the one named file out of a gzipped tar archive", () => {
    const folder = createFolder({ "in/linter": "the linter", "in/README.md": "notes", "out/.keep": "" });

    execFileSync("tar", ["-czf", join(folder, "archive.tar.gz"), "-C", join(folder, "in"), "linter", "README.md"]);
    extractWithTar(join(folder, "archive.tar.gz"), join(folder, "out"), "linter");

    expect(readFileSync(join(folder, "out/linter"), "utf8")).toBe("the linter");
    expect(spawnSync("ls", [join(folder, "out/README.md")]).status).not.toBe(0);
  });

  it("throws when the archive does not hold the file", () => {
    const folder = createFolder({ "in/other": "x", "out/.keep": "" });

    execFileSync("tar", ["-czf", join(folder, "archive.tar.gz"), "-C", join(folder, "in"), "other"]);

    expect(() => extractWithTar(join(folder, "archive.tar.gz"), join(folder, "out"), "linter")).toThrow();
  });
});

describe("runInherited", () => {
  it("returns the exit status of the program, run in the folder given", () => {
    const folder = createFolder({ "marker.txt": "" });
    const script = 'process.exit(require("node:fs").existsSync("marker.txt") ? 14 : 99)';

    expect(runInherited(process.execPath, ["-e", script], folder)).toBe(14);
  });

  it("returns null for a program that does not start", () => {
    expect(runInherited(join(createFolder(), "not-there"), [], createFolder())).toBeNull();
  });
});

describe("runCaptured", () => {
  it("returns the exit status and what the program printed, run in the folder given", () => {
    const folder = createFolder({ "marker.txt": "" });
    const script = 'process.stdout.write("out"); process.stderr.write("err"); process.exit(require("node:fs").existsSync("marker.txt") ? 14 : 99)';

    expect(runCaptured(process.execPath, ["-e", script], folder)).toEqual({ status: 14, stdout: "out", stderr: "err" });
  });

  it("returns 127 and the reason for a program that is not installed, and does not throw", () => {
    const missing = join(createFolder(), "not-there");
    const result = runCaptured(missing, [], createFolder());

    expect(result.status).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("ENOENT");
  });
});

describe("runCaptured, for a program given by its name", () => {
  it("starts the one in a folder of the PATH", () => {
    expect(runCaptured("node", ["-e", "process.exit(3)"], createFolder()).status).toBe(3);
  });

  it("returns 127 and says so for a name that is in no folder of the PATH, and starts nothing", () => {
    expect(runCaptured("no-program-has-this-name", [], createFolder())).toEqual({ status: 127, stdout: "", stderr: "no-program-has-this-name is in no folder of the PATH" });
  });
});

describe("runCaptured, for a program that is in the folder it runs in", () => {
  it("does not start a program of that name that is inside the folder it runs in, and starts it for another folder", () => {
    const project = createFolder({ "program-of-the-project": "#!/bin/sh\nexit 5\n" });
    const before = process.env.PATH;

    chmodSync(join(project, "program-of-the-project"), 0o755);
    process.env.PATH = project;

    try {
      expect(runCaptured("program-of-the-project", [], project).status).toBe(127);
      expect(runCaptured("program-of-the-project", [], createFolder()).status).toBe(5);
    } finally {
      process.env.PATH = before;
    }
  });
});

describe("runCaptured, and the PATH of the program it starts", () => {
  it("gives the program only the folders no project fills, so that what it starts by name is not the project's either", () => {
    const project = createFolder({ "node_modules/.bin/.keep": "", "bin/.keep": "" });
    const programs = createFolder({ "say-path": '#!/bin/sh\nprintf %s "$PATH"\n' });
    const before = process.env.PATH;

    chmodSync(join(programs, "say-path"), 0o755);
    process.env.PATH = [join(project, "node_modules/.bin"), join(project, "bin"), ".", programs, "/usr/bin"].join(":");

    try {
      expect(runCaptured("say-path", [], project).stdout).toBe(`${programs}:/usr/bin`);
    } finally {
      process.env.PATH = before;
    }
  });
});

describe("findCommand", () => {
  /** A folder holding one program, `gh`, at `at`. */
  const withProgram = (at: string): string => {
    const folder = createFolder({ [`${at}/gh`]: "#!/bin/sh\n" });

    chmodSync(join(folder, at, "gh"), 0o755);

    return folder;
  };

  it("gives the full path of a program in a folder of the PATH, and a full path as it was given", () => {
    const bin = join(withProgram("bin"), "bin");

    expect(findCommand("gh", `/nowhere:${bin}`)).toBe(join(bin, "gh"));
    expect(findCommand("/nowhere/gh", bin)).toBe("/nowhere/gh");
    expect(findCommand("gh", "/nowhere")).toBeUndefined();
    expect(findCommand("gh", undefined)).toBeUndefined();
  });

  it("passes over a folder of the PATH that is not written in full, so a file in the folder a program is started in is not found", () => {
    const bin = relative(process.cwd(), join(withProgram("bin"), "bin"));

    expect(findCommand("gh", bin)).toBeUndefined();
    expect(findCommand("gh", `.:${bin}:`)).toBeUndefined();
    expect(findCommand("gh", resolve(bin))).toBe(resolve(bin, "gh"));
  });

  it("does not look on the PATH for a name with a folder in it", () => {
    expect(findCommand("bin/gh", withProgram("bin"))).toBeUndefined();
  });

  it("passes over node_modules/.bin, where pnpm puts first what a dependency ships", () => {
    const folder = withProgram("node_modules/.bin");

    expect(findCommand("gh", join(folder, "node_modules/.bin"))).toBeUndefined();
    expect(findCommand("gh", `${join(folder, "node_modules/.bin")}/`)).toBeUndefined();
  });

  it("passes over a folder inside the project the program is started for, reached by a link too, and takes it for another project", () => {
    const project = withProgram("tools/bin");
    const link = join(createFolder(), "link");

    symlinkSync(join(project, "tools/bin"), link);

    expect(findCommand("gh", join(project, "tools/bin"), project)).toBeUndefined();
    expect(findCommand("gh", link, project)).toBeUndefined();
    expect(findCommand("gh", join(project, "tools/bin"), join(project, "tools/bin"))).toBeUndefined();
    expect(findCommand("gh", join(project, "tools/bin"), createFolder())).toBe(join(project, "tools/bin/gh"));
  });

  it("takes a folder beside the project, though its name begins with the project's", () => {
    const project = createFolder();
    const beside = `${project}-tools`;

    mkdirSync(beside);
    writeFileSync(join(beside, "gh"), "#!/bin/sh\n", { mode: 0o755 });

    expect(findCommand("gh", beside, project)).toBe(join(beside, "gh"));
  });
});

describe("hasCommand", () => {
  it("finds a program that is in a folder of the PATH and can be run", () => {
    const folder = createFolder({ "bin/shellcheck": "#!/bin/sh\n" });

    chmodSync(join(folder, "bin/shellcheck"), 0o755);

    expect(hasCommand("shellcheck", `/nowhere:${join(folder, "bin")}`)).toBe(true);
  });

  it("does not take a file that cannot be run, a missing program or an empty PATH for one", () => {
    const folder = createFolder({ "bin/shellcheck": "notes" });

    chmodSync(join(folder, "bin/shellcheck"), 0o644);

    expect(hasCommand("shellcheck", join(folder, "bin"))).toBe(false);
    expect(hasCommand("pyflakes", join(folder, "bin"))).toBe(false);
    expect(hasCommand("shellcheck", undefined)).toBe(false);
  });
});

describe("node tools/ci-security/lint-workflows.mts", () => {
  it("exits 2 and says there was nothing to lint in a project with no workflow, before it downloads anything", () => {
    const result = runTool(createProject({}));

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("SKIP workflow lint: .github/workflows holds no .yml or .yaml file, so there was nothing to lint.\n");
  });

  it("exits 2 on a name that is not a linter", () => {
    const result = runTool(createProject({ ".github/workflows/ci.yml": "name: CI\n" }), "eslint");

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('SKIP workflow lint: there is no linter called "eslint". Choose from: actionlint, zizmor.\n');
  });
});

/** A project folder holding the add-on's tools, where a project has them. */
function createProject(files: Record<string, string>): string {
  const project = createFolder(files);

  cpSync(join(ADDON, "files/tools"), join(project, "tools"), { recursive: true });

  return project;
}

function runTool(project: string, ...toolArguments: string[]): { status: number | null; stdout: string } {
  const { status, stdout } = spawnSync(process.execPath, [join(project, "tools/ci-security/lint-workflows.mts"), ...toolArguments], { encoding: "utf8" });

  return { status, stdout };
}
