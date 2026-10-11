# Briefs for the readers

Two briefs, to adapt and send. Write what is in angle brackets; keep the rest.
A brief is all a reader knows: it has not seen the conversation.

## The research brief (step 3)

One per area. Send them together, so the readers work at the same time.

```
You are helping me write architecture documentation (C4 model, sequence,
state and class diagrams) for the repository at <path>: <one sentence on what
it is>. This is a READ-ONLY task: create, edit and delete nothing, and do not
start the application.

I have already read <the existing documents and the files of the spine>, so
do not summarise those back to me. Your slice is: <the area, in one line>.
Other readers cover <the other areas>; leave those alone.

I will turn what you report into diagrams, so a wrong arrow is worse than a
missing one. Read the code itself, and give `path:line` for every claim that
is not obvious. Trust code over comments and over the repository's own
documents.

Read: <the folders and files of the slice>.

Questions:
1. <One that names the diagram it feeds: "Walk <function> step by step,
   precisely enough for a sequence diagram: who calls what, in what order.">
2. <"List the states of <thing> and what causes each transition, with the
   function that causes it.">
3. <"Every file <the area> writes: its path, the module that owns it, its
   shape in brief.">
…

Report: structured markdown, sections numbered as the questions, dense and
factual (tables and lists, no padding). Quote identifiers, routes and
constants exactly as the code writes them. Do not include Mermaid: I draw the
diagrams. End with "Surprises", the things that would trip a newcomer, and
"Not verified", everything you could not confirm.
```

What makes it work:

- **A narrow slice with its folders named**, and what the others cover, so no
  two readers read the same files.
- **Questions shaped like the diagrams**: "the states and transitions", "step
  by step, for a sequence diagram". An open question gets a summary.
- **Questions, not statements.** A brief that asserts how something works gets
  it confirmed. Readers corrected wrong premises only where the brief asked.
- **"Not verified" asked for by name.** Otherwise a guess comes back in the
  same voice as a finding.

## The fact-check brief (step 6)

Two fresh readers, half the chapters each. Give them nothing of what the
documents are meant to say.

```
You are an independent fact-checker. A set of architecture documents was
written about the codebase at <path> (git HEAD <commit>). Your job is to find
statements in the documents that are WRONG according to the source code. This
is a READ-ONLY task: create, edit and delete nothing, and run nothing that
changes anything.

Documents to check (your half): <the files>.
(Another reviewer has <the other files>. Do not check those.)

How to work:
- Be adversarial. Assume the prose is fluent and wrong somewhere. The
  documents have already passed syntax and link checks, so report no syntax,
  style, wording, missing coverage or opinion. Only accuracy against the code.
- A diagram's contents are claims: every node label, edge direction, edge
  label, participant, message, state, transition and field is a statement
  about the code. Check who calls whom, who imports whom, which file owns
  what, the order of steps, the names of functions, types, files, routes and
  events, the constants, and every "only", "every", "never" and "always".
- Check at least 15 specific claims in each document, riskiest first. A table
  is dense with claims: check it row by row.
- Open the source for each claim. Report ONLY what you can back with a file
  and line. If you find no evidence either way, do not report it.
- A snippet the document presents as an illustration is exempt from literal
  checking; the functions, types and files it names must still exist.
- The repository's own documents are secondary. Where they disagree with the
  code, the code wins.

Report:
1. A table, most severe first, one row per problem:
   | # | Severity | Document:line | Claim as written | What the code says (path:line) | Suggested correction |
   Severity: `wrong` (contradicts the code), `misleading` (true in part, and a
   reader would conclude something false), `stale-risk` (true today, phrased
   so that it will rot: an exact count, a line number).
2. For each document: claims checked, findings.
3. A last line: total claims checked, findings by severity.

Do not pad. A document that is clean after 15 or more checked claims is
reported as clean. No praise, and no summary of what the documents say.
```

What makes it work:

- **"Wrong", not "review".** A reviewer asked for a review returns opinions.
- **A file and line or nothing.** It keeps out what cannot be acted on.
- **A floor of claims per document**, so that a clean report means something.
- **The count at the end.** "No findings" in ten claims and in five hundred
  are different results, and the report of step 8 quotes it.

## What the two runs found

| | First set | Second set |
|---|---|---|
| Claims checked | about 870 | about 860 |
| Findings | 31 | 52 |
| Plainly wrong | 13 | 22 |

Where the errors were, in both:

| Kind | Example |
|---|---|
| The module that triggers, named as the one that performs | A build module drawn writing a manifest that its caller writes |
| "Only", "never", "exactly one" | "The only place the server pushes to a browser", with two more a search found |
| Step order in a sequence diagram | Reconnect drawn as refetch, then flush the queue; the code flushes first |
| The direction of a message | A frame listed as browser to server that goes the other way |
| A name built by analogy | `widgets-tailwind.css`, from the folder's name; the code writes `widget-tailwind.css` |
| A rule stated wider than its test | "Nothing under this folder imports X", when the test exempts a file |

Where they were not: numbers and names copied out of a reader's report. A
chapter of state machines and their constants was clean after 61 checked
claims.
