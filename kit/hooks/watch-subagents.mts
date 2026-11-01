#!/usr/bin/env node
// SubagentStart and SubagentStop hook, for Codex.
//
// Codex does not wait for a subagent: the controller can end its turn with one
// at work in the same tree, and nothing tells the stop hook so. Seen live: the
// gate failed on the subagent's half-done edit and blocked the controller,
// which then deleted a file the subagent was working on. And no `Stop` follows
// a subagent's end, so nothing judged what it left.
//
// So this keeps a record of the subagents at work (`subagent-records.mts`),
// which `before-stop.mts` reads and waits for. When the last of a session's
// subagents stops, this runs the gate that stop would have run. If the gate is
// red, the subagent is sent back to fix it: `decision: "block"` continues it.
// `stop_hook_active` means it is already back for that reason. The gate runs
// again then, since another subagent may have edited the tree meanwhile, and
// it is let through whatever the gate says, so a gate it cannot fix ends in no
// loop. A gate that is still red is reported to the person.
//
// A subagent that was sent back stays on the record, since it is still at
// work. One that crashed never stops, so a record counts for thirty minutes.
// A stop that cannot be recorded (no project that can be read, an id that is
// no plain word) is still judged.
//
// Claude Code has no need of it and does not register it: `background_tasks`
// says what is in flight, and a subagent's end wakes the controller, whose
// stop is judged.
//
// It says nothing on a start, since Codex gives a start's output to the
// subagent as context. Which project: the one found from the payload's `cwd`,
// as the stop hook finds it.

import { isMainModule } from "../gates/lib/files.mts";
import { findProject, type GateRun, judgeStop, readPayload, runGate, type StopReply } from "./before-stop.mts";
import { forgetSubagent, isRecordable, recordSubagent, subagentsOnRecord } from "./subagent-records.mts";

/** The fields Codex sends that this hook reads. */
export interface SubagentPayload {
  hook_event_name?: unknown;
  session_id?: unknown;
  agent_id?: unknown;
  agent_type?: unknown;
  cwd?: unknown;
  stop_hook_active?: unknown;
  [field: string]: unknown;
}

/** The answer to a subagent's start or stop. Nothing to say is undefined. */
export async function replyToSubagent(
  payload: SubagentPayload,
  run: (root: string, script: string) => GateRun | Promise<GateRun> = runGate,
  now = Date.now(),
): Promise<StopReply | undefined> {
  const { hook_event_name: event, session_id: session, agent_id: id, agent_type: type, cwd } = payload;
  if (typeof cwd !== "string") {
    return undefined;
  }

  const stopping = event === "SubagentStop";
  const back = payload.stop_hook_active === true;
  const root = projectRoot(cwd);

  // Nothing can be recorded, but a stop is still judged: a project that cannot be read is sent back as "nothing is verified".
  if (root === undefined || typeof session !== "string" || !isRecordable(id)) {
    return stopping ? answerStop(await judgeStop({ cwd }, run), back) : undefined;
  }

  if (event === "SubagentStart") {
    recordSubagent(root, { id, session, type: typeof type === "string" ? type : "subagent", at: now });

    return undefined;
  }

  const others = subagentsOnRecord(root, session, now).filter((record) => record.id !== id);

  if (!stopping || others.length > 0) {
    forgetSubagent(root, id);

    return undefined;
  }

  const reason = await judgeStop({ cwd }, run);

  // One that goes back to fix it is still at work.
  if (reason === undefined || back) {
    forgetSubagent(root, id);
  }

  return answerStop(reason, back);
}

/** Sends a subagent back once. Back already, it is let through, and a gate that is still red is said: nothing else will. */
function answerStop(reason: string | undefined, back: boolean): StopReply | undefined {
  if (reason === undefined) {
    return undefined;
  }

  return back ? { systemMessage: `A subagent stopped with the gate still red.\n\n${reason}` } : { decision: "block", reason };
}

/** The project a folder is in. One that cannot be read has nothing to record: `judgeStop` says why, on a stop. */
function projectRoot(folder: string): string | undefined {
  try {
    return findProject(folder)?.root;
  } catch {
    return undefined;
  }
}

if (isMainModule(import.meta.url)) {
  const answer = await replyToSubagent(readPayload() as SubagentPayload);
  const reply = answer ? `${JSON.stringify(answer)}\n` : "";

  // Exits by itself once the reply is written: a gate that was left behind must not keep the hook alive.
  process.stdout.write(reply, () => {
    process.exit(0);
  });
}
