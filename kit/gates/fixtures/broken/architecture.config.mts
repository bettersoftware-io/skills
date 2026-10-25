export default {
  packages: {
    "packages/domain": { role: "domain", npm: ["rxjs"] },
    "packages/contract-types": { role: "leaf", typesOnly: true },
    "packages/client-core": { role: "core", noNodeBuiltins: true, ports: "src/ports" },
    "packages/react-bindings": { role: "bindings", ports: "src/ports" },
    "packages/widgets": { role: "explicit" },
    "packages/client-react": { role: "client" },
    "packages/checks": { role: "integration" },
    "packages/browser-tests": { role: "e2e" },
  },
  adapters: ["packages/domain/src/simulators", "packages/client-core/src/adapters"],
  javascriptAllowed: {
    "stylelint.config.mjs": "stylelint's config loader cannot read .mts",
    "tools/legacy/": "the legacy loader reads only JavaScript from its folder",
  },
  packagesWithoutTests: {
    "packages/rogue": "it holds one constant and no behaviour",
  },
  vendorOnlyIn: {
    ws: ["packages/checks"],
    // One word twice: a package, and the scope its adapters are published under. Each has a list of its own.
    hono: ["packages/checks"],
    "@hono/": ["packages/checks", "packages/react-bindings"],
  },
};
