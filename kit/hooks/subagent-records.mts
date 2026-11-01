// Which subagents of a session are at work, as far as their hooks have said.
//
// One file for each subagent, so two that start or stop at once never write
// over each other. They live in a folder git always ignores, so they never
// change the tree the stop hook judges. A file that cannot be read says
// nothing: what cannot be read never skips the gate. Never through a symbolic
// link: the place is a fixed one in a tree this did not make.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isPlainPath } from "../gates/lib/files.mts";

const RECORDS = "node_modules/.cache/arch/subagents-at-work";
/** An id that is safe as a file name. Anything else is not recorded: it comes from outside this script. */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;
/**
 * How long a record counts. A subagent that crashed never says it stopped,
 * and must not hold the gate back for good.
 */
const RECORD_MS = 30 * 60 * 1000;

export interface SubagentRecord {
  id: string;
  session: string;
  type: string;
  at: number;
}

/** Whether an agent id can be recorded. */
export function isRecordable(id: unknown): id is string {
  return typeof id === "string" && PLAIN_ID.test(id);
}

export function recordSubagent(root: string, record: SubagentRecord): void {
  if (!isPlainPath(root, `${RECORDS}/${record.id}`)) {
    return;
  }

  // Where it cannot be stored there is no record, and the stop is judged.
  try {
    mkdirSync(join(root, RECORDS), { recursive: true });
    writeFileSync(join(root, RECORDS, record.id), JSON.stringify(record));
  } catch {
    // Nothing to do: see above.
  }
}

export function forgetSubagent(root: string, id: string): void {
  if (!isPlainPath(root, `${RECORDS}/${id}`)) {
    return;
  }

  // One that cannot be removed runs out with its thirty minutes.
  try {
    rmSync(join(root, RECORDS, id), { force: true });
  } catch {
    // Nothing to do: see above.
  }
}

/** The session's subagents at work, in the last thirty minutes. */
export function subagentsOnRecord(root: string, session: string, now = Date.now()): SubagentRecord[] {
  let names: string[];

  try {
    names = readdirSync(join(root, RECORDS));
  } catch {
    return [];
  }

  return names.flatMap((name): SubagentRecord[] => {
    const record = isPlainPath(root, `${RECORDS}/${name}`) ? readRecord(join(root, RECORDS, name)) : undefined;

    return record !== undefined && record.session === session && record.at <= now && now - record.at <= RECORD_MS ? [record] : [];
  });
}

function readRecord(path: string): SubagentRecord | undefined {
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as Partial<SubagentRecord> | null;

    return typeof record?.id === "string" && typeof record.session === "string" && typeof record.type === "string" && typeof record.at === "number" ? (record as SubagentRecord) : undefined;
  } catch {
    return undefined;
  }
}
