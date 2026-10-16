import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { checkStatus, formatFindings, localToday, SECTIONS } from "../files/tools/agent-workflow/check-status.mts";
import { ADDON, createFolder, git, TOOLS, writeFile } from "./support.mts";

const STARTING = readFileSync(join(ADDON, "files/docs/STATUS.md"), "utf8");
const TODAY = "2026-10-16";

describe("the page the add-on starts a project with", () => {
  it("is in the form: six sections, a date line, no entry", () => {
    expect(checkStatus({ text: STARTING, committed: undefined, today: TODAY })).toEqual([]);
  });

  it("names its sections in the order the check holds them to", () => {
    expect(STARTING.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3))).toEqual(SECTIONS);
  });
});

describe("a page with entries", () => {
  it("passes with a bold name on each entry and a date that is today or earlier", () => {
    expect(checkStatus({ text: createPage({ "In progress": ["- **Login** — the reset link is left"] }, "2026-10-15"), committed: undefined, today: TODAY })).toEqual([]);
  });

  it("fails an entry that does not start with its name in bold, and leaves a bullet nested under an entry alone", () => {
    const text = createPage({ "Known limits": ["- **Reports** — slow on big months", "  - measured on one machine", "- the CSV has no header"] }, TODAY);

    expect(messagesOf(text)).toEqual(["an entry starts with its name in bold: `- **Name** — what is left`"]);
  });

  it("fails a page with entries that still says no entry yet", () => {
    expect(messagesOf(createPage({ "In progress": ["- **Login** — left"] }, "no entry yet"))).toEqual([
      `it says "no entry yet", and the page has entries. Write today's date: ${TODAY}`,
    ]);
  });
});

describe("the sections", () => {
  it("fails one that is missing, one twice, and one of the page's own", () => {
    const text = STARTING.replace("## Known limits", "## Ideas").replace("## Waiting on a person", "## In progress");

    expect(messagesOf(text)).toEqual([
      `"## Ideas" is not one of the page's sections (${SECTIONS.join("; ")}). Move its entries into the one that fits`,
      `"## In progress" is there 2 times. Keep one, with every entry of the others in it`,
      `"## Waiting on a person" is not there. Put it back, empty if nothing is in it`,
      `"## Known limits" is not there. Put it back, empty if nothing is in it`,
    ]);
  });

  it("fails them out of order", () => {
    const text = STARTING.replace("## In progress", "## @@").replace("## Known limits", "## In progress").replace("## @@", "## Known limits");

    expect(messagesOf(text)).toEqual([`the sections are out of order. They go: ${SECTIONS.join("; ")}`]);
  });
});

describe("the date", () => {
  it("fails one that is no day, one after today, and a page with two date lines", () => {
    expect(messagesOf(createPage({}, "2026-02-30"))).toEqual([`"2026-02-30" is not a date written YYYY-MM-DD`]);
    expect(messagesOf(createPage({}, "2026-10-17"))).toEqual([`2026-10-17 is after today, ${TODAY}`]);
    expect(messagesOf(`${createPage({}, TODAY)}\n**Last updated: ${TODAY}**\n`)).toEqual([`the page has 2 "**Last updated: …**" lines, and has one`]);
  });

  it("fails a page that changed since the last commit when its date did not move", () => {
    const committed = createPage({ "In progress": ["- **Login** — two steps left"] }, "2026-10-10");
    const text = createPage({ "In progress": ["- **Login** — one step left"] }, "2026-10-10");

    expect(checkStatus({ text, committed, today: TODAY }).map(({ message }) => message)).toEqual([
      `the page changed since the last commit, and its date did not move. Write today's: ${TODAY}`,
    ]);
    expect(checkStatus({ text: text.replace("2026-10-10", TODAY), committed, today: TODAY })).toEqual([]);
  });

  it("does not judge an old date on a page the commit has as it is, which is what CI checks out", () => {
    const text = createPage({ "In progress": ["- **Login** — left"] }, "2026-09-01");

    expect(checkStatus({ text, committed: text, today: TODAY })).toEqual([]);
  });

  it("writes today as the person's own calendar has it, not as UTC has it", () => {
    // Half past midnight in Auckland, which is still the day before in UTC. A
    // process of its own, since a test's worker thread cannot change its zone.
    const script = `import { localToday } from ${JSON.stringify(pathToFileURL(join(TOOLS, "check-status.mts")).href)}; console.log(localToday(new Date(2026, 0, 6, 0, 30)));`;
    const ran = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, TZ: "Pacific/Auckland" } });

    expect(ran.stdout.trim()).toBe("2026-01-06");
  });

});

describe("the command", () => {
  it("passes the starting page in a project with no commit, and says what it judged", () => {
    const { status, stdout } = run(createFolder({ "docs/STATUS.md": STARTING }));

    expect([status, stdout.trim()]).toEqual([0, "PASS docs/STATUS.md — its sections, its date and its entries are in the page's form"]);
  });

  it("fails a page edited after the last commit without a new date, by line, and exits 1", () => {
    const project = createFolder({ "docs/STATUS.md": createPage({}, "2026-10-01") });

    git(project, "init", "--quiet");
    git(project, "add", ".");
    git(project, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--quiet", "-m", "start");
    writeFile(project, "docs/STATUS.md", createPage({ "In progress": ["- **Login** — left"] }, "2026-10-01"));

    const { status, stdout } = run(project);

    expect(status).toBe(1);
    expect(stdout).toContain(`docs/STATUS.md:${dateLineOf(createPage({}, "2026-10-01"))}: the page changed since the last commit, and its date did not move. Write today's: ${localToday()}`);
  });

  it("fails a project with no page", () => {
    const { status, stdout } = run(createFolder({ "README.md": "x\n" }));

    expect(status).toBe(1);
    expect(stdout).toContain("FAIL docs/STATUS.md — it is not there");
  });

  it("prints each finding under one FAIL line", () => {
    expect(formatFindings([{ line: 3, message: "a" }, { line: 0, message: "b" }])).toBe("FAIL docs/STATUS.md (2)\n  docs/STATUS.md:3: a\n  docs/STATUS.md: b");
  });
});

function messagesOf(text: string): string[] {
  return checkStatus({ text, committed: undefined, today: TODAY }).map(({ message }) => message);
}

/** The starting page with these entries under their sections and this date. */
function createPage(entries: Record<string, string[]>, date: string): string {
  let text = STARTING.replace("**Last updated: no entry yet**", `**Last updated: ${date}**`);

  for (const [section, lines] of Object.entries(entries)) {
    text = text.replace(`## ${section}\n`, `## ${section}\n\n${lines.join("\n")}\n`);
  }

  return text;
}

function dateLineOf(text: string): number {
  return text.split("\n").findIndex((line) => line.startsWith("**Last updated:")) + 1;
}

function run(project: string): { status: number | null; stdout: string } {
  return spawnSync(process.execPath, [join(TOOLS, "check-status.mts")], { cwd: project, encoding: "utf8" });
}
