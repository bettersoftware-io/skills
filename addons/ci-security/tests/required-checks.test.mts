import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readWorkflow, requiredChecks } from "../files/tools/ci-security/lib/required-checks.mts";
import { ADDON, createFolder } from "./support.mts";

const REPOSITORY = join(ADDON, "..", "..");
const FILE = ".github/workflows/ci.yml";
const NOT_ON_PULL_REQUESTS = "its workflow does not run on pull requests";

describe("the status checks a ruleset can ask for", () => {
  it("are, in a project with the starter's workflow, this add-on's and the coverage add-on's, the five jobs every pull request runs", () => {
    const project = createFolder({
      ".github/workflows/ci.yml": shipped("starter/.github/workflows/ci.yml"),
      ".github/workflows/ci-security.yml": shipped("addons/ci-security/files/.github/workflows/ci-security.yml"),
      ".github/workflows/coverage.yml": shipped("addons/coverage/files/.github/workflows/coverage.yml"),
      ".github/workflows/dependency-review.yml": shipped("addons/ci-security/files/.github/workflows/dependency-review.yml"),
      ".github/workflows/scorecard.yml": shipped("addons/ci-security/files/.github/workflows/scorecard.yml"),
      ".github/workflows/weekly-tag.yml": shipped("addons/agent-workflow/files/.github/workflows/weekly-tag.yml"),
    });

    expect(requiredChecks(project)).toEqual({
      contexts: [
        "workflow lint (actionlint · zizmor)",
        "pnpm audit (production dependencies)",
        "gates · lint · typecheck · test · build",
        "coverage gate · report",
        "dependency review (advisories · licences)",
      ],
      leftOut: [
        { file: ".github/workflows/coverage.yml", job: "publish the report to GitHub Pages", reason: "it has an `if:`, so a pull request can skip it" },
        { file: ".github/workflows/scorecard.yml", job: "scorecard analysis", reason: NOT_ON_PULL_REQUESTS },
        { file: ".github/workflows/weekly-tag.yml", job: "tag the finished week · ask for its changelog entry", reason: NOT_ON_PULL_REQUESTS },
      ],
      unread: [],
    });
  });

  it("are none in a project with no workflow folder", () => {
    expect(requiredChecks(createFolder({ "package.json": "{}" }))).toEqual({ contexts: [], leftOut: [], unread: [] });
  });

  it("are read from .yml and .yaml files, each name once, and from no other file", () => {
    const project = createFolder({
      ".github/workflows/a.yml": workflow("on:\n  pull_request:", job("lint"), job("test")),
      ".github/workflows/b.yaml": workflow("on:\n  pull_request:", job("test"), job("build")),
      ".github/workflows/notes.md": workflow("on:\n  pull_request:", job("from a file that is no workflow")),
      ".github/dependabot.yml": workflow("on:\n  pull_request:", job("from a file outside the folder")),
    });

    expect(requiredChecks(project).contexts).toEqual(["lint", "test", "build"]);
  });

  it("name a workflow that could not be read, and still read the others", () => {
    const project = createFolder({ ".github/workflows/a.yml": workflow("on:\n  pull_request:", job("lint")), ".github/workflows/b.yml": "name: no trigger\njobs:\n  x:\n    runs-on: ubuntu-latest\n" });

    expect(requiredChecks(project)).toEqual({ contexts: ["lint"], leftOut: [], unread: [{ file: ".github/workflows/b.yml", reason: "it has no `on:` at the left edge" }] });
  });
});

describe("a workflow that every pull request starts", () => {
  it.each([
    ["a key with nothing under it", "on:\n  pull_request:\n  push:\n    branches: [main]"],
    ["the one event, on the same line", "on: pull_request"],
    ["one of a list in brackets", "on: [push, pull_request]"],
    ["one of a list of lines", "on:\n  - push\n  - pull_request"],
    ["one of a list that is not indented", "on:\n- push\n- pull_request"],
    ["a key in quotes, under an `on` in quotes", '"on":\n  "pull_request":\n  push:'],
    ["a key with empty braces", "on:\n  pull_request: {}\n  push:"],
    ["a key with a null", "on:\n  push:\n  pull_request: ~"],
    ["a key with only a comment under it", "on:\n  pull_request:\n    # every pull request\n  push:"],
  ])("has `pull_request` as %s", (_form, trigger) => {
    expect(readWorkflow(FILE, workflow(trigger, job("lint")))).toEqual({ contexts: ["lint"], leftOut: [] });
  });

  it("is read past its comments, its blank lines and the mark that starts a document", () => {
    const text = `# What this is for.\n---\nname: CI # the checks\n\non: # when\n  pull_request: # every one\n\njobs: # what\n  checks: # the one job\n    name: lint # and nothing else\n    runs-on: ubuntu-latest\n`;

    expect(readWorkflow(FILE, text)).toEqual({ contexts: ["lint"], leftOut: [] });
  });

  it("is read the same with the line ends of Windows", () => {
    expect(readWorkflow(FILE, workflow("on:\n  pull_request:", job("lint")).replaceAll("\n", "\r\n"))).toEqual({ contexts: ["lint"], leftOut: [] });
  });
});

describe("a workflow that some pull requests do not start", () => {
  it.each([
    ["no pull_request among its events", "on:\n  push:\n    branches: [main]\n  schedule:\n    - cron: '5 0 * * 1'", NOT_ON_PULL_REQUESTS],
    ["another event on the same line", "on: push", NOT_ON_PULL_REQUESTS],
    ["a list without it", "on: [push, workflow_dispatch]", NOT_ON_PULL_REQUESTS],
    ["a list of lines without it", "on:\n  - push\n  - workflow_dispatch", NOT_ON_PULL_REQUESTS],
    ["pull_request_target, which is another event", "on:\n  pull_request_target:\n  push:", NOT_ON_PULL_REQUESTS],
    ["a paths filter", "on:\n  pull_request:\n    paths:\n      - 'src/**'", "its workflow runs on some pull requests only (`paths`)"],
    ["a paths-ignore filter", "on:\n  pull_request:\n    paths-ignore: ['docs/**']", "its workflow runs on some pull requests only (`paths-ignore`)"],
    ["a branches filter and a types filter", "on:\n  pull_request:\n    branches: [main]\n    types: [labeled]", "its workflow runs on some pull requests only (`branches`, `types`)"],
    ["a filter in braces", "on:\n  pull_request: { paths: ['src/**'] }", "its workflow runs on some pull requests only"],
    ["pull_request only as the paths of a push", "on:\n  push:\n    paths:\n      - pull_request", NOT_ON_PULL_REQUESTS],
  ])("is left out, with the reason: %s", (_form, trigger, reason) => {
    expect(readWorkflow(FILE, workflow(trigger, job("lint")))).toEqual({ contexts: [], leftOut: [{ file: FILE, job: "lint", reason }] });
  });
});

describe("a job", () => {
  const onPullRequest = "on:\n  pull_request:";

  it("is named by its `name:`, and by its id when it has none", () => {
    const text = workflow(onPullRequest, "  build-all:\n    runs-on: ubuntu-latest\n    steps:\n      - name: a step is not the job\n        run: pnpm build", job("unit tests"));

    expect(readWorkflow(FILE, text).contexts).toEqual(["build-all", "unit tests"]);
  });

  it.each([
    ["plain, with a trailing comment", "name: gates · lint # the fast ones", "gates · lint"],
    ["in double quotes, with a # that is text", 'name: "build #1: all" # comment', "build #1: all"],
    ["in double quotes, with an escape", 'name: "say \\"hi\\""', 'say "hi"'],
    ["in single quotes, with a doubled quote", "name: 'it''s # green'", "it's # green"],
    ["plain, with an apostrophe and a # with no space before it", "name: don't skip#1 # really", "don't skip#1"],
  ])("has the name GitHub gives its check: %s", (_form, line, name) => {
    expect(readWorkflow(FILE, workflow(onPullRequest, `  checks:\n    ${line}\n    runs-on: ubuntu-latest`)).contexts).toEqual([name]);
  });

  it("is left out when it has an `if:` of its own, and kept when only a step has one", () => {
    const text = workflow(
      onPullRequest,
      "  coverage:\n    name: coverage\n    runs-on: ubuntu-latest\n    steps:\n      - name: Upload\n        if: failure()\n        run: echo",
      "  publish:\n    name: publish\n    needs: coverage\n    if: ${{ github.event_name == 'push' }}\n    runs-on: ubuntu-latest",
    );

    expect(readWorkflow(FILE, text)).toEqual({ contexts: ["coverage"], leftOut: [{ file: FILE, job: "publish", reason: "it has an `if:`, so a pull request can skip it" }] });
  });

  it("is kept when its steps are a list that is not indented under `steps:`, one of them with an `if:`", () => {
    const text = workflow(onPullRequest, "  checks:\n    name: checks\n    steps:\n    - name: Upload\n      if: failure()\n      run: echo\n    - if: always()\n      run: echo");

    expect(readWorkflow(FILE, text)).toEqual({ contexts: ["checks"], leftOut: [] });
  });

  it("with a matrix, is one check per combination, the values in brackets after a name that shows none of them, as GitHub writes them", () => {
    const text = workflow(onPullRequest, "  test:\n    strategy:\n      fail-fast: false\n      matrix:\n        node: [24, 26]\n        os:\n          - ubuntu-latest\n          - 'macos-latest'\n    runs-on: ${{ matrix.os }}");

    expect(readWorkflow(FILE, text)).toEqual({
      contexts: ["test (24, ubuntu-latest)", "test (24, macos-latest)", "test (26, ubuntu-latest)", "test (26, macos-latest)"],
      leftOut: [],
    });
  });

  it("with a matrix, takes each value into a name that shows it, and adds nothing after it", () => {
    const text = workflow(onPullRequest, '  gate:\n    name: a project passes its gate (${{ matrix.scope }})\n    strategy:\n      matrix:\n        scope: ["@acme", "@zeta, the second"]\n    runs-on: ubuntu-latest');

    expect(readWorkflow(FILE, text).contexts).toEqual(["a project passes its gate (@acme)", "a project passes its gate (@zeta, the second)"]);
  });

  it("with a `strategy:` and no matrix, is the one check of its name", () => {
    const text = workflow(onPullRequest, "  test:\n    name: test\n    strategy:\n      fail-fast: false\n    runs-on: ubuntu-latest");

    expect(readWorkflow(FILE, text)).toEqual({ contexts: ["test"], leftOut: [] });
  });

  it.each([
    ["an `include:`", "        node: [24]\n        include:\n          - node: 26", "its matrix has an `include:`, so its combinations are not read"],
    ["an `exclude:`", "        node: [24, 26]\n        exclude:\n          - node: 26", "its matrix has an `exclude:`, so its combinations are not read"],
    ["values from an expression", "        node: ${{ fromJSON(needs.plan.outputs.nodes) }}", "its matrix's `node` is not a list of values written out, so its combinations are not in the file"],
    ["a value that is an object", "        target:\n          - { os: ubuntu-latest }", "its matrix's `target` is not a list of values written out, so its combinations are not in the file"],
    ["a number with a fraction, which GitHub may write otherwise", "        python: [3.10]", "its matrix's `python` is not a list of values written out, so its combinations are not in the file"],
  ])("with a matrix, is left out when it has %s", (_, matrix, reason) => {
    const text = workflow(onPullRequest, `  test:\n    name: test\n    strategy:\n      matrix:\n${matrix}\n    runs-on: ubuntu-latest`);

    expect(readWorkflow(FILE, text)).toEqual({ contexts: [], leftOut: [{ file: FILE, job: "test", reason }] });
  });

  it("with a matrix that is one expression, is left out", () => {
    const text = workflow(onPullRequest, "  test:\n    name: test\n    strategy:\n      matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}\n    runs-on: ubuntu-latest");

    expect(readWorkflow(FILE, text).leftOut).toEqual([{ file: FILE, job: "test", reason: "its matrix is not written out as a block, so its combinations are not in the file" }]);
  });

  it("with a matrix, is left out when its name holds an expression other than a value of the matrix", () => {
    const text = workflow(onPullRequest, "  test:\n    name: test ${{ matrix.node }} on ${{ github.base_ref }}\n    strategy:\n      matrix:\n        node: [24]\n    runs-on: ubuntu-latest");

    expect(readWorkflow(FILE, text).leftOut).toEqual([
      { file: FILE, job: "test ${{ matrix.node }} on ${{ github.base_ref }}", reason: "its `name:` holds an expression other than a value of its matrix, so the check's name is not in the file" },
    ]);
  });

  it("names every check of this repository's own CI that its ruleset asks for, the twelve of its two matrix jobs among them", () => {
    expect(readWorkflow(FILE, readFileSync(join(REPOSITORY, ".github/workflows/ci.yml"), "utf8"))).toEqual({
      contexts: [
        "typecheck · tests",
        ...["none", "coverage", "visual", "performance", "format-lint", "ci-security", "repo-hygiene", "strict-lint", "agent-workflow", "e2e"].map((addon) => `a created project passes its gate (${addon})`),
        "a project created with every add-on passes its gate (@ci-organisation-with-a-long-name)",
        "a project created with every add-on passes its gate (@zeta)",
      ],
      leftOut: [],
    });
  });

  it("is left out when it calls another workflow, and kept when only a step uses an action", () => {
    const text = workflow(onPullRequest, "  shared:\n    uses: ./.github/workflows/shared.yml", "  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7");

    expect(readWorkflow(FILE, text)).toEqual({
      contexts: ["checks"],
      leftOut: [{ file: FILE, job: "shared", reason: "it calls another workflow, and the checks are named after that workflow's jobs" }],
    });
  });

  it("is left out when its name holds an expression", () => {
    const text = workflow(onPullRequest, "  test:\n    name: test on ${{ github.base_ref }}\n    runs-on: ubuntu-latest");

    expect(readWorkflow(FILE, text).leftOut).toEqual([
      { file: FILE, job: "test on ${{ github.base_ref }}", reason: "its `name:` holds an expression, so the check's name is not in the file" },
    ]);
  });

  it("is left out under its id when its name runs over several lines", () => {
    const text = workflow(onPullRequest, "  test:\n    name: >-\n      unit\n      tests\n    runs-on: ubuntu-latest");

    expect(readWorkflow(FILE, text)).toEqual({ contexts: [], leftOut: [{ file: FILE, job: "test", reason: "its `name:` is not written on one line, so the check's name cannot be read" }] });
  });

  it("is not made of a line inside a script that looks like a job", () => {
    const text = workflow(onPullRequest, "  checks:\n    name: checks\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          cat <<EOF\n          fake:\n            name: not a job\n            if: never\n          EOF");

    expect(readWorkflow(FILE, text)).toEqual({ contexts: ["checks"], leftOut: [] });
  });
});

describe("a workflow written in a form this does not read", () => {
  it.each([
    ["no `on:`", "name: CI\njobs:\n  a:\n    runs-on: ubuntu-latest\n", "it has no `on:` at the left edge"],
    ["an `on:` in braces", "on: { pull_request: {} }\njobs:\n  a:\n    runs-on: ubuntu-latest\n", "its `on:` is written in braces on one line"],
    ["an empty `on:`", "on:\njobs:\n  a:\n    runs-on: ubuntu-latest\n", "its `on:` is empty"],
    ["no `jobs:`", "on:\n  pull_request:\n", "it has no `jobs:` at the left edge"],
    ["`jobs:` in braces", "on:\n  pull_request:\njobs: { a: { runs-on: ubuntu-latest } }\n", "its `jobs:` is not written as a block"],
    ["an empty `jobs:`", "on:\n  pull_request:\njobs:\n", "its `jobs:` is not written as a block"],
    ["a job in braces", "on:\n  pull_request:\njobs:\n  a: { runs-on: ubuntu-latest }\n", "under `jobs:`, `a: { runs-on: ubuntu-latest }` is not a job written as a block"],
  ])("is named as not read, never taken as having no job: %s", (_form, text, unread) => {
    expect(readWorkflow(FILE, text)).toEqual({ contexts: [], leftOut: [], unread });
  });
});

/** A workflow of this repository, as it is shipped. */
function shipped(path: string): string {
  return readFileSync(join(REPOSITORY, path), "utf8");
}

function workflow(trigger: string, ...jobs: string[]): string {
  return `name: CI\n\n${trigger}\n\npermissions:\n  contents: read\n\njobs:\n${jobs.join("\n\n")}\n`;
}

/** A job with that name, under an id made from it. */
function job(name: string): string {
  return `  ${name.replaceAll(/\W+/g, "-")}:\n    name: ${name}\n    runs-on: ubuntu-latest`;
}
