## Visual goldens

Each scenario in `packages/client-react/tests/visual/scenarios.ts` is rendered
in a fixed state and compared with a committed image (a golden). A difference
fails. Goldens are kept per system in `tests/visual/goldens/<platform>/`,
because systems draw text differently. CI compares the `linux-x64` set.

```bash
pnpm visual          # compare every scenario with this system's goldens
pnpm visual:update   # redraw this system's goldens
pnpm visual:jitter   # measure how much the same commit differs from itself (--scenario <name> for one)
pnpm visual:coverage # list the UI that no scenario renders
pnpm visual:check    # in gate:fast: typecheck of the tier
pnpm visual:check:server   # in gate:fast: no Playwright server is started through pnpm
pnpm visual:check:styles   # in gate:fast: main.tsx imports no stylesheet or font besides index.css
```

`pnpm visual` is not part of `gate:full`: it needs a browser and goldens drawn
on this system. Run it yourself after a change that can reach the screen (the
UI, its CSS, a presenter). Skip it for the server, docs and tooling. In CI it
is the `Visual goldens` workflow.

### The pyramid

Start with the small components: every state that matters, one scenario each.
Then a reasonable number of sections, chosen for how parts fit together and
not to cover combinations: the combinations of the parts' states grow
multiplicatively, and each part's states are already pictured below. Then a
few pages, the whole app at the sizes that matter. A set of only whole-app
pictures is the shape to avoid. No gate counts pictures; the word is
"reasonable". The job summary prints how many there are at each level.

Where a new picture belongs:

- a new state of one component: a component scenario (`level: "component"`,
  `mount` naming its entry in `registry.tsx`);
- a section only when the way parts sit together is what could break;
- a page (no `mount`) only for a new screen or a new layout size.

Run `pnpm visual:coverage` to find states no scenario shows yet: it lists the
UI files with code no scenario renders, the most first, with the branches
never taken and the functions never called. It is a report, not a gate.

### Add a scenario

Add an entry to `scenarios.ts`: a name, what is pictured and the state, as
data. Start the name with what is pictured (`price-row-stale`). State goes in
through the app harness or, for a component, as props from the scenario; never
click to reach it, and never wait for time to pass. If the state cannot be
expressed yet, add a field to `Scenario` and deliver it in `seeding.ts`. A new
component gets an entry in `registry.tsx`. These files are the project's:
`scenarios.ts`, `seeding.ts`, `registry.tsx`, `framing.ts`, `tolerance.ts`.
Never edit `host/`, `visual.pw.ts` or `playwright.config.ts`: they are the
add-on's, an update replaces them, and an edited file there makes every update
refuse. Then run `pnpm visual:update`, open the new image, and check it shows
what the name says. Commit the image with the scenario.

In `seeding.ts`, state that must be there before the first render goes in
`app` (data a port answers from memory, a machine that starts with a value,
set through its own intent). State that arrives afterwards goes in `deliver`,
and a wait there is `clock.tick(...)`. A scenario with a `mount` is shown
through `render`. A project without a registry yet starts one from
`tools/templates/visual.packages__client-react__tests__visual__registry.tsx.txt`.

What is captured:

- A component or section is a **root capture**: a fixed width (`width`, or
  `rootWidth` in `framing.ts`), the content's height, a small padding.
- A page is a **viewport capture**: the viewport at `width` and `height`
  (1920x1080 from `framing.ts` by default), nothing added.
- **A dialog is a component** mounted alone, with `capture: "viewport"` and a
  `width` and `height` the size of the picture. Its fixed layer, scrim and `vh`
  sizes are then drawn against the viewport, which is the picture. Do not
  picture a dialog as a root capture. A dialog over the app is a page, used
  sparingly.
- The defaults are in `framing.ts`, the project's file. Change them there,
  never in an add-on file.

### When a comparison fails

1. Read the failure in full. Do not pipe the output through `tail`, `head` or
   `grep`: the cut can hide the failing line and leave a summary that reads as
   a pass.
2. Open `packages/client-react/tests/visual/reports/html/index.html`. Each
   failure shows the golden, the new image and the difference.
3. Decide which it is. **Not meant:** fix the code; leave the goldens alone.
   **Meant:** run `pnpm visual:update`, check that only the scenarios you
   expected changed (`git status`), and commit the images in the same commit as
   the change. Then tell the user the `linux-x64` set also needs a redraw. The
   `Update visual goldens` workflow uploads the images as an artifact and
   commits nothing; its job summary gives the commands. You cannot draw that
   set on another system.

Never update goldens to make a failure go away before you have looked at the
difference and can say why it is correct. If you cannot say why, stop and ask.

### The tolerance

`tolerance.ts` sets a small insurance budget for every scenario, chosen to stay
below the smallest real regression the tier must catch: as shipped,
`maxDiffPixels: 8` and `threshold: 0.01`, held by reference regressions as
small as a 4x4 icon removed (16 pixels). Never raise it to make a failure pass.

A scenario may set `strict`, a larger `maxDiffPixels` or a lower
`pixelThreshold`. Each needs a `pnpm visual:jitter --scenario <name>`
measurement of that scenario and the mechanism understood, both written in a
comment at the scenario. Looser only for a measured, understood difference.
Tighter (`strict`, a lower `pixelThreshold`) whenever the global could hide a
change that matters there, such as a mark smaller than about 6x6 pixels.

### Traps

- **A font imported in `src/main.tsx`.** The host loads only `index.css`, so
  every picture would be drawn in a fallback face and nothing would fail. Put
  the import in `index.css`; `pnpm visual:check:styles` fails otherwise.
- **A component pictured with no colours.** The app's theme providers and
  attributes sit at its root, and a mounted component has none of them unless
  `Surround` in `registry.tsx` gives them. Put the app's theme root there,
  without its layout.
- **A native control's own text** (a `<select>`) draws two ways across
  `linux-x64` runs. Draw the shown value as ordinary text over the control, or
  keep the control out of goldens.
- **The goldens did not change after a change you meant.** The page came from a
  stale server, or the change does not reach any scenario. The config refuses
  to use a server it did not start; if the port is taken, find and stop the
  holder (`lsof -iTCP:4319 -sTCP:LISTEN`), do not set `reuseExistingServer`.
- **A scenario fails now and then.** Something on the page still moves. Find it
  and pin it in the host (its clock, an animation, a late font), or tell the
  user if it is in the browser. Do not add a wait, a retry or tolerance.
- **A run prints its results and never ends.** A server was started through
  pnpm and outlived it. Never write `pnpm exec`, `pnpm run` or `pnpm --filter`
  in a `webServer.command`; start the program by its path
  (`node_modules/.bin/vite`) with `cwd` set to the package.
  `pnpm visual:check:server` fails on it.
- **Upgrading Playwright.** Change the npm version and the image tag in every
  workflow together (the `playwright-pin` gate fails otherwise), then redraw
  every set: a new browser draws new pixels.
- **A missing golden fails; it is never written by a plain run.** On another
  system than the committed sets, `pnpm visual` fails until that system has a
  set of its own. Say so; do not copy another system's images.
