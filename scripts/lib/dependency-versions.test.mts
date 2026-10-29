import { describe, expect, it } from "vitest";

import { judgeDependencyVersion } from "./dependency-versions.mts";

describe("a dependency the project has at another version than the add-on's", () => {
  it.each([
    ["2.6.2", "2.5.15"],
    ["^2.6.0", "2.5.15"],
    ["^2.5.15", "2.5.15"],
    ["~1.10.0", "^1.9.4"],
    ["2.6", "2.5.15"],
    [">=27", "^26.2.0"],
    ["npm:@typescript/typescript6@^6.1.0", "npm:@typescript/typescript6@^6.0.2"],
  ])("keeps the project's %s, the newer or the same as the add-on's %s", (project, addon) => {
    expect(judgeDependencyVersion(project, addon)).toBe("keep");
  });

  it.each([
    ["2.5.15", "2.6.2"],
    ["^1.9.4", "^1.10.0"],
    ["0.9.3", "^1.0.0"],
    ["2.5", "2.5.1"],
    [">=26", "^26.2.0"],
  ])("takes the add-on's when the project's %s is older than %s", (project, addon) => {
    expect(judgeDependencyVersion(project, addon)).toBe("take");
  });

  it.each([
    ["github:someone/tool", "^1.0.0"],
    ["latest", "^1.0.0"],
    ["^1.0.0 || ^2.0.0", "^1.0.0"],
    ["workspace:*", "^1.0.0"],
    ["1.0.0-beta.1", "^1.0.0"],
    ["npm:other@^7.0.0", "npm:@typescript/typescript6@^6.0.2"],
    ["^7.0.0", "npm:@typescript/typescript6@^6.0.2"],
  ])("leaves %s against %s to a person, since the two cannot be compared", (project, addon) => {
    expect(judgeDependencyVersion(project, addon)).toBe("conflict");
  });
});
