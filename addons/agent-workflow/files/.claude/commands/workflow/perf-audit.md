---
description: Audit what is animating in the running client, as it is and under reduced motion, and judge each thing it finds
argument-hint: [routes to open, e.g. / /orders] [still]
allowed-tools: Bash(node tools/agent-workflow/requires.mts:*), Bash(pnpm perf:check:*), Bash(pnpm perf:motion-audit:*), Bash(pnpm worktree:*), Bash(pnpm gate:full:*), Read
---

Run the runtime motion audit and judge what it reports. Asked for:
`$ARGUMENTS`: the routes to open, and `still` to also fail on anything that
moves under reduced motion. If that is empty, or still reads as a placeholder
because this host does not fill it in, take them from the request, and with
none given audit `/`.

Run each step yourself. This file runs nothing by itself.

## 0. This needs the performance add-on

```bash
node tools/agent-workflow/requires.mts performance
```

If it does not exit 0, report the line it printed and stop. Do not audit
motion some other way.

## 1. What the source already settles

```bash
pnpm perf:check
```

It reads the source and needs no browser. Fix what it fails first: an audit
of a client with known findings says little that is new. Keep the lines it
prints as "Not judged": those are what the audit is for.

## 2. Run the audit

```bash
pnpm perf:motion-audit
pnpm perf:motion-audit --path / --path /orders
pnpm perf:motion-audit --seconds 10
pnpm perf:motion-audit --assert-still
```

The first line audits the one client at `/`. `--path` opens another route
and can be given more than once; `--seconds` is how long it watches, 4 when
it is not given; `--assert-still` is for `still`. It builds the client for
the in-browser simulator, opens it in Chromium, and counts twice: as the
client is, and with reduced motion asked for.

Exit 0: every animation seen can be run by the compositor, or none was seen,
which it prints as a `SKIP` line. Exit 1: findings. Exit 2: the audit could
not run, and it says why. Report exit 2 as "not run", never as a pass.

## 3. Read the report, not the exit code

- **"started N times"** on a flash or a transition: live data starts it over
  and over. That is motion that looks idle and is not.
- **A transition you did not write.** `transition: all`, or one that names
  no property, makes a transition for whatever changes.
- **Anything that moves in the second count.** Under reduced motion it was
  asked to be still.
- **Which data the client ran on.** The report gives the `[data]` lines the
  client logged. An audit on the simulator says nothing about a server.
- **Only the routes it was given are opened.** A view behind a click was not
  audited. Name the views that were not.

## 4. Judge each finding

Ask first how often its trigger fires on real data.

- **Live data triggers it** (a tick, a price, a row that arrives): it is
  steady work on every frame. Fix it by the section of `docs/performance.md`
  for its case: a size or a position, a colour or a glow, an entry animation
  beside a loop. Do not invent another way.
- **A person triggers it, rarely and briefly** (a hover, a dialog that
  opens): accept it in `tools/perf/allowed.mts`, with the reason. "On an
  event" is not a reason when the event is a tick.

Never add an entry to that file to get past a finding on steady motion, and
never weaken the check. If a finding looks wrong, say so and leave it.

## 5. Report, then stop

One line for each route and each of the two counts: how many animations, how
many findings. Then each finding with its verdict from step 4, and what you
would change. Wait for a yes before you change anything.

A fix is a change like any other: `pnpm worktree <name> --ready`, the fix,
the audit again to see the finding gone, `pnpm gate:full`, one pull request.

## Reading it honestly

- **"None was seen" is not "nothing animates".** It is what one window of a
  few seconds saw on the routes it was given. A flash that fires twice a
  minute may not be in it.
- **One run is one sample.** Before you call a finding fixed, run it again
  with a longer window.
