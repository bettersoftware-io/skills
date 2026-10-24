// The session-start reminder's text, from the weeks that are due. It is kept
// apart from `hooks/changelog-due.mts` so that the hook can load it inside a
// guard: a lib file that is missing or broken must not make the hook fail.

import { describeDue, findDue } from "./due.mts";
import { type Run } from "./system.mts";

/** The most weeks the reminder names. A project far behind gets a count for the rest. */
const MOST_WEEKS = 5;

/** The text for the due weeks, as the session context. */
function contextFor(lines: string[]): string {
  const more = lines.length - MOST_WEEKS;

  return [
    "Changelog: as of the last fetch of the default branch, these weeks are due in CHANGELOG.md:",
    ...lines.slice(0, MOST_WEEKS),
    ...(more > 0 ? [`… and ${more} more: run pnpm changelog due`] : []),
    "Mention this to the person at a natural point; do not drop the task you were given to write it. In Codex the command is $workflow-changelog <week>.",
  ].join("\n");
}

/** The folder the host names as the session's, else `fallback`. */
function rootOf(input: string, fallback: string): string {
  try {
    const { cwd } = JSON.parse(input) as { cwd?: unknown };

    return typeof cwd === "string" && cwd !== "" ? cwd : fallback;
  } catch {
    return fallback;
  }
}

/** The reply for one payload, as the text to print. Empty when there is nothing to say. */
export function replyTo(input: string, runProgram: Run, now: Date, fallback: string): string {
  try {
    const due = findDue(rootOf(input, fallback), runProgram, now);

    return due.length === 0
      ? ""
      : JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: contextFor(due.map(describeDue)) } });
  } catch {
    // Not judged, or anything nobody foresaw: no reminder.
    return "";
  }
}
