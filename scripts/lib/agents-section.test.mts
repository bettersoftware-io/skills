import { describe, expect, it } from "vitest";

import { judgeSection, readSection } from "./agents-section.mts";

describe("an add-on's section of AGENTS.md", () => {
  it("is the text between its markers, trimmed", () => {
    expect(readSection("# Here\n\n<!-- add-on: demo -->\n## Demo\n\nText.\n<!-- /add-on: demo -->\n", "demo")).toBe("## Demo\n\nText.");
  });

  it("is not there without both markers, or with the end only before the start", () => {
    expect(readSection("# Here\n\n<!-- add-on: demo -->\n## Demo\n", "demo")).toBeUndefined();
    expect(readSection("# Here\n\n## Demo\n<!-- /add-on: demo -->\n", "demo")).toBeUndefined();
    expect(readSection("<!-- /add-on: demo -->\n# Here\n<!-- add-on: demo -->\n", "demo")).toBeUndefined();
  });

  it("is another add-on's when the markers name another", () => {
    expect(readSection("<!-- add-on: other -->\nText.\n<!-- /add-on: other -->\n", "demo")).toBeUndefined();
  });

  it.each([
    [{ current: undefined, installed: "a", shipped: "b", shippedBefore: false }, "absent"],
    [{ current: "b", installed: "a", shipped: "b", shippedBefore: false }, "same"],
    [{ current: "a", installed: "a", shipped: "b", shippedBefore: false }, "untouched"],
    [{ current: "mine", installed: "a", shipped: "a", shippedBefore: false }, "kept"],
    [{ current: "mine", installed: "a", shipped: "b", shippedBefore: false }, "edited"],
    [{ current: "old", installed: undefined, shipped: "b", shippedBefore: true }, "untouched"],
    [{ current: "mine", installed: undefined, shipped: "b", shippedBefore: false }, "edited"],
  ] as const)("is judged from what the project has, what was installed and what is shipped: %o is %s", (facts, state) => {
    expect(judgeSection(facts)).toBe(state);
  });
});
