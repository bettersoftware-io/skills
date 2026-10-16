import { describe, expect, it } from "vitest";

import { skillsLoadedIn, verdictOf } from "./codex-trace.mts";

const SKILLS = ["creating-a-project", "extending-a-project"];

describe("the skills a Codex run loaded", () => {
  it("are those whose SKILL.md a command it ran names", () => {
    const trace = traceOf([
      commandRun("/bin/zsh -lc 'rg --files -g package.json'"),
      commandRun("/bin/zsh -lc 'cat /Users/me/.codex/plugins/cache/bettersoftware/bettersoftware-skills/0.15.0/skills/extending-a-project/SKILL.md && cat package.json'"),
    ]);

    expect(skillsLoadedIn(trace, SKILLS)).toEqual(["extending-a-project"]);
  });

  it("leave out a command that was only started, and a message that names the file", () => {
    const trace = traceOf([
      { type: "item.started", item: { type: "command_execution", command: "cat skills/creating-a-project/SKILL.md" } },
      { type: "item.completed", item: { type: "agent_message", text: "I will read skills/creating-a-project/SKILL.md" } },
    ]);

    expect(skillsLoadedIn(trace, SKILLS)).toEqual([]);
  });

  it("are none in an empty trace", () => {
    expect(skillsLoadedIn("", SKILLS)).toEqual([]);
  });
});

describe("a Codex run's verdict", () => {
  it("passes when every expected skill was loaded and none to be left alone", () => {
    expect(verdictOf(["extending-a-project"], { loads: ["extending-a-project"], leaves: ["creating-a-project"] }).passed).toBe(true);
  });

  it("says which skill was missing, and which was loaded that should not have been", () => {
    expect(verdictOf(["creating-a-project"], { loads: ["extending-a-project"], leaves: ["creating-a-project"] })).toEqual({
      passed: false,
      missing: ["extending-a-project"],
      unwanted: ["creating-a-project"],
    });
  });
});

function commandRun(command: string): object {
  return { type: "item.completed", item: { type: "command_execution", command, exit_code: 0 } };
}

function traceOf(events: object[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}
