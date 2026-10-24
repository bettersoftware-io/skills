#!/usr/bin/env node
// SessionStart hook: names the finished weeks whose CHANGELOG.md entry is
// missing or does not cite every pull request merged in them, as context the
// agent is given at the start of a session.
//
// It reads git alone, as of the last fetch of the default branch, so it runs
// offline and in a moment. When it cannot judge (no git, no origin, no
// CHANGELOG.md, anything unforeseen) or nothing is due, it prints nothing and
// exits 0: a session must never be held up or alarmed by it.
//
// Both hosts take the same output. Codex's hook contract, from
// https://developers.openai.com/codex/hooks (which redirects to
// https://learn.chatgpt.com/docs/hooks), checked on 2026-10-24: a
// SessionStart hook adds context either as plain text on stdout or as
// `hookSpecificOutput` with `hookEventName` "SessionStart" and an
// `additionalContext` string; its matcher filters on the start source
// (`startup`, `resume`, `clear`, `compact`, `fork`); its payload has `cwd`
// and no `turn_id`, so the two hosts cannot be told apart here and need not
// be. The JSON form is used for both.

import { readFileSync } from "node:fs";

import { describeDue, findDue } from "../lib/due.mts";
import { isMainModule } from "../lib/main.mts";
import { run, type Run } from "../lib/system.mts";

/** The text for the due weeks, as the session context. */
function contextFor(lines: string[]): string {
  return [
    "Changelog: as of the last fetch of the default branch, these weeks are due in CHANGELOG.md:",
    ...lines,
    "Mention this to the person at a natural point; do not drop the task you were given to write it. In Codex the command is $workflow-changelog <week>.",
  ].join("\n");
}

/** The folder the host names as the session's, else the one the hook was started in. */
function rootOf(input: string): string {
  try {
    const { cwd } = JSON.parse(input) as { cwd?: unknown };

    return typeof cwd === "string" && cwd !== "" ? cwd : process.cwd();
  } catch {
    return process.cwd();
  }
}

/** The reply for one payload, as the text to print. Empty when there is nothing to say. */
export function replyTo(input: string, runProgram: Run, now: Date): string {
  try {
    const due = findDue(rootOf(input), runProgram, now);

    return due.length === 0
      ? ""
      : JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: contextFor(due.map(describeDue)) } });
  } catch {
    // Not judged, or anything nobody foresaw: no reminder.
    return "";
  }
}

if (isMainModule(import.meta.url)) {
  let reply = "";

  try {
    reply = replyTo(readFileSync(0, "utf8"), run, new Date());
  } catch {
    // No input to read: nothing to say.
  }

  if (reply !== "") {
    process.stdout.write(`${reply}\n`);
  }

  process.exitCode = 0;
}
