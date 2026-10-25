import { describe, expect, it } from "vitest";

import { isWorkflow, keepNewerActionRefs, withoutActionRefs } from "./action-pins.mts";

describe("the files compared without their action refs", () => {
  it("are the workflows, and nothing else", () => {
    expect(isWorkflow(".github/workflows/ci.yml")).toBe(true);
    expect(isWorkflow(".github/workflows/scorecard.yaml")).toBe(true);
    expect(isWorkflow(".github/dependabot.yml")).toBe(false);
    expect(isWorkflow(".github/workflows/nested/ci.yml")).toBe(false);
    expect(isWorkflow("tools/ci/.github/workflows/ci.yml")).toBe(false);
  });
});

describe("a workflow without its action refs", () => {
  it("reads the same whatever commit and version each action is at", () => {
    const before = ["steps:", "  - uses: actions/checkout@aaaa # v6.0.1", "    with:", "  - uses: actions/setup-node@bbbb # v6"].join("\n");
    const after = ["steps:", "  - uses: actions/checkout@cccc # v7", "    with:", "  - uses: actions/setup-node@dddd # v7.0.0"].join("\n");

    expect(withoutActionRefs(after)).toBe(withoutActionRefs(before));
  });

  it("still tells two workflows apart by anything else, the action's name among it", () => {
    const shipped = "  - uses: actions/checkout@aaaa # v6\n    with:\n      persist-credentials: false\n";

    expect(withoutActionRefs(shipped.replace("false", "true"))).not.toBe(withoutActionRefs(shipped));
    expect(withoutActionRefs(shipped.replace("actions/checkout", "actions/cache"))).not.toBe(withoutActionRefs(shipped));
  });

  it("reads a quoted ref, a ref with no comment, and a `uses:` of a job", () => {
    expect(withoutActionRefs('      - uses: "actions/checkout@aaaa"')).toBe('      - uses: "actions/checkout@"');
    expect(withoutActionRefs("    uses: owner/repo/.github/workflows/x.yml@main")).toBe("    uses: owner/repo/.github/workflows/x.yml@");
  });

  it("leaves a local action, which has no ref, as it is", () => {
    expect(withoutActionRefs("  - uses: ./.github/actions/setup")).toBe("  - uses: ./.github/actions/setup");
  });
});

describe("the newer of each action", () => {
  it("is the project's where its version is newer, and the shipped one where that is", () => {
    const project = ["  - uses: actions/checkout@new1 # v7", "  - uses: actions/setup-node@old2 # v6.0.0"].join("\n");
    const shipped = ["  - uses: actions/checkout@old1 # v6.0.1", "  - uses: actions/setup-node@new2 # v6.1.0", "  - run: pnpm test"].join("\n");

    expect(keepNewerActionRefs(project, shipped)).toBe(
      ["  - uses: actions/checkout@new1 # v7", "  - uses: actions/setup-node@new2 # v6.1.0", "  - run: pnpm test"].join("\n"),
    );
  });

  it("reads v7 as v7.0.0, so neither is newer and the shipped one stays", () => {
    expect(keepNewerActionRefs("  - uses: a/b@mine # v7", "  - uses: a/b@theirs # v7.0.0")).toBe("  - uses: a/b@theirs # v7.0.0");
    expect(keepNewerActionRefs("  - uses: a/b@mine # v7.0.0", "  - uses: a/b@theirs # v7")).toBe("  - uses: a/b@theirs # v7");
    expect(keepNewerActionRefs("  - uses: a/b@mine # v7.0.1", "  - uses: a/b@theirs # v7")).toBe("  - uses: a/b@mine # v7.0.1");
  });

  it("compares versions by number, not as text", () => {
    expect(keepNewerActionRefs("  - uses: a/b@mine # v4.10.0", "  - uses: a/b@theirs # v4.9.0")).toBe("  - uses: a/b@mine # v4.10.0");
  });

  it("takes the newest the project has where it uses one action twice, on every line that uses it", () => {
    const project = ["  - uses: a/b@one # v7.1.0", "  - uses: a/b@two # v7.2.0", "  - uses: a/b@three # v7.0.0"].join("\n");
    const shipped = ["  - uses: a/b@old # v7.0.0", "  - uses: a/b@old # v7.0.0"].join("\n");

    expect(keepNewerActionRefs(project, shipped)).toBe(["  - uses: a/b@two # v7.2.0", "  - uses: a/b@two # v7.2.0"].join("\n"));
  });

  it("keeps the shipped one when either version cannot be read", () => {
    expect(keepNewerActionRefs("  - uses: a/b@mine", "  - uses: a/b@theirs # v1")).toBe("  - uses: a/b@theirs # v1");
    expect(keepNewerActionRefs("  - uses: a/b@mine # v9", "  - uses: a/b@theirs")).toBe("  - uses: a/b@theirs");
    expect(keepNewerActionRefs("  - uses: a/b@mine # latest", "  - uses: a/b@theirs # v1")).toBe("  - uses: a/b@theirs # v1");
  });

  it("keeps the shipped line's indentation and quotes", () => {
    expect(keepNewerActionRefs("- uses: a/b@mine # v2", "        - uses: 'a/b@theirs' # v1")).toBe("        - uses: 'a/b@mine' # v2");
  });

  it("leaves an action the project does not use as shipped", () => {
    expect(keepNewerActionRefs("  - uses: a/b@mine # v9", "  - uses: c/d@theirs # v1")).toBe("  - uses: c/d@theirs # v1");
  });
});
