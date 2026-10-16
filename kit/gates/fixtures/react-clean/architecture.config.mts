// Every way a package may import React and be under the rules for it.
export default {
  packages: {
    "packages/domain": { role: "domain" },
    "packages/client-core": { role: "core" },
    "packages/react-bindings": { role: "bindings" },
    // Runs the compiler and says so.
    "packages/client-react": {
      role: "client",
      reactCompiler: true,
      compilerTracked: [
        { file: "src/ui/App.tsx", fn: "App" },
        { file: "src/ui/Totals.tsx", fn: "Totals", values: ["total", "pickFirst"] },
        { file: "src/ui/Totals.tsx", fn: "Totals", minMemoValues: 3 },
        { file: "src/ui/Shared.tsx", fn: "Shared", values: ["visible"] },
      ],
    },
    // Runs the compiler by the plugin's name, not through the preset.
    "packages/client-named": { role: "client", reactCompiler: true },
    // Runs no compiler and bans no memoization.
    "packages/client-plain": { role: "client" },
    // An explicit package takes the React rules of the role it names. Its build is another package's, so no vite.config.ts is read here.
    "packages/catalog": { role: "explicit", reactRules: "client", reactCompiler: true },
    "packages/catalog-bridge": { role: "explicit", reactRules: "bindings" },
    "packages/icons": { role: "leaf" },
  },
  reactWithoutPolicies: {
    "packages/icons": "generated from the design files and never edited by hand",
  },
};
