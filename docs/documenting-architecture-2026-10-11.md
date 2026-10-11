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

## Not done

- **The skill has not been run.** Everything above happened before it was
  written, or is a script run by hand. Whether an agent with the skill
  performs step 6 unprompted, and what its set then holds, is not known.
- **Not run in Codex**, and not on Linux or Windows. The list of browser
  paths for those systems is written from what is usually there, not from a
  run.
- **CI does not fetch the tools or start a browser.** The tests replace both
  with fakes. The real path was run by hand, on one machine.
- **How GitHub draws these diagrams was not compared** with what the check
  draws. Neither set was pushed.
