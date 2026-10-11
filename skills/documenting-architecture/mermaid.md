# Mermaid: one colour scheme, and what cost time

All of this was seen with Mermaid 11 and 12. `check-diagrams.mts` says whether
a diagram parses; it cannot say whether a reader can follow it.

## One colour scheme

Declare the classes in every flowchart, and use the same meaning everywhere.
Fixed fills with white text read on a light page and on a dark one; Mermaid's
defaults do not.

```
classDef actor   fill:#30363d,stroke:#8b949e,color:#ffffff
classDef ui      fill:#1f6feb,stroke:#79c0ff,color:#ffffff
classDef server  fill:#238636,stroke:#56d364,color:#ffffff
classDef cli     fill:#9e6a03,stroke:#e3b341,color:#ffffff
classDef agent   fill:#8957e5,stroke:#d2a8ff,color:#ffffff
classDef worker  fill:#0e7c86,stroke:#56d4dd,color:#ffffff
classDef shared  fill:#1f2d3d,stroke:#4493f8,color:#e6edf3
classDef store   fill:#607d8b,stroke:#b0bec5,color:#ffffff
classDef ext     fill:#484f58,stroke:#8b949e,color:#ffffff
style someSubgraph fill:transparent,stroke:#6e7681
linkStyle default stroke:#6e7fa3,stroke-width:1.5px
```

Name the meanings once, in the index: which colour is the user interface,
which the server, which data on disk. Sequence, state and class diagrams take
the page's own theme; leave them unstyled.

## What cost time

| What happens | Why | What to do |
|---|---|---|
| A parse error near a node called `call` or `style` | Both are words of the flowchart language | Give the node another id |
| The relationship labels of a `C4Context` diagram lie on top of each other | Its layout does not cope with several relationships to one system; `UpdateLayoutConfig` and label offsets did not help | Draw the context view as a flowchart, with `[Person]` and `[Software system]` written in the labels |
| A container diagram becomes a tangle | A dozen arrows from one node to every worker and store | Put the targets in subgraphs and draw one arrow between subgraphs: `server --> workers` |
| The transition labels of a state diagram overlap | `direction LR` with labels of more than a few words | Leave the direction out, and shorten the labels |
| An "invisible" link `A ~~~ B` is drawn | `linkStyle default stroke:…` applies to it too | Remove the link, or give that one link a transparent stroke by its number |
| A layout of nested boxes comes out stacked the wrong way | `direction` inside a nested subgraph is not kept | Use a plain code block with box-drawing characters |

## What works

- `<br/>`, `<b>` and `<i>` in a flowchart node's label.
- `<br/>` in a state diagram's transition label.
- An edge that says "must not": `A -. "forbidden" .-x B` ends in a cross.
- Edges of two colours: `linkStyle 0,1 stroke:#56d364` and `linkStyle 2
  stroke:#ff7b72`. Edges are numbered in the order they are written, and `A
  --> B --> C` is two.
- `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`,
  `erDiagram` and `mindmap` render under `check-diagrams`. `timeline` and
  `pie` parsed with Mermaid 11. How GitHub draws each was not compared.

## Notation

- In a class diagram, a union is a class with `<<union>>` and one member per
  variant. Do not write `|` in a member.
- In a sequence diagram, `autonumber` lets the prose say "step 7".
- Keep a flowchart to about fifteen nodes. Past that, split it: one diagram
  per question.
