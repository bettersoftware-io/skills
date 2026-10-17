// Vitest and the two packages `visual:coverage` adds beside it are released
// together, under one number, and Vitest does not support a mix. An install
// can bring one about: the add-on asks for `^5.0.3`, a project's lockfile may
// hold vitest at an older 5.x, and the new packages come in at the newest.

/** The packages that must be on one version, as the client package resolves them. */
export const VITEST_PACKAGES = ["vitest", "@vitest/browser-playwright", "@vitest/coverage-v8"] as const;

/** Moves all three to the newest version their ranges allow, without touching any package.json. */
export const ALIGN_COMMAND = `pnpm -r update --no-save ${VITEST_PACKAGES.join(" ")}`;

/** Why the run cannot start, or `undefined` when all three are installed on one version. */
export function checkVitestVersions(installed: Record<string, string | undefined>): string | undefined {
  const missing = VITEST_PACKAGES.filter((name) => installed[name] === undefined);

  if (missing.length > 0) {
    return `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not installed in packages/client-react. Run pnpm install.`;
  }

  if (new Set(VITEST_PACKAGES.map((name) => installed[name])).size > 1) {
    const versions = VITEST_PACKAGES.map((name) => `${name} ${installed[name]}`).join(", ");

    return `Vitest's packages are on different versions in packages/client-react: ${versions}. Vitest does not support a mix. Put them on one version with:\n  ${ALIGN_COMMAND}`;
  }

  return undefined;
}
