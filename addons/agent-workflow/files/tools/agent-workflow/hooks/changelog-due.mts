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
//
// This file imports nothing of the add-on at the top: the lib modules are
// loaded inside the guard below, so that one that is missing, half updated or
// broken (a project caught midway through an update) still gives silence and
// exit 0, not a stack trace. The work is in `lib/due-reminder.mts`. The hook is
// only ever started as a script, so it has no `isMainModule` guard.

import { readFileSync } from "node:fs";

let reply = "";

try {
  const { replyTo } = (await import("../lib/due-reminder.mts")) as typeof import("../lib/due-reminder.mts");
  const { run } = (await import("../lib/system.mts")) as typeof import("../lib/system.mts");

  reply = replyTo(readFileSync(0, "utf8"), run, new Date(), process.cwd());
} catch {
  // A lib file that will not load, or no input to read: nothing to say.
}

try {
  // A closed pipe is reported as an event, after the write: it too is ignored.
  process.stdout.on("error", () => {});

  if (reply !== "") {
    process.stdout.write(`${reply}\n`);
  }
} catch {
  // The host closed the pipe: nothing to tell it.
}

process.exitCode = 0;
