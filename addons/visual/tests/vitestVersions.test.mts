import { describe, expect, it } from "vitest";

import { checkVitestVersions } from "../files/tools/visual/lib/vitestVersions.mts";

describe("checkVitestVersions", () => {
  it("passes when all three are on one version", () => {
    expect(checkVitestVersions({ vitest: "5.0.5", "@vitest/browser-playwright": "5.0.5", "@vitest/coverage-v8": "5.0.5" })).toBeUndefined();
  });

  it("stops when the packages are on different versions, names each and gives the command", () => {
    const reason = checkVitestVersions({ vitest: "5.0.3", "@vitest/browser-playwright": "5.0.5", "@vitest/coverage-v8": "5.0.5" });

    expect(reason).toContain("vitest 5.0.3, @vitest/browser-playwright 5.0.5, @vitest/coverage-v8 5.0.5");
    expect(reason).toContain("pnpm -r update --no-save vitest @vitest/browser-playwright @vitest/coverage-v8");
  });

  it("stops when a package is not installed, and says to install", () => {
    expect(checkVitestVersions({ vitest: "5.0.5", "@vitest/browser-playwright": "5.0.5" })).toBe(
      "@vitest/coverage-v8 is not installed in packages/client-react. Run pnpm install.",
    );
  });
});
