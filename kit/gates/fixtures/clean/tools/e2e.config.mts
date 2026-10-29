// What the e2e add-on runs, in the shape the end-to-end gate reads.
export default {
  tests: "packages/e2e",
  client: { cwd: "packages/client-react" },
  modes: { sim: {} },
};
