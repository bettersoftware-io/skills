#!/usr/bin/env node
// PreToolUse hook, with two answers: a refusal, and for one kind of push a
// question.
//
// It refuses a shell command that joins an outward step (a push, a pull
// request written to, a workflow started) to anything else.
//
// Why: a host judges a joined command as a whole. `git add -A && git commit
// -m … && git push && gh pr create` raises one prompt, labelled with its
// first word, so the person sees "git add needs permission", the local steps
// wait on the outward one, and one yes covers actions the prompt never
// showed. An outward step therefore runs as a call of its own, at the start
// or the end of a piece of work.
//
// A pipe into a filter (`git push 2>&1 | tail -2`) is still one step and is
// let through. So is `gh pr create --body "$(cat <<'EOF' … EOF)"`: the inner
// command only feeds the outer one.
//
// A command this cannot read (a quote that never closes, or a form shells
// read differently, such as a `case` inside `$(…)`) is not refused: the
// host's own permission rules still judge it, and when it names an outward
// step Claude Code is given the question too. The refusal orders the work;
// it is not what keeps a push from happening. A command this will not read
// (longer than a million characters, nested more than forty deep, or a
// wrapper followed by more than 32 words that name git, gh or a shell) is
// refused when it holds the word `push`, `gh` or `git` at all, and so is a
// command the reader fails on: a chain must not get through because it was
// written to be hard to read. `git` counts there because git may run a push
// under an alias the text does not show.
//
// It asks about a push that is not written plainly: one that holds a colon
// (`source:target`, `:target`), which can write to another branch than the
// one it names first, or delete one; an option that changes what is pushed,
// written out, cut short (`--de`) or joined to another (`-uf`); a quote,
// which hides a word from a rule (`-"f"`); a word the shell turns into
// another (`"$BRANCH"`). `lib/outward.mts` says what plain is. A project that
// allows a push by a rule of its own is still asked about these. No
// permission rule can say it: Claude Code reads `Bash(git push *:*)`
// as its older prefix form, which matches nothing here, and warns about a
// `:*` wherever it stands. Only Claude Code is given the question. Codex
// calls `ask` an answer it does not support, so there the hook says nothing
// and Codex's own approval decides, as it did before.
//
// For any other command it says nothing, and the host asks as it always does.
// It never says yes to a command: `Answer` has no such decision. The README
// says why, under "Why the hook does not approve anything".
//
// It reads standard input and nothing else: no file, no setting, no start-up
// argument, and it starts no program. An argument it is given is ignored, so
// a settings file that still starts it with one from an older version works.
//
// It never ends without an answer it meant to give: whatever fails inside
// it, it says nothing and exits 0.
//
// Works under Claude Code (the `Bash` tool, and `Monitor`, which runs a
// command under the rules for `Bash`: `tool_input.command` is text) and
// Codex (its shell tool: the same field, as text or as a list of words). Both
// read the same refusal: `permissionDecision` with a reason, on stdout. The
// two are told apart by `turn_id`, which Codex sends with every call and
// Claude Code does not send.

import { readFileSync } from "node:fs";

import { isMainModule } from "../lib/main.mts";
import { judgeCommand, mentionsGit, mentionsOutward, type Verdict, WrappedLimitError } from "../lib/outward.mts";

/** The fields a host sends that this hook reads. */
export interface CommandPayload {
  tool_name?: string;
  tool_input?: { command?: unknown; [field: string]: unknown };
  /** Codex's name for the turn a call belongs to. Claude Code sends no such field. */
  turn_id?: unknown;
}

/** What the hook says: a refusal, or a question for a person. To leave a call to the host's own rules it says nothing. */
export interface Answer {
  decision: "deny" | "ask";
  reason: string;
}

/** The command line a tool call will run, from either host's payload. */
export function commandOf(payload: CommandPayload): string | undefined {
  const command = payload.tool_input?.command;

  if (typeof command === "string") {
    return command;
  }

  if (Array.isArray(command) && command.every((word) => typeof word === "string")) {
    // Words, already split: quote each one so that it is read back as one.
    return (command as string[]).map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(" ");
  }

  return undefined;
}

/** The answer to give the host, or undefined to say nothing and leave the call to its own rules. */
export function judgeCall(payload: CommandPayload): Answer | undefined {
  const command = commandOf(payload);
  let verdict: Verdict | undefined;

  try {
    verdict = command === undefined ? undefined : judgeCommand(command);
  } catch (error) {
    // Not read: too long, nested too deep, or the reader itself failed. A chain must not pass for that.
    return command !== undefined && (error instanceof WrappedLimitError || mentionsOutward(command) || mentionsGit(command))
      ? {
          decision: "deny",
          reason: [
            "Refused: this command is too long or too deeply nested to be read, and it names an outward step (push, gh) or git.",
            "Run each outward step as a short tool call of its own, with nothing else in it.",
          ].join("\n"),
        }
      : undefined;
  }

  if (verdict === undefined) {
    // Not read, and not for its size: a quote or a heredoc left open, or a form shells read differently. What it does is not known, so a person is asked when it names an outward step.
    return command !== undefined && mentionsOutward(command) && readsAQuestion(payload)
      ? {
          decision: "ask",
          reason:
            "This command could not be read (a quote or a heredoc is left open, or it is written in a form shells read differently), and it names an outward step (push, gh), so a person is asked whatever rule allows it.",
        }
      : undefined;
  }

  if (verdict.chained) {
    return {
      decision: "deny",
      reason: [
        `Refused: this command joins an outward step (${verdict.outward.join(", ")}) to other commands.`,
        "Run each outward step (git push, gh pr create or merge, gh workflow run, a gh api write) as a tool call of its own,",
        "and put those calls together at the start or the end of the work. Local steps (git add, git commit, tests) go in separate calls.",
        "Split the command. Do not reword it to get past this check.",
      ].join("\n"),
    };
  }

  return verdict.redirected && readsAQuestion(payload)
    ? {
        decision: "ask",
        reason: [
          "This push is not written plainly. It holds a colon (source:target, :target, a remote written as a URL), an option that changes what is pushed,",
          "a quote or a backslash, a value set in front of git, or a word the shell turns into another before git reads it.",
          "It can write to another branch than the one it names first, or delete one, so a person is asked whatever rule allows a push.",
        ].join("\n"),
      }
    : undefined;
}

/** Whether the host that sent the payload reads `ask`. Codex does not, and names its turn in every payload. */
function readsAQuestion(payload: CommandPayload): boolean {
  return payload.turn_id === undefined;
}

/** The reply for one payload, as the text to print. Empty when there is nothing to say. */
export function replyTo(input: string): string {
  let answer: Answer | undefined;

  try {
    answer = judgeCall(JSON.parse(input) as CommandPayload);
  } catch {
    // A payload that is not JSON, or anything nobody foresaw: no answer.
    return "";
  }

  return answer === undefined
    ? ""
    : JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: answer.decision, permissionDecisionReason: answer.reason } });
}

if (isMainModule(import.meta.url)) {
  let reply = "";

  try {
    reply = replyTo(readFileSync(0, "utf8"));
  } catch {
    // Standard input could not be read. There is nothing to judge.
  }

  if (reply !== "") {
    console.log(reply);
  }
}
