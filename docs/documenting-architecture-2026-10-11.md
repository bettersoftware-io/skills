# Documenting architecture: two sets written without the skill, 2026-10-11

`skills/documenting-architecture` was written after two sets of architecture
documents had been produced without it, on the same day, by agents given the
same request. This is what happened in each, what a fact-check found, and
what the scripts were then run on.

It is not a comparison with and without the skill. No run with the skill
exists yet; [STATUS](STATUS.md) says so.

## The request

Both runs got one sentence: analyse the project and write its architecture
documentation with the C4 model and many other diagrams, as simply as
possible, taking the format of
[ReactiveTraderCloudClone](https://github.com/bettersoftware-io/ReactiveTraderCloudClone)'s
`docs/architecture/` as inspiration. Both were Claude Code sessions on Claude
Opus 5.5 at high effort.

| | First set | Second set |
|---|---|---|
| Codebase | A vanilla JavaScript application, about 250,000 lines | A Bun and React application in TypeScript, about 64,000 lines |
| Written | An index and 18 chapters, about 7,600 lines, 113 mermaid diagrams | An index and 16 chapters, about 6,200 lines, 94 mermaid diagrams, 2 animated SVG pictures |
| Research | 5 readers in parallel, 300,000 to 421,000 tokens each | 4 readers in parallel, 314,000 to 431,000 tokens each |
| Fact-check | Part of the run | Left out, then run more than two hours later |

The first set's figures are from its author's notes and were not measured
again. The second set's are from the session that wrote this.

## What passed before anyone checked a sentence

In the second run the set was reported as finished when:

- every diagram rendered;
- every link, every heading anchor and every cited file path resolved;
- the repository's own formatter passed;
- about 40 constants (ports, timeouts, limits, counts) had been compared with
  the source by the writer. All 40 were right.

## What the fact-check found

Two fresh readers each took half the chapters, with the documents, the code,
and the brief that is now in
[`briefs.md`](../skills/documenting-architecture/briefs.md).

| | First set | Second set |
|---|---|---|
| Claims checked | about 870 | about 860 |
| Findings | 31 | 52 |
| Plainly wrong | 13 | 22 |
| Misleading | — | 26 |
| True today, phrased to rot | — | 4 |
| Tokens | 383,000 and 456,000 | 402,000 and 426,000 |

The first set's notes give "13 plainly wrong, the rest misleading or
fragile", without the split.

In the second set, 18 of the findings were compared with the source by the
writer before any was applied. All 18 held.

Where the errors were, in the second set:

| Kind | Example |
|---|---|
| The module that triggers, named as the one that performs | The build module was drawn writing the manifest and publishing the events. Its callers do both. A route handler was drawn in the worker-pool file |
| "Only", "never", "exactly one" | "The only trace of the backend", "never branches on the type", "the only two ways the server pushes to a browser", "exactly one exception in each direction". A search found a counter-example to each |
| Step order in a sequence diagram | Reconnect was drawn as snapshot, refetch, flush the queue. The code flushes first |
| The direction of a message | Three frames were listed as browser to server. One goes the other way |
| A name built by analogy | `widgets-tailwind.css`, after the folder. The code builds the name from the kind, so `widget-tailwind.css` |
| The opposite verb | "Append to the registry". The code prepends, and the order is the order on screen |
| A rule stated wider than its test | "Nothing under `server/` imports React". The test exempts a file |
| A property of some stores, claimed for all | "Each file is written atomically". True of one folder's files and not of another's |

Where they were not: the chapter of state machines and their constants was
clean after 61 checked claims, and the chapter on processes, ports and
timeouts had one finding in about 45. Both are made of numbers and names
copied out of the readers' reports.

So the spot-check that came before "finished" had tested the part that is
reliably right. That is why step 6 of the skill says that spot-checking
constants is not the fact-check, and that the set is not reported as finished
before it.

The first set's notes list the same kinds: who imports or owns what,
over-generalisation, call direction in a diagram, counts that are off by one.

## What the scripts were run on

The second set, 17 markdown files, on macOS (arm64), Node 26.11.1.

| Script | Result |
|---|---|
| `check-diagrams.mts` | `PASS diagrams — 94 diagram(s) in 17 markdown file(s) render`, in 6 seconds including the first fetch of the tools, in one headless-only Chromium. One chapter (9 diagrams) was also drawn in the whole Google Chrome, started without a window: 1.7 seconds |
| `check-diagrams.mts`, on a diagram broken on purpose | `FAIL`, exit 1, with `Parse error on line 3. Expecting … (line 6 of the file)`: the diagram's third line is the file's sixth |
| `check-diagrams.mts`, with no browser | Exit 2: `no browser was found to render with` |
| `check-cited-paths.mts` | 516 cited paths. Two are missing, and the set says they are (stale references it found in the code's comments). `FAIL` without `--except`, `PASS` with both named |
| `check-doc-links.mts` (from `repo-hygiene`) | `PASS doc-links — 307 relative link(s) in 21 markdown file(s) resolve` |
| `build-site.mts` | 17 pages, 94 diagrams, 2 other files. Opened in Chromium by a script: every diagram on every page drew, a link to a heading in another chapter landed on it after the diagrams above it had drawn, and a clicked diagram opened at full size |

| `build-site.mts`, on a document written to attack its reader (by hand; it found nothing, and three faults were there: see below) | A `<script>`, a picture with `onerror`, a tag with `onmouseover`, an `<iframe srcdoc>`, a `javascript:` link, a `javascript:` autolink, a `data:` picture, and a mermaid label and `click` that carry script. Built with the real converter and opened in Chromium, with every link clicked and every element hovered: nothing ran, the page held no script, frame or handler, the three unsafe links were listed by the build, and `<details>` still worked |
| `build-site.mts --out`, on a folder that held other files | Exit 2, and the files were still there |

An earlier version of `check-diagrams.mts` ran Mermaid's own command line,
once per diagram. That starts a browser each time: the same 94 diagrams were
94 browsers, four at a time, and took 67 seconds. The person at the machine
saw them. It was replaced the same hour by one browser for the run, and its
toolset went from 442 MB to 231 MB.

A review of the first commit found two faults, both fixed the same day
before anything was merged: hand-written HTML and `javascript:` links went
into the copy as they were, and a document that was a symbolic link was read.
Looking for the second turned up a third: `--out` emptied any folder it was
given.

A review of that fix found two more, and reproducing them a third. All three
got script into the page past the fix:

| Written in a document | What the page held |
|---|---|
| `[x](javascript%3Aalert(1))` | `href="javascript:alert(1)"`. The link was judged, then `%3A` was decoded to find the file it named, and the decoded text was written |
| `<kbd><img/src="x"/onerror=alert(1)></kbd>` | The tag as it stood. After `<kbd>`, `<code>` or `<pre>` the converter (marked 15.0.12) stops escaping text, and it does not take `<img/src…` for a tag, so the tag was never handed to `safeHtml` |
| `![" onerror="alert(1)](x.png)` | `<img src="x.png" alt="" onerror="alert(1)">`. The converter writes alt text unescaped |

Each was a thing made safe on its way in and changed on its way out. So the
judging moved to the way out: `finishBody` keeps a `<…>` as a tag only when it
is on a list, whatever converter made the HTML, and a link is judged again
after it is rewritten. A path is written with every part encoded, and the
picture is written by the builder and not by the converter.

The tests had not seen any of this because they give the builder a stand-in
converter, and a stand-in does what its author believes the real one does.
Two of the three faults are places where it does not. The hostile document,
which had been a file in a temporary folder, is now
[`hostile.test.mts`](../scripts/architecture-docs/hostile.test.mts): 24
attacks, built with the real converter, opened in one browser with no window.
The browser is asked whether anything ran, what tags the page holds, and what
scheme it reads on every link and picture.

That test was itself wrong at first. Seven attacks had a space in their
payload, which ends a link's address in markdown, so they were cut short and
could not have run. A test that passes because its attack is broken proves
nothing, so it was tried with each protection taken out:

| Taken out | What the hostile test then said |
|---|---|
| Nothing | 5 of 5 pass |
| The page's list of tags | A script ran, and the page held a handler |
| The list, and the builder's own writing of a picture | The same, and the checks on the refused links and on the harmless picture failed too |
| Encoding a path, and judging a link the second time | The browser read a link as `javascript:` |

The moi set built before and after the change is the same, byte for byte, in
all 17 pages.

The scripts have 118 tests, 5 of them the hostile document. 55 mutants were
each applied, seen to turn their test red, and removed:
[`scripts/mutants/architecture-docs.json`](../scripts/mutants/architecture-docs.json).

## A third set, and what it changed in the skill

Later the same day a third set was found to have been written without the
skill, from the same one-sentence request, by another Claude Code session on
Claude Opus 5.5. Its author then ran steps 5 to 7 of the skill on it. That is
the first time any step of the skill was followed, and it was followed by the
session that wrote the set, not by a fresh one.

| | Third set |
|---|---|
| Codebase | A TypeScript application with its API, background workers and a desktop shell, about 790,000 lines outside tests and generated code |
| Written | An index and 18 chapters, about 5,800 lines, 116 mermaid diagrams |
| Research | 5 readers in parallel, 265,000 to 361,000 tokens each |
| Fact-check | Left out, then run about two hours later |

What had passed when it was reported as finished: every diagram rendered in a
page the author built for the purpose, with Mermaid 11.4; a script of the
author's found every link, anchor and cited path; the repository's markdown
lint and its own documentation check passed; the facts behind the diagrams had
been compared with the source by the writer.

### What the scripts said

| Script | Result |
|---|---|
| `check-cited-paths.mts` | `FAIL`: 3 of 400 cited paths were not in the repository. The author's own script had passed all three. One was a real file named without its extension; two were made-up examples of a naming pattern |
| `check-doc-links.mts` | `PASS doc-links — 245 relative link(s) in 19 markdown file(s) resolve` |
| `check-diagrams.mts` | `PASS diagrams — 116 diagram(s) in 19 markdown file(s) render` |
| `build-site.mts` | 19 pages, 116 diagrams |

### What the fact-check found

Two fresh readers, half the set each, with the brief in `briefs.md` unchanged.

| | Third set |
|---|---|
| Claims checked | about 650 (330 and 320) |
| Findings | 47 |
| Plainly wrong | 15 |
| Misleading | 24 |
| True today, phrased to rot | 8 |
| Tokens | 388,000 and 356,000 |

34 of the findings were compared with the source by the writer before any was
applied. 33 held as reported. One held in part: a step was reported as drawn
too early, and the code does it twice, early and late.

The kinds were the kinds of the first two sets:

| Kind | Example |
|---|---|
| "Every", "nothing", "never" | "Every server-side LLM call goes through one module": the workers have chains of their own. "Nothing in the repo opens a raw Redis connection": one adapter does. "Health never reads the data": it reads two payloads |
| A rule stated wider than the code | "Run before every push": only when certain folders changed. "Refuses to start without the secret": a flag turns that off. "Not allowed in the source": the lint keeps a list of the places that still do it |
| A name built by analogy | A query parameter written `country`; the contract says `country_code`. A stored state written `RETRY`, which is a local variable; the stored value is `ERROR` |
| The right fact on the wrong thing | Seats for teammates, put on one plan; the catalogue gives them to another |
| A step number in the prose that is not the diagram's | "Step 8 throws", under a numbered sequence diagram whose step 10 is the read that fails |
| A figure taken from the repository's own document | A monitor "every 15 minutes", as its architecture file says. The workflow's schedule is every 5 |

Where they were not: the index, with its table of thirteen places where the
repository's architecture file and the code disagree, was clean after 26
checked claims. The chapter of task recipes was clean after 36.

### Three things the skill did not say

Each was a cost in this run. Two became sentences in the skill and one became
a line of output.

**The repository had a check on documents that nobody looked for.** A job
required to merge refused every hand-written count of the form "37 domains".
It was run at the end, out of curiosity, and failed twenty lines and three
headings of the finished set. Step 1 now says to find such checks and read
their rules before a chapter is written.

**The places where the repository's documents were wrong had no fixed home.**
This author listed them in the index. Nothing in the skill said to.

**Eight diagrams were wider than a page shows at full size,** and that was
found by measuring them by hand. `check-diagrams.mts` now names each diagram
drawn wider than 1,800 px, after its verdict and without failing.

Measuring showed something else. The author had narrowed four diagrams by
turning them from `TB` to `LR`, judging by Mermaid 11.4 in a page of their
own. Drawn by `check-diagrams.mts`, with Mermaid 12.1:

| Diagram | `TB`, 11.4 | `LR`, 11.4 | `TB`, 12.1 | `LR`, 12.1 |
|---|---|---|---|---|
| Eight boxes, six of them in one group | 2,039 px | 1,442 px | 689 px | 2,315 px |
| Four groups of platforms | 2,069 px | 1,780 px | 1,183 px | 1,851 px |
| Three groups of two, and one box | 1,636 px | 991 px | 1,302 px | 438 px |
| Three groups, twelve boxes | 1,748 px | 1,341 px | 1,055 px | 1,159 px |

The two versions disagree on which way is narrower in three of the four. The
two measurements also differ in browser and in fonts, so the version is not
proven to be the cause. `mermaid.md` now says to measure with the one checker
and to prefer a change that takes boxes out of a rank.

### Whether the new sentences change what an agent does

Fresh single-shot agents were given a copy of the skill, old or new, and a
written situation, and asked what they would do. They ran nothing. What they
said was scored on questions fixed before any answer was read. This is stated
intent, not a run.

Situation one: the set is written, the user says "looks great, wrap it up",
the repository has a documentation check that runs and a markdown lint that
cannot, and two errors were noticed in the repository's own architecture file.

| Says it would | Old skill | New skill |
|---|---|---|
| Run the repository's documentation check | 3 of 3 | 3 of 3 |
| Report the lint as not run, by name | 3 of 3 | 3 of 3 |
| List the two errors in the index | 0 of 3 | 3 of 3 |
| Start the two readers of step 6, having been told to wrap up | 3 of 3 | 3 of 3 |

Situation two: nothing is done yet, and the agent lists what it opens before
the first chapter.

| Says it would | Old skill | New skill |
|---|---|---|
| Look for the repository's checks on documents, and read their rules | 0 of 2 | 2 of 2 |

Two sentences were written and then taken out, because the first table shows
no difference for them: a longer version of "run the repository's checks" in
step 5, and a line in the report listing which of them ran. An agent that
knows a check exists runs it. The gap was in finding it.

The first table is also the only evidence so far on step 6: six agents out of
six said they would do it when told to wrap up. None of them was running.

### The scripts after the change

`scripts/architecture-docs` has 124 tests, 6 of them new. 7 mutants were added
to the 55, each applied, seen to turn its test red, and removed. The line that
reads a diagram's size from the browser's answer is behind the same fake as
the rest of the renderer, so no test reaches it. It was run by hand on the
third set, on one machine.

## Not done

- **The skill has not been run from its first step.** Steps 5 to 7 were run
  once, on the third set, by the session that had written it. Steps 1 to 4
  never were. Whether an agent with the skill performs step 6 unprompted, and
  what its set then holds, is not known: six agents said they would, and
  saying is not doing.
- **The third set does not have the chapters step 4 lists.** It has no
  decisions chapter and no table of words at the head of each chapter. It was
  corrected, not rewritten.
- **Not run in Codex**, and not on Linux or Windows. The list of browser
  paths for those systems is written from what is usually there, not from a
  run.
- **CI does not fetch the tools or start a browser.** The tests replace both
  with fakes. The real path was run by hand, on one machine.
- **How GitHub draws these diagrams was not compared** with what the check
  draws. No set was pushed. The widths `check-diagrams.mts` names are those
  of one version of Mermaid on one machine, and a second version disagreed.
