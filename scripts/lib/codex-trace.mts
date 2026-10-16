// Which skills a Codex run loaded, read from the events `codex exec --json`
// prints. Codex lists each skill's name and description to the model, and the
// model loads one by reading its SKILL.md with a shell command. So a skill
// counts as loaded when a command the run executed names that file.

interface CodexEvent {
  type?: string;
  item?: { type?: string; command?: string };
}

export function skillsLoadedIn(trace: string, skills: string[]): string[] {
  const commands = trace
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as CodexEvent)
    .filter((event) => event.type === "item.completed" && event.item?.type === "command_execution")
    .map((event) => event.item?.command ?? "");

  return skills.filter((skill) => commands.some((command) => command.includes(`skills/${skill}/SKILL.md`)));
}

/** Whether a run loaded every skill the case expects and none it expects left alone. */
export function verdictOf(loaded: string[], expected: { loads: string[]; leaves: string[] }): { passed: boolean; missing: string[]; unwanted: string[] } {
  const missing = expected.loads.filter((skill) => !loaded.includes(skill));
  const unwanted = expected.leaves.filter((skill) => loaded.includes(skill));

  return { passed: missing.length === 0 && unwanted.length === 0, missing, unwanted };
}
