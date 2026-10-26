#!/usr/bin/env node
// Stop hook: the agent may not finish while the project's gate is red.
//
// It runs the project's own script, the same commands a person or CI runs, so
// there is one definition of "green": `gate:full` (what CI runs) when the
// project has one, `gate:fast` otherwise. A red gate sends the output back as
// the next instruction.
//
// The script is run through `gates/quiet.mts`, which runs the same commands
// in the same order and prints only the stage that failed. What goes back to
// the agent is the end of that output, so it is the failure, and not the
// passing tests that happened to be printed last.
//
// Which project: the one the session is working in when it stops. That is
// the payload's `cwd`, which follows the agent into a worktree, and not
// `CLAUDE_PROJECT_DIR`, which stays at the checkout the session started in.
// An agent that worked in `<project>-worktrees/<name>` is judged on that
// worktree, not on the primary checkout beside it, which it never touched
// and which is green. From `cwd` the root is the top of its git checkout,
// and from there the nearest folder upward whose package.json has a gate
// script: a stop from inside a package folder runs the project's gate, not
// none. `CLAUDE_PROJECT_DIR` is read only when the payload names no folder.
// A session that edited two checkouts is judged on the one it stops in.
//
// The gate is run by the copy of the quiet runner beside this file, on the
// tree found above.
//
// The hook always answers by itself. The host gives it ten minutes and then
// kills it, and a hook that was killed blocks nothing. So the gate is told to
// stop at nine minutes, killed if it does not, and left behind if even that
// does not end it; each of those is reported as "nothing is verified".
//
// The full gate takes minutes, so it is not run on a tree it has already
// passed. After a green run the hook remembers a hash of every file git does
// not ignore; while that hash is unchanged the agent finishes at once. An
// agent that only answered a question never waits, and one that edited
// anything is held to the whole gate.
//
// This is a guard against stopping early, not a lock. The record is a file,
// and an agent that sets out to cheat can write it, as it can rewrite the
// `gate:full` script or this hook. What catches that is CI, which runs the
// same script from nothing. The record is also only as complete as its hash:
// an input the hash leaves out (an environment variable, a tool installed
// outside the project) can change the verdict without changing the record.
//
// The payload says two more things the hook reads. `stop_hook_active` means
// the agent is already continuing because of this hook; it is let through
// then, so a gate the agent cannot fix ends in a report to the user and never
// in a loop.
//
// `background_tasks` (Claude Code only) lists the session's tasks still in
// flight. A controller that sends a subagent off in the background, into the
// same tree, and ends its turn while it waits, stops with that tree half
// edited: the gate failed on it and blocked the controller mid-task (issue
// #72). So while an entry is an agent (`subagent`, `teammate`, `workflow`)
// whose status is `pending` or `running`, the gate is not run, nothing is
// recorded, and the user is told which agents are still at work. The agent's
// report starts a new turn, and that turn's stop is judged. A `shell` or a
// `monitor` (a dev server, a watch) does not count, or one left running would
// switch the gate off for good. An entry in any other shape (no status, a
// status or a type not listed, no object) does not count either: what cannot
// be read never skips the gate.
//
// A subagent can end its own turn to wait on a shell it started (a test run,
// a wait on the checks). While it waits the host lists the shell, not the
// subagent, and the shell's entry does not say whose it is. Two live sessions
// showed it: the controller stopped with only a running shell in the list, and
// the gate failed on the subagent's half-done edit. While it waits, the host
// counts the subagent as done (its `.meta.json` says `"finished": true`, the
// controller is told it completed); the shell's end is what wakes it again.
// So a running shell or monitor counts as that subagent at work when the
// transcript of one of the session's subagents
// (`<session>/subagents/agent-<id>.jsonl`, beside `transcript_path`) records
// it as a task that subagent started: a tool's result with that
// `backgroundTaskId`, at a time in the last thirty minutes. Past that, a
// server a subagent left running stops holding the gate back. The layout is
// the host's and not documented, so the hook believes it only in that shape:
// a transcript that is not there, cannot be read, or records the task in any
// other way or with no time names no subagent, and the gate runs as before.
//
// Apart from that second stop, the agent finishes without a gate having
// passed in three cases only: no folder from `cwd` upward has a gate script,
// the tree is the one a green run is on record for, or an agent is still at
// work. Anything that goes wrong on the way (a package.json that is not JSON,
// a file that cannot be read) is sent back as "nothing is verified", never
// passed over.
//
// The third case has a gap: a session that ends for good while an agent is
// still at work (the user closes it, the agent is never waited for) ends with
// no gate run on its last tree. CI, which runs the same script, catches what
// that leaves.
//
// Works under Claude Code and Codex: both send `stop_hook_active` and both read
// `{"decision":"block","reason":…}`. Codex sends no `background_tasks`, nor
// anything else that says a subagent is still at work, so under Codex every
// stop is judged as before. Its orchestrator waits for the results it asked
// for before it answers, which makes the race less likely there, not
// impossible.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isMainModule, isPlainPath } from "../gates/lib/files.mts";

/** Tried in order: the gate CI runs, then the fast one for a project that has no other. */
const SCRIPTS = ["gate:full", "gate:fast"];
/** Inside a folder git always ignores, so writing it never changes the tree it describes. */
const LAST_GREEN = "node_modules/.cache/arch/last-green-tree";
const TAIL_CHARACTERS = 4000;

export interface RunLimits {
  /** How long the gate may run before it is told to stop. */
  runMs: number;
  /** How long the runner then has to stop its stage, report and exit, before it is killed. */
  stopMs: number;
  /** How long to wait for a killed runner to be gone, before answering without it. */
  killMs: number;
}

/**
 * Together shorter than the hook's own timeout in the host's settings (ten
 * minutes), so this script is the one that reports a gate that did not
 * finish. A hook the host has to kill blocks nothing: the agent would stop
 * with nothing verified and nobody told.
 */
export const RUN_LIMITS: RunLimits = { runMs: 9 * 60 * 1000, stopMs: 20 * 1000, killMs: 5 * 1000 };

/** The kinds of background task that are agents, and so may be editing the tree. A `shell` or a `monitor` is not one. */
const AGENT_TASKS = ["subagent", "teammate", "workflow"];
/** The kinds of background task a subagent can end its turn to wait on, and be listed by instead of itself. */
const WAITED_ON_TASKS = ["shell", "monitor"];
/** A subagent's transcript, beside the session's: `<session>/subagents/agent-<id>.jsonl`. */
const SUBAGENT_TRANSCRIPT = /^agent-([\w-]+)\.jsonl$/;
/**
 * How long a shell a subagent started holds the gate back. Long enough for a
 * test run or a wait on the checks; a server the subagent left running stops
 * holding it back after this.
 */
const SUBAGENT_WAIT_MS = 30 * 60 * 1000;
/**
 * The statuses of a task that has not ended. The Agent SDK's
 * `SDKTaskUpdatedMessage` lists the five a task goes through; the other three
 * are "completed", "failed" and "killed".
 */
const IN_FLIGHT = ["pending", "running"];
const DESCRIPTION_CHARACTERS = 120;

/** The fields the hosts send that this hook reads. Only Claude Code sends `background_tasks`. */
export interface StopPayload {
  cwd?: string;
  stop_hook_active?: boolean;
  /** Read as unknown: an entry is believed only in the shape the hooks reference documents. */
  background_tasks?: unknown;
  /** The session's transcript; its subagents' are kept beside it. */
  transcript_path?: unknown;
}

/** What the hook writes back: a block with its reason, or a message to the user and nothing else. */
export interface StopReply {
  decision?: "block";
  reason?: string;
  systemMessage?: string;
}

/** An entry of `background_tasks` that is an agent still at work. */
interface AgentAtWork {
  id?: string;
  type: string;
  description: string;
  agentType?: string;
}

export interface GateRun {
  status: number;
  output: string;
  /** The gate was stopped before it finished, so it verified nothing. */
  timedOut?: boolean;
}

/**
 * The hook's answer to a stop. While an agent of the session is still at work
 * the gate is not run: the agent may be halfway through an edit of this very
 * tree, and its report starts the turn whose stop is judged.
 */
export async function replyToStop(payload: StopPayload, run: (root: string, script: string) => GateRun | Promise<GateRun> = runGate): Promise<StopReply | undefined> {
  const agents = agentsAtWork(payload.background_tasks, payload.transcript_path);

  if (agents.length > 0) {
    return { systemMessage: deferral(agents) };
  }

  const reason = await judgeStop(payload, run);

  return reason ? { decision: "block", reason } : undefined;
}

/**
 * The agents in a payload's `background_tasks` that have not ended, and the
 * subagents that ended their turn to wait on a shell or a monitor still
 * running. An entry in any other shape is not one: it never skips the gate.
 */
function agentsAtWork(tasks: unknown, transcriptPath: unknown): AgentAtWork[] {
  if (!Array.isArray(tasks)) {
    return [];
  }

  const inFlight = tasks.flatMap((task: unknown): AgentAtWork[] => {
    if (typeof task !== "object" || task === null) {
      return [];
    }

    const { id, type, status, description, agent_type: agentType } = task as Record<string, unknown>;

    if (typeof type !== "string" || typeof status !== "string" || !IN_FLIGHT.includes(status)) {
      return [];
    }

    return [
      {
        id: typeof id === "string" && id !== "" ? id : undefined,
        type,
        description: typeof description === "string" ? description : "",
        agentType: typeof agentType === "string" && agentType !== "" ? agentType : undefined,
      },
    ];
  });
  const agents = inFlight.filter((task) => AGENT_TASKS.includes(task.type));
  const waitedOn = inFlight.filter((task) => WAITED_ON_TASKS.includes(task.type) && task.id !== undefined);
  const listed = new Set(agents.map((agent) => agent.id));

  return [...agents, ...subagentsWaitingOn(waitedOn, transcriptPath).filter((agent) => !listed.has(agent.id))];
}

/**
 * The subagents of the session that started one of these tasks in the last
 * thirty minutes. While a subagent waits on a shell of its own, the host lists
 * the shell and not the subagent, and the shell's entry does not say whose it
 * is: the subagent's transcript, which records the id and the time of each
 * task it started in the background, does. A transcript that cannot be read
 * names no subagent, and the gate runs.
 */
function subagentsWaitingOn(tasks: AgentAtWork[], transcriptPath: unknown, now = Date.now()): AgentAtWork[] {
  if (tasks.length === 0 || typeof transcriptPath !== "string" || !transcriptPath.endsWith(".jsonl")) {
    return [];
  }

  const folder = join(transcriptPath.slice(0, -".jsonl".length), "subagents");
  let names: string[];

  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }

  return names.flatMap((name): AgentAtWork[] => {
    const id = SUBAGENT_TRANSCRIPT.exec(name)?.[1];
    const started = id === undefined ? new Map<string, number>() : tasksStartedIn(readOrUndefined(join(folder, name)));
    const task = tasks.find((waited) => {
      const at = waited.id === undefined ? undefined : started.get(waited.id);

      return at !== undefined && at <= now && now - at <= SUBAGENT_WAIT_MS;
    });

    if (id === undefined || task === undefined) {
      return [];
    }

    // Read for the subagent's name only: while it waits it says `"finished": true`, as after any turn of its own.
    const meta = readMeta(join(folder, `agent-${id}.meta.json`));

    return [
      {
        id,
        type: "subagent",
        description: typeof meta.description === "string" && meta.description !== "" ? meta.description : task.description,
        agentType: typeof meta.agentType === "string" && meta.agentType !== "" ? meta.agentType : undefined,
      },
    ];
  });
}

function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The tasks a transcript records as started in the background, each with the
 * time of the record: a tool's result whose `backgroundTaskId` is the id. The
 * id written anywhere else (in a tool's output, in a record of another kind)
 * is not one, a record with no time it can read is passed over, and so is a
 * line that is not JSON.
 */
function tasksStartedIn(transcript: string | undefined): Map<string, number> {
  const started = new Map<string, number>();

  for (const line of transcript?.split("\n") ?? []) {
    let record: unknown;

    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const { toolUseResult: result, timestamp } = typeof record === "object" && record !== null ? (record as Record<string, unknown>) : {};
    const id: unknown = typeof result === "object" && result !== null ? (result as Record<string, unknown>).backgroundTaskId : undefined;
    const at = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;

    if (typeof id === "string" && id !== "" && !Number.isNaN(at)) {
      started.set(id, at);
    }
  }

  return started;
}

/** What a subagent's `.meta.json` says of it, or nothing when it cannot be read. */
function readMeta(path: string): Record<string, unknown> {
  try {
    const meta: unknown = JSON.parse(readFileSync(path, "utf8"));

    return typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function deferral(agents: AgentAtWork[]): string {
  const named = agents.map((agent) => {
    const description = agent.description.length > DESCRIPTION_CHARACTERS ? `${agent.description.slice(0, DESCRIPTION_CHARACTERS)}…` : agent.description;

    return `${agent.agentType ?? agent.type}${description === "" ? "" : ` "${description}"`}`;
  });

  return [
    `The gate was not run: ${agents.length === 1 ? "an agent of this session is" : `${agents.length} agents of this session are`} still at work, and may be editing this tree (${named.join("; ")}).`,
    `It runs at the next stop, once ${agents.length === 1 ? "it has" : "they have"} finished.`,
  ].join(" ");
}

export async function judgeStop(
  payload: StopPayload,
  run: (root: string, script: string) => GateRun | Promise<GateRun> = runGate,
): Promise<string | undefined> {
  // Only the literal: a payload that says "false" in quotes is not a second stop.
  if (payload.stop_hook_active === true) {
    return undefined;
  }

  try {
    return await judgeTree(payload, run);
  } catch (error) {
    // Whatever failed, no gate passed. Saying nothing here would let the agent finish on that.
    return [
      "The stop hook could not judge this project, so nothing is verified. That is not a pass.",
      "Run the gate yourself and report what it says; if the reason below is something you changed, put it right first.",
      "",
      error instanceof Error ? error.message : String(error),
    ].join("\n");
  }
}

async function judgeTree(payload: StopPayload, run: (root: string, script: string) => GateRun | Promise<GateRun>): Promise<string | undefined> {
  const project = findProject(typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd());

  if (project === undefined) {
    return undefined;
  }

  const { root, script } = project;
  const tree = hashWorkingTree(root);

  if (tree !== undefined && tree === readLastGreen(root)) {
    return undefined;
  }

  const { status, output, timedOut } = await run(root, script);

  // Asked first, and whatever the status: a run that was stopped proves nothing, even one that then exited 0.
  if (timedOut) {
    return [
      `\`${script}\` did not finish in time and was stopped, so nothing is verified. That is not a pass.`,
      "Run it yourself, and report what it says; if it cannot finish, say so plainly.",
      "",
      output.slice(-TAIL_CHARACTERS),
    ].join("\n");
  }

  if (status === 0) {
    // The tree as it was before the run. If the gate itself rewrote a file,
    // the tree is no longer this one, and the next stop judges the new one.
    if (tree !== undefined) {
      writeLastGreen(root, tree);
    }

    return undefined;
  }

  return [
    `\`${script}\` is red, so the work is not finished. Fix what it reports and run it again.`,
    "If a finding is wrong or outside what you were asked to do, say so plainly instead of working around the gate.",
    "",
    output.slice(-TAIL_CHARACTERS),
  ].join("\n");
}

/**
 * The project a folder belongs to, and the gate to hold it to: from the top
 * of the folder's git checkout (the folder itself where there is no git),
 * the nearest folder upward whose package.json has a gate script. Undefined
 * when there is none. Throws when a package.json on the way cannot be read:
 * a gate may be in it.
 */
export function findProject(folder: string): { root: string; script: string } | undefined {
  const asked = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: folder, encoding: "utf8" });
  const top = asked.status === 0 ? asked.stdout.replace(/\n$/, "") : "";
  let current = top === "" ? folder : top;

  for (;;) {
    const manifest = join(current, "package.json");

    if (existsSync(manifest)) {
      let scripts: unknown;

      try {
        ({ scripts } = JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: unknown });
      } catch (error) {
        throw new Error(`${manifest} could not be read as JSON, so the gate script could not be looked up (${error instanceof Error ? error.message : String(error)})`);
      }

      const script = SCRIPTS.find((candidate) => typeof scripts === "object" && scripts !== null && Boolean((scripts as Record<string, unknown>)[candidate]));

      if (script !== undefined) {
        return { root: current, script };
      }
    }

    if (dirname(current) === current) {
      return undefined;
    }

    current = dirname(current);
  }
}

/** The quiet runner, in the copy of the kit this hook is in. */
const QUIET_RUNNER = join(import.meta.dirname, "..", "gates", "quiet.mts");
/** Only the end of the output is sent back, so only the end is kept. */
const KEPT_CHARACTERS = 64 * 1024;

/**
 * Runs the gate, and answers within `runMs + stopMs + killMs` whatever the
 * runner does. Past `runMs` the runner is told to stop (SIGTERM): it stops its
 * stage, prints what the stage had said, and exits. If it has not exited
 * `stopMs` later it is killed. If even then it does not go, or something it
 * left behind holds its output open, the answer is given without it.
 *
 * Not `spawnSync` with a timeout: that waits for the child for ever when the
 * child outlives the signal, and it stops reading at the timeout, so what the
 * runner prints once it is told to stop was never seen.
 */
export function runGate(root: string, script: string, limits: RunLimits = RUN_LIMITS, runner: string = QUIET_RUNNER): Promise<GateRun> {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [runner, script, "--root", root], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const timers: NodeJS.Timeout[] = [];
    let output = "";
    let timedOut = false;
    let answered = false;

    function keep(chunk: Buffer): void {
      output = (output + chunk.toString("utf8")).slice(-KEPT_CHARACTERS);
    }

    function answer(status: number | null, note = ""): void {
      if (answered) {
        return;
      }

      answered = true;
      timers.forEach(clearTimeout);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      // Never 0 for a run that was stopped or that ended any way but by exiting.
      settle({ status: timedOut || status === null ? status || 1 : status, output: `${output}${note}`, timedOut });
    }

    timers.push(
      setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        timers.push(
          setTimeout(() => {
            child.kill("SIGKILL");
            timers.push(
              setTimeout(() => {
                answer(null, "\n(the gate did not end when it was killed, and was left behind)");
              }, limits.killMs),
            );
          }, limits.stopMs),
        );
      }, limits.runMs),
    );

    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (error) => {
      answer(null, `\n${error.message}`);
    });
    child.on("close", (code) => {
      answer(code);
    });
  });
}

/** A file of settings that git usually ignores and that a build or a test may read. */
const ENVIRONMENT_FILE = /(^|\/)\.env(\.[^/]*)?$/;

/**
 * One hash over everything a gate's verdict is taken to depend on: the path
 * and content of every file git does not ignore, tracked or not; the
 * environment files it does ignore; and the version of Node. And where the
 * tree is: a record made for one checkout must never speak for another, even
 * one with the same files in it, since what git ignores (what is installed,
 * what is built) is each checkout's own.
 *
 * Undefined when that cannot be established: git cannot list the files, a
 * file cannot be read, or the tree holds a repository of its own (a
 * submodule, a nested clone), whose files git lists as one entry. Then
 * nothing is remembered and the gate runs every time.
 */
function hashWorkingTree(root: string): string | undefined {
  try {
    return hashFiles(root);
  } catch {
    // A file that went away or cannot be read between the listing and the reading.
    return undefined;
  }
}

function hashFiles(root: string): string | undefined {
  const judged = listFiles(root, ["--cached", "--others", "--exclude-standard"]);
  // `--directory` names an ignored folder once and does not walk it, so this never reads node_modules.
  const ignored = listFiles(root, ["--others", "--ignored", "--exclude-standard", "--directory"]);

  if (judged === undefined || ignored === undefined) {
    return undefined;
  }

  const hash = createHash("sha256").update(`${process.version} ${process.platform} ${process.arch}\0${realpathSync(root)}\0`);

  for (const path of [...judged, ...ignored.filter((entry) => ENVIRONMENT_FILE.test(entry))].sort()) {
    const file = lstatSync(join(root, path), { throwIfNoEntry: false });

    hash.update(`${path}\0`);

    if (file?.isDirectory()) {
      return undefined;
    }

    if (file?.isSymbolicLink()) {
      hash.update(readlinkSync(join(root, path)));
    } else if (file?.isFile()) {
      hash.update(readFileSync(join(root, path)));
    } else {
      // Deleted, but still in git's index.
      hash.update("\0absent");
    }

    hash.update("\0");
  }

  return hash.digest("hex");
}

function listFiles(root: string, which: string[]): string[] | undefined {
  const listed = spawnSync("git", ["ls-files", ...which, "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  return listed.status === 0 ? listed.stdout.split("\0").filter(Boolean) : undefined;
}

function readLastGreen(root: string): string | undefined {
  const file = join(root, LAST_GREEN);

  // Never through a symbolic link, as it is never written through one: a
  // `node_modules` that links to another checkout's would hand over that
  // checkout's record.
  try {
    return isPlainPath(root, LAST_GREEN) && existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
  } catch {
    // A record that cannot be read is no record.
    return undefined;
  }
}

function writeLastGreen(root: string, tree: string): void {
  const file = join(root, LAST_GREEN);

  // Never through a symbolic link: the place is a fixed one in a tree this did not make.
  if (!isPlainPath(root, LAST_GREEN)) {
    return;
  }

  // Where it cannot be stored, the next stop simply runs the gate again.
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${tree}\n`);
  } catch {
    // Nothing to do: the verdict of this run stands, and it was green.
  }
}

/** What the host sent. A payload that cannot be read is an empty one: the gate is then run, never skipped. */
function readPayload(): StopPayload {
  try {
    const payload: unknown = JSON.parse(readFileSync(0, "utf8") || "{}");

    return typeof payload === "object" && payload !== null ? (payload as StopPayload) : {};
  } catch {
    return {};
  }
}

if (isMainModule(import.meta.url)) {
  const answer = await replyToStop(readPayload());
  const reply = answer ? `${JSON.stringify(answer)}\n` : "";

  // Exits by itself once the reply is written: a gate that was left behind must not keep the hook alive.
  process.stdout.write(reply, () => {
    process.exit(0);
  });
}
