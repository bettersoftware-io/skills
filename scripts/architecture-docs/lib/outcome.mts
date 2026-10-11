// How a script that has no verdict says so. Node built-ins only.

/** The script has no verdict: a path is not there, a tool is missing, could not be fetched, or crashed. Exit 2. */
export class CouldNotRun extends Error {}

/** The first line of what a tool printed that says anything, for a "could not run" message. */
export function firstLine(...outputs: string[]): string {
  for (const output of outputs) {
    const line = output.split("\n").find((candidate) => candidate.trim() !== "");

    if (line !== undefined) {
      return line.trim();
    }
  }

  return "it printed nothing.";
}
