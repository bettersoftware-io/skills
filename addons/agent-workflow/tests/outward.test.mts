import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { commandOf, judgeCall } from "../files/tools/agent-workflow/hooks/split-outward-commands.mts";
import { judgeCommand } from "../files/tools/agent-workflow/lib/outward.mts";
import { LimitError, parseShell } from "../files/tools/agent-workflow/lib/shell.mts";
import { ADDON } from "./support.mts";

const HOOK = join(ADDON, "files/tools/agent-workflow/hooks/split-outward-commands.mts");

describe("what counts as an outward step", () => {
  it.each([
    "git push",
    "git push -u origin worktree-fix",
    "git push --dry-run",
    "gh pr create --title t --body b",
    "gh pr merge 12 --merge",
    "gh pr edit 12 --title t",
    "gh pr comment 12 --body hi",
    "gh pr close 12",
    "gh pr reopen 12",
    "gh pr ready 12",
    "gh pr review 12 --approve",
    "gh workflow run ci.yml --ref main",
    "gh workflow enable ci.yml",
    "gh run rerun 99",
    "gh run cancel 99",
    "gh run delete 99",
    "gh issue create --title t",
    "gh issue comment 3 --body hi",
    "gh issue close 3",
    "gh release create v1",
    "gh release upload v1 file.zip",
    "gh repo create acme/app",
    "gh repo edit --visibility public",
    "gh api repos/acme/app/git/refs -X POST",
    "gh api repos/acme/app/git/refs --method PATCH",
    "gh api repos/acme/app/git/refs --method=DELETE",
    "gh api repos/acme/app/git/refs -XPUT",
    "gh api repos/acme/app/git/refs -f ref=refs/tags/x",
    "gh api repos/acme/app/issues -F title=x",
    "gh api repos/acme/app/issues --raw-field title=x",
    "gh api repos/acme/app/issues --input body.json",
  ])("%s", (outward) => {
    expect(judgeCommand(`git status && ${outward}`)?.chained).toBe(true);
    expect(judgeCommand(outward)).toEqual({ outward: [outward.split(" ").slice(0, 3).join(" ")], chained: false, redirected: false });
  });

  it.each([
    "git fetch origin main",
    "git commit -m wip",
    "git merge origin/main",
    "git pull",
    "git stash push",
    "gh pr view 12",
    "gh pr list --state merged",
    "gh pr checks 12",
    "gh run list --workflow ci.yml",
    "gh run view 99",
    "gh run watch 99",
    "gh issue list",
    "gh release view v1",
    "gh repo view",
    "gh api repos/acme/app/pulls",
    "gh api repos/acme/app/pulls -X GET -f state=closed",
    "gh api repos/acme/app/pulls --jq .[].number",
    "pnpm test",
    "echo push",
  ])("not %s", (local) => {
    expect(judgeCommand(`git status && ${local} ; ls`)).toEqual({ outward: [], chained: false, redirected: false });
  });

  it("finds the push behind git's own options", () => {
    expect(judgeCommand("git -C ../other push")?.outward).toEqual(["git -C ../other"]);
    expect(judgeCommand("git -c user.name=x -C dir push origin b")?.outward).toHaveLength(1);
    expect(judgeCommand("git --git-dir ../x/.git --no-pager push")?.outward).toHaveLength(1);
    expect(judgeCommand("git -C push status")?.outward).toEqual([]);
  });

  it("finds the group behind gh's own options", () => {
    expect(judgeCommand("gh -R acme/app pr merge 12")?.outward).toHaveLength(1);
    expect(judgeCommand("gh --repo acme/app pr view 12")?.outward).toEqual([]);
  });

  it("looks past a variable set for the command, a path to the program and a word the shell allows in front", () => {
    expect(judgeCommand("GH_TOKEN=abc GIT_TRACE=1 git push")?.outward).toHaveLength(1);
    expect(judgeCommand("/usr/bin/git push")?.outward).toHaveLength(1);
    expect(judgeCommand("/opt/homebrew/bin/gh pr merge 1")?.outward).toHaveLength(1);
    expect(judgeCommand("time git push")?.outward).toHaveLength(1);
  });

  // Claude Code looks past these when it matches a rule to a command, so an `allow` rule for a push lets each of them run.
  it.each([
    "nice git push origin worktree-a",
    "nice -n 5 git push origin worktree-a",
    "nice -5 git push origin worktree-a",
    "timeout 30 git push origin worktree-a",
    "timeout -k 5 30s git push origin worktree-a",
    "timeout -s KILL 30 git push origin worktree-a",
    "timeout --signal KILL --kill-after 5s 30 git push origin worktree-a",
    "env -u GIT_DIR git push origin worktree-a",
    "stdbuf -oL git push origin worktree-a",
    "nohup -- git push origin worktree-a",
    "command -p git push origin worktree-a",
    "command -- git push origin worktree-a",
    "builtin git push origin worktree-a",
    "noglob git push origin worktree-a",
    "time -p git push origin worktree-a",
    "nice timeout 30 env GIT_TRACE=1 git push origin worktree-a",
  ])("finds the push behind a program that runs it: %s", (command) => {
    expect(judgeCommand(command)?.outward).toEqual(["git push origin"]);
    expect(judgeCommand(`git add -A && ${command}`)?.chained).toBe(true);
  });

  it("takes no option or number for the command when nothing that runs one stands in front", () => {
    expect(judgeCommand("-n git push")?.outward).toEqual([]);
    expect(judgeCommand("30 git push")?.outward).toEqual([]);
    expect(judgeCommand("command -v git")?.outward).toEqual([]);
    expect(judgeCommand("-s KILL git push")?.outward).toEqual([]);
    expect(judgeCommand("env GH_TOKEN=abc gh pr merge 1")?.outward).toHaveLength(1);
  });
});

describe("how the steps are joined", () => {
  it.each([
    ["&&", "git add -A && git commit -m wip && git push"],
    [";", "git commit -m wip; git push"],
    ["||", "git push || echo failed"],
    ["&", "git push & pnpm test"],
    ["a newline", "git commit -m wip\ngit push"],
    ["a newline, with the outward step first", "gh pr create --fill\ngh pr view"],
    ["two outward steps", "git push -u origin worktree-a && gh pr create --fill"],
    ["a subshell", "(cd ../other && git push)"],
    ["a group", "{ git commit -m wip; git push; }"],
    ["a condition", "if pnpm test; then git push; fi"],
    ["a loop", "for b in a b; do git push origin $b; done"],
    ["cd first", "cd packages/domain && git push"],
  ])("refuses %s", (_name, command) => {
    expect(judgeCommand(command)?.chained).toBe(true);
  });

  it.each([
    ["a pipe into a filter", "git push 2>&1 | tail -2"],
    ["a pipe into two filters", "gh pr create --fill 2>&1 | grep https | head -1"],
    ["a pipe with both streams", "git push |& tail -2"],
    ["a redirection", "git push > push.log 2>&1"],
    ["a line continued with a backslash", "gh pr create \\\n  --title t \\\n  --body b"],
    ["a subshell that holds nothing else", "(git push)"],
    ["a trailing semicolon", "git push;"],
    ["a comment after it", "git push # then open the pull request && gh pr create"],
  ])("lets through %s", (_name, command) => {
    expect(judgeCommand(command)).toMatchObject({ chained: false });
    expect(judgeCommand(command)?.outward).toHaveLength(1);
  });

  it("refuses two outward steps joined by a pipe", () => {
    expect(judgeCommand("git push | gh pr create --fill")).toMatchObject({ chained: true });
  });

  it("refuses an outward step that fills a variable beside another command that fills one", () => {
    expect(judgeCommand("ADDED=$(git add -A) PUSHED=$(git push origin worktree-a)")).toMatchObject({ outward: ["git push origin"], chained: true });
    expect(judgeCommand("ADDED=$(git add -A $(ls)) PUSHED=$(git push origin worktree-a)")?.chained).toBe(true);
    expect(judgeCommand("ADDED=$(INNER=$(git add -A)) PUSHED=$(git push origin worktree-a)")?.chained).toBe(true);
    expect(judgeCommand("EMPTY=$() PUSHED=$(git push origin worktree-a)")?.chained).toBe(false);
    expect(judgeCommand('gh pr create --title "$(cat title.txt)" --body "$(cat body.md)"')?.chained).toBe(false);
  });

  it("refuses two outward steps that each only fill a variable", () => {
    expect(judgeCommand("PUSHED=$(git push) MERGED=$(gh pr merge 1)")).toMatchObject({ outward: ["git push", "gh pr merge"], chained: true });
  });

  it("refuses two outward steps in one step, the second run by a shell behind a pipe", () => {
    expect(judgeCommand('git push 2>&1 | bash -c "gh pr merge 1"')).toMatchObject({ outward: ["git push", "gh pr merge"], chained: true });
  });

  it("names every outward step it found", () => {
    expect(judgeCommand("git add -A && git push -u origin worktree-a && gh pr create --fill")?.outward).toEqual([
      "git push -u",
      "gh pr create",
    ]);
  });
});

describe("text that only mentions an outward step", () => {
  it.each([
    ["a commit message in double quotes", 'git commit -m "explain git push && gh pr create"'],
    ["a commit message in single quotes", "git commit -m 'never chain; git push && gh pr merge'"],
    ["an escaped quote inside the message", 'git commit -m "say \\"git push\\" && go"'],
    ["an echo", "echo 'git push' ; echo done"],
    ["a grep for it", 'grep -rn "git push" docs && ls'],
    ["a commit message in a heredoc", createHeredocCommit("git commit -F -")],
    ["a heredoc whose body has a quote that never closes", "git commit -F - <<EOF\ndon't run git push && gh pr merge here\nEOF"],
    ["a heredoc that strips tabs", "git commit -F - <<-EOF\n\tgit push && gh pr merge\n\tEOF"],
    ["a comment", "git status # git push && gh pr create\nls"],
  ])("is not a step: %s", (_name, command) => {
    expect(judgeCommand(command)).toEqual({ outward: [], chained: false, redirected: false });
  });

  it("still sees the push after a heredoc ends", () => {
    expect(judgeCommand(`${createHeredocCommit("git commit -F -")}\ngit push`)).toMatchObject({ outward: ["git push"], chained: true });
  });

  it("reads a heredoc opened on the same line as the next step", () => {
    expect(judgeCommand("cat <<EOF && git push\ngh pr create --fill\nEOF")).toEqual({ outward: ["git push"], chained: true, redirected: false });
  });
});

describe("a command inside another", () => {
  it("lets a pull request take its body from a heredoc, the usual form", () => {
    const command = "gh pr create --title \"fix: a thing\" --body \"$(cat <<'EOF'\n## Summary\n- don't chain; git push && more\nEOF\n)\"";

    expect(judgeCommand(command)).toEqual({ outward: ["gh pr create"], chained: false, redirected: false });
  });

  it("refuses the same pull request once a push is joined to it", () => {
    const command = "git push && gh pr create --title t --body \"$(cat <<'EOF'\nbody\nEOF\n)\"";

    expect(judgeCommand(command)).toMatchObject({ chained: true, outward: ["git push", "gh pr create"] });
  });

  it("finds an outward step inside a substitution", () => {
    expect(judgeCommand('echo "$(git commit -m wip && git push)"')).toMatchObject({ chained: true });
    expect(judgeCommand("echo `git commit -m wip; git push`")).toMatchObject({ chained: true });
    expect(judgeCommand('ls && echo "$(git push)"')).toMatchObject({ chained: true });
    expect(judgeCommand("diff <(git push 2>&1) expected && ls")).toMatchObject({ chained: true });
  });

  it("counts an outward step inside a substitution of another command as a chain, and one that only fills a variable as one step", () => {
    expect(judgeCommand('echo "$(git push 2>&1)"')).toMatchObject({ outward: ["git push"], chained: true });
    expect(judgeCommand('git commit -m "$(git push origin worktree-a 2>&1)"')).toMatchObject({ outward: ["git push origin"], chained: true });
    expect(judgeCommand("OUT=$(git push 2>&1)")).toEqual({ outward: ["git push"], chained: false, redirected: false });
    expect(judgeCommand("OUT=$(git push origin 'worktree-a')")?.redirected).toBe(true);
  });

  it("refuses an outward step that takes its argument from another", () => {
    expect(judgeCommand('gh pr comment 1 --body "$(gh pr merge 2)"')).toMatchObject({ chained: true });
  });

  it("reads what a shell is asked to run", () => {
    expect(judgeCommand('bash -c "git commit -m wip && git push"')).toMatchObject({ chained: true });
    expect(judgeCommand("sh -lc 'git push; gh pr create --fill'")).toMatchObject({ chained: true });
    expect(judgeCommand('eval "git add -A && git push"')).toMatchObject({ chained: true });
    expect(judgeCommand('bash -c "git push"')).toEqual({ outward: ["git push"], chained: false, redirected: true });
    expect(judgeCommand('bash -c "pnpm test && pnpm build"')).toEqual({ outward: [], chained: false, redirected: false });
  });
});

describe("a push that holds a colon", () => {
  it.each([
    ["a source and a target", "git push origin worktree-a:main"],
    ["a target alone, which deletes it", "git push origin :worktree-a"],
    ["HEAD and a full ref", "git push -u origin HEAD:refs/heads/main"],
    ["a setting in front of push that says where a push goes", "git -c remote.origin.push=worktree-a:main push"],
    ["one behind git's own options", "git -C ../app push origin worktree-a:main"],
    ["a path to the program", "/usr/bin/git push origin worktree-a:main"],
    ["a remote written as a URL", "git push https://github.com/acme/app.git worktree-a"],
    ["a remote written the short way", "git push git@github.com:acme/app.git worktree-a"],
    ["one with a filter behind a pipe", "git push origin worktree-a:main 2>&1 | tail -2"],
    ["one a shell is asked to run", 'bash -c "git push origin worktree-a:main"'],
    ["one eval is given, with no quote around it", "eval git push origin worktree-a:main"],
    ["one that fills a variable", "OUT=$(git push origin worktree-a:main 2>&1)"],
    ["a setting git reads from what is set in front of it", "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.push GIT_CONFIG_VALUE_0=worktree-a:main git push"],
    ["the same setting handed over by env", "env GIT_CONFIG_VALUE_0=worktree-a:main git push"],
    ["a variable where the branch goes", 'git push origin "$BRANCH"'],
    ["a variable in braces", "git push origin ${BRANCH}"],
    ["a bare variable", "git push origin $BRANCH"],
    ["a command whose output is the branch", 'git push origin "$(cat branch.txt)"'],
    ["the same in backticks", "git push origin `cat branch.txt`"],
    ["an escape the shell reads and this does not", "git push origin $'worktree-a\\x3amain'"],
    ["a pattern for file names: a star", "git push origin worktree-*"],
    ["a pattern for file names: a question mark", "git push origin worktree-?"],
    ["a pattern for file names: a set", "git push origin worktree-[ab]"],
    ["braces the shell writes out", "git push origin worktree-{a..c}"],
    ["a branch in double quotes", 'git push origin "worktree-a"'],
    ["a backslash the shell takes out of a word", "git push origin work\\tree-a"],
    ["a word that held a blank inside quotes", 'git push origin "worktree a"'],
    ["one handed to xargs, which the host matches to a rule for a push", "xargs git push origin worktree-a:main"],
    ["a plain one handed to xargs, which adds words from what it is fed", "xargs git push origin worktree-a < branches.txt"],
    ["an option hidden in quotes", 'git push origin worktree-a -"f"'],
    ["an option split by empty quotes", "git push origin worktree-a --forc''e"],
    ["an option with a backslash in it", "git push origin worktree-a --del\\ete"],
    ["a quote around the branch, which a rule reads as written", "git push origin 'worktree-a'"],
    ["two options joined, one of them force", "git push origin worktree-a -uf"],
    ["an option cut short: delete", "git push origin worktree-a --de"],
    ["an option cut short: mirror", "git push --mir origin"],
    ["an option cut short: all", "git push origin --al"],
    ["every branch", "git push origin --branches"],
    ["an option with a value", "git push --push-option=ci.skip origin worktree-a"],
    ["no check before the push", "git push --no-verify origin worktree-a"],
    ["a setting of git in front of push", "git -c push.default=upstream push"],
    ["another repository's folder", "git --git-dir ../other/.git push"],
    ["a value set in front of git", "GIT_TRACE=1 git push origin worktree-a"],
    ["a folder that is not a plain word", "git -C ~/app push origin worktree-a"],
  ])("is found: %s", (_name, command) => {
    expect(judgeCommand(command)).toMatchObject({ chained: false, redirected: true });
  });

  it.each([
    ["a push of a branch by its name", "git push -u origin worktree-a"],
    ["a push behind git's own options", "git -C ../app push origin main"],
    ["a push with its upstream set, said aloud", "git push --set-upstream --verbose origin worktree-a.b_c-1"],
    ["a trial push, quiet and all or nothing", "git push -n -q --atomic --progress --porcelain --dry-run origin worktree-a"],
    ["a push with no pager, from another folder", "git --no-pager -P -C ../app push -u -v --quiet origin worktree-a"],
    ["a push behind a program that only runs it", "nice -n 5 timeout 30 git push origin worktree-a"],
    ["a colon in the filter behind the push", "git push origin main 2>&1 | grep -v remote:"],
    ["a colon in a commit message", 'git commit -m "fix: the list"'],
    ["a fetch with a source and a target", "git fetch origin main:main"],
    ["a stash, which is no push", 'git stash push -m "wip: the list"'],
    ["a pull request with a colon in its title", 'gh pr create --title "fix: the list" --body b'],
  ])("is not: %s", (_name, command) => {
    expect(judgeCommand(command)?.redirected).toBe(false);
  });

  it("is an outward step behind xargs as well, and a chain when another step feeds it", () => {
    expect(judgeCommand("xargs git push origin worktree-a")).toEqual({ outward: ["git push origin"], chained: false, redirected: true });
    expect(judgeCommand("git add -A && xargs git push origin worktree-a")?.chained).toBe(true);
    expect(judgeCommand("echo :main | xargs git push origin worktree-a")?.chained).toBe(true);
  });

  it("is a chain behind a pipe from another command: only what comes after it is a filter", () => {
    expect(judgeCommand("git commit -qam wip | git push origin worktree-a")?.chained).toBe(true);
    expect(judgeCommand("echo worktree-a:main | git push origin main")?.chained).toBe(true);
    expect(judgeCommand("git push origin worktree-a 2>&1 | tee push.log | tail -2")?.chained).toBe(false);
  });

  it("is still a chain when it is joined to another command", () => {
    expect(judgeCommand("git commit -m wip && git push origin worktree-a:main")).toEqual({ outward: ["git push origin"], chained: true, redirected: true });
  });
});

// Each of these runs a push in bash, and the reader once read it as text, or
// as the body of a heredoc, and said nothing.
describe("a push where the reader once did not look", () => {
  it.each([
    ["after an escaped quote in $'…'", "echo $'\\'' ; git push origin worktree-a #'"],
    ["after two escapes in $'…'", "echo $'a\\\\' ; git push origin worktree-a"],
    ["in an unquoted heredoc, inside $(…)", "cat <<EOF\n$(git push origin worktree-a)\nEOF"],
    ["in an unquoted heredoc, inside backticks", "cat <<EOF\n`git push origin worktree-a`\nEOF"],
    ["in an unquoted heredoc, inside ${…}", "cat <<EOF\n${x:-$(git push origin worktree-a)}\nEOF"],
    ["in an unquoted heredoc that strips tabs", "cat <<-EOF\n\t$(git push origin worktree-a)\n\tEOF"],
    ["inside ${…}, in $(…)", "echo ${x:-$(git push origin worktree-a)}"],
    ["inside ${…}, in backticks", "echo ${x:-`git push origin worktree-a`}"],
    ["inside ${…} inside ${…}", "echo ${x:-${y:-$(git push origin worktree-a)}}"],
    ["inside ${…}, after a brace in quotes", "echo ${x:-'}'$(git push origin worktree-a)}"],
    ["after a shift in $((…)), which is no heredoc", "echo $((1<<2))\ngit push origin worktree-a\n2"],
    ["after a shift in $((…)) inside quotes", 'echo "$((1<<2))"\ngit push origin worktree-a\n2'],
    ["after a shift in $[…]", "echo $[1<<2]\ngit push origin worktree-a\n2]"],
    ["after a shift in ((…))", "((x = 1<<2))\ngit push origin worktree-a\n2"],
    ["after a shift in a for loop's ((…))", "for ((i = 0; i < 1<<2; i++)); do :; done\ngit push origin worktree-a\n2"],
    ["inside $((…)), in $(…)", "echo $(( $(git push origin worktree-a) + 1 ))"],
    ["after a heredoc opened before a quote that holds a new line", 'cat <<EOF "\n"; git push origin worktree-a; echo "\nEOF\n"'],
    ["inside backticks inside backticks", "echo `echo \\`git push origin worktree-a\\``"],
    ["in an unquoted heredoc, after $ and a line continuation", "cat <<EOF\n$\\\n(git push origin worktree-a)\nEOF"],
    ["in a heredoc whose delimiter holds a line continuation", "cat <<E\\\nOF\n$(git push origin worktree-a)\nEOF"],
    ["inside backticks in double quotes, between escaped quotes","echo \"`echo \\\" ' \\\"; git push origin worktree-a; echo \\\" ' \\\"`\""],
  ])("is a chain: %s", (_name, command) => {
    expect(judgeCommand(command)).toMatchObject({ outward: ["git push origin"], chained: true });
    expect(judgeCall({ tool_name: "Bash", tool_input: { command } })?.decision).toBe("deny");
  });

  it.each([
    ["a heredoc whose delimiter is in single quotes", "cat <<'EOF'\n$(git push origin worktree-a)\nEOF"],
    ["a heredoc whose delimiter is in double quotes", 'cat <<"EOF"\n$(git push origin worktree-a)\nEOF'],
    ["a heredoc whose delimiter is escaped", "cat <<\\EOF\n`git push origin worktree-a`\nEOF"],
    ["a heredoc whose delimiter is quoted in part", 'cat <<E"O"F\n${x:-$(git push origin worktree-a)}\nEOF'],
    ["an escaped substitution in an unquoted heredoc", "cat <<EOF\n\\$(git push origin worktree-a) \\`git push origin worktree-a\\`\nEOF"],
    ["quotes in an unquoted heredoc, which are text there", "cat <<EOF\n'$HOME' \"don't\"\nEOF"],
    ["a parameter expansion that holds no command", "echo ${x:-wip && git push} ${y#*:} ${#z}"],
    ["$'…' that holds an escaped quote", "echo $'it\\'s git push && gh pr merge'"],
    ["arithmetic that holds the words", "echo $((git + push)) $[gh - pr]"],
    ["line continuations between words and after operators", "git status &&\\\n  ls \\\n  -la |\\\n  wc -l; echo a\\\nb"],
    ["the word case in quotes inside $(…)","echo \"$(grep 'case' notes.txt)\" $(echo \"case\") $(echo x-case)"],
  ])("is not a step: %s", (_name, command) => {
    expect(judgeCommand(command)).toEqual({ outward: [], chained: false, redirected: false });
  });

  it("reads what the lines after the heredoc hold, once its body ends", () => {
    expect(judgeCommand("cat <<EOF\n$(date)\nEOF\ngit push origin worktree-a")).toMatchObject({ outward: ["git push origin"], chained: true });
    expect(judgeCommand("cat <<EOF\n$(date)\nEOF")).toEqual({ outward: [], chained: false, redirected: false });
  });

  it("reads a quoted new line as part of the word, and the heredoc's body after the next unquoted one", () => {
    expect(parseShell('cat <<EOF "a\nb"\nbody\nEOF\nls').steps).toEqual([[["cat", "a\nb"]], [["ls"]]]);
  });

  it("still lets a pull request take its body from an unquoted heredoc that runs nothing", () => {
    const command = 'gh pr create --title t --body "$(cat <<EOF\n## Summary\n- read ${BRANCH}, $((1 + 2)) and $HOME\nEOF\n)"';

    expect(judgeCommand(command)).toEqual({ outward: ["gh pr create"], chained: false, redirected: false });
  });

  it("reads $((…)) that closes with one bracket as a substitution of a subshell, as the shell does", () => {
    expect(judgeCommand("echo $((git push origin worktree-a) )")).toMatchObject({ outward: ["git push origin"], chained: true });
    expect(judgeCommand("((git push origin worktree-a) && ls)")).toMatchObject({ outward: ["git push origin"], chained: true });
  });

  it("reads what is inside ((…)) as commands as well, which a shell without arithmetic runs", () => {
    expect(judgeCommand("((git push origin worktree-a)) && ls")).toMatchObject({ outward: ["git push origin"], chained: true });
  });
});

describe("a push the reader once took for another command", () => {
  it.each([
    ["behind stdbuf with an option that takes a word", "stdbuf -o L git push origin worktree-a", "git push origin"],
    ["behind stdbuf with three such options", "stdbuf -i 0 -o L -e L git push origin worktree-a", "git push origin"],
    ["behind xargs -I", "xargs -I {} git push origin {}", "git push origin"],
    ["behind env -C", "env -C sub git push origin worktree-a", "git push origin"],
    ["behind exec -a", "exec -a name git push origin worktree-a", "git push origin"],
    ["behind stdbuf, a pull request merged", "stdbuf -o L gh pr merge 1", "gh pr merge"],
    ["behind stdbuf, inside bash -c", "stdbuf -o L bash -c 'git push origin worktree-a'", "git push origin"],
    ["git.exe", "git.exe push origin worktree-a", "git.exe push origin"],
    ["git with a Windows path", "'C:\\Git\\bin\\git.exe' push origin worktree-a", "C:\\Git\\bin\\git.exe push origin"],
    ["gh.exe", "gh.exe pr merge 1", "gh.exe pr merge"],
    ["GIT.EXE, in capitals", "GIT.EXE push origin worktree-a", "GIT.EXE push origin"],
    ["git --attr-source with its value as the next word", "git --attr-source HEAD push origin worktree-a", "git --attr-source HEAD"],
    ["git --config-env with its value as the next word", "git --config-env core.x=X push origin worktree-a", "git --config-env core.x=X"],
  ])("is found: %s", (_name, command, first) => {
    expect(judgeCommand(command)?.outward).toEqual([first]);
    expect(judgeCommand(`git add -A && ${command}`)?.chained).toBe(true);
  });

  // git runs `alias.p=push` as `push`, and `p` is all the reader sees of it.
  it.each([
    ["-c alias", "git -c alias.p=push p origin worktree-a"],
    ["-c alias, in capitals", "git -c Alias.P=push P origin worktree-a"],
    ["--config-env alias", "git --config-env alias.p=PUSHED p"],
    ["--config-env= alias", "git --config-env=alias.p=PUSHED p"],
  ])("takes a command that sets an alias for an outward step, and asks about it: %s", (_name, command) => {
    expect(judgeCommand(command)).toMatchObject({ chained: false, redirected: true });
    expect(judgeCommand(command)?.outward).toHaveLength(1);
    expect(judgeCommand(`git add -A && ${command}`)?.chained).toBe(true);
  });

  // A wrapper's option may take a value that is itself `git` or `gh`.
  it.each([
    ["env -C git", "env -C git git push origin worktree-a", "git push origin"],
    ["stdbuf -o gh", "stdbuf -o gh gh pr merge 1", "gh pr merge"],
    ["xargs -I bash", "xargs -I bash bash -c 'git push origin worktree-a'", "git push origin"],
    ["env -C git, then bash -c", "env -C git bash -c 'git push origin worktree-a'", "git push origin"],
  ])("is found where a wrapper's value names a program this reads: %s", (_name, command, first) => {
    expect(judgeCommand(command)?.outward).toEqual([first]);
    expect(judgeCommand(`git add -A && ${command}`)?.chained).toBe(true);
  });

  it("will not read a wrapper followed by more than 32 words that name git, gh or a shell", () => {
    expect(() => judgeCommand(`stdbuf -o L ${"git ".repeat(40)}status`)).toThrow(LimitError);
  });

  // git reads an alias from a setting given in front of it, or from a file a setting includes.
  it.each([
    ["GIT_CONFIG_KEY_0", "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push git p"],
    ["GIT_CONFIG_PARAMETERS", "GIT_CONFIG_PARAMETERS=\"'alias.p'='push'\" git p"],
    ["GIT_CONFIG_GLOBAL, behind env", "env GIT_CONFIG_GLOBAL=/tmp/g git p"],
    ["HOME", "HOME=/tmp/x git p"],
    ["XDG_CONFIG_HOME", "XDG_CONFIG_HOME=/tmp/x git p"],
    ["-c include.path", "git -c include.path=/tmp/a p"],
    ["-c includeIf", "git -c includeIf.onbranch:x.path=/tmp/a p"],
  ])("takes git with a setting in front that may name an alias for an outward step, and asks: %s", (_name, command) => {
    expect(judgeCommand(command)).toMatchObject({ chained: false, redirected: true });
    expect(judgeCommand(command)?.outward).toHaveLength(1);
    expect(judgeCommand(`git add -A && ${command}`)?.chained).toBe(true);
  });

  it.each([
    ["a setting that is no alias", "git -c user.name=x commit -m wip"],
    ["a pager set in front", "GIT_PAGER=cat git log"],
    ["tracing set in front", "GIT_TRACE=1 git status"],
    ["a program behind a wrapper that is not git or gh", "stdbuf -o L make"],
    ["xargs that runs another program", "xargs -I {} echo {}"],
    ["the words as text, with no wrapper in front", "echo git push"],
  ])("is not a step: %s", (_name, command) => {
    expect(judgeCommand(command)).toEqual({ outward: [], chained: false, redirected: false });
  });
});

describe("a step that gives git a meaning another step of the script uses", () => {
  // An alias set by one step is all the next step's `git p` stands for.
  it.each([
    ["git config", "git config alias.p push && git p origin worktree-a"],
    ["git config --global", "git config --global alias.p push; git p"],
    ["git config set", "git config set alias.p push && git p"],
    ["git config --add, an include", "git config --add include.path /tmp/a && git p"],
  ])("refuses a chain whose step writes an alias: %s", (_name, command) => {
    expect(judgeCommand(command)?.chained).toBe(true);
  });

  it("asks about writing an alias alone, and lets reading one through", () => {
    expect(judgeCommand("git config alias.p push")).toMatchObject({ chained: false, redirected: true });
    expect(judgeCommand("git config --get alias.p")).toEqual({ outward: [], chained: false, redirected: false });
    expect(judgeCommand("git config get alias.p")).toEqual({ outward: [], chained: false, redirected: false });
    expect(judgeCommand("git config --list")).toEqual({ outward: [], chained: false, redirected: false });
    expect(judgeCommand("git config user.name x && git status")).toEqual({ outward: [], chained: false, redirected: false });
  });

  // git reads its settings from where these point, wherever in the script they were set.
  it.each([
    ["export HOME", "export HOME=/tmp/x; git p"],
    ["HOME as a step of its own", "HOME=/tmp/x\ngit p"],
    ["declare XDG_CONFIG_HOME", "declare -x XDG_CONFIG_HOME=/tmp/x && git p"],
    ["export GIT_CONFIG_GLOBAL", "export GIT_CONFIG_GLOBAL=/tmp/g; git p"],
    ["GIT_DIR in front", "GIT_DIR=/tmp/r git p"],
    ["export GIT_EXEC_PATH", "export GIT_EXEC_PATH=/tmp/bin; git p"],
  ])("takes git after a step that points its settings elsewhere for an outward step: %s", (_name, command) => {
    expect(judgeCommand(command)?.outward.length).toBeGreaterThan(0);
    expect(judgeCommand(command)?.redirected).toBe(true);
    expect(judgeCommand(`ls && ${command}`)?.chained).toBe(true);
  });

  // The settings HOME points to may say where a push goes (`remote.origin.push`), so even a plain one is asked about.
  it("asks about a plain push after a step that points git's settings elsewhere", () => {
    expect(judgeCommand("HOME=/tmp/x\ngit push origin worktree-a")).toMatchObject({ outward: ["git push origin"], chained: false, redirected: true });
    expect(judgeCommand("git push origin worktree-a")).toMatchObject({ redirected: false });
  });

  it("leaves git alone when the script sets nothing it reads its settings from", () => {
    expect(judgeCommand("export PAGER=cat; git log")).toEqual({ outward: [], chained: false, redirected: false });
  });

  // `env -S` splits its text into a command line, as `bash -c` runs one.
  it.each([
    ["env -S", "env -S 'git push origin worktree-a' && ls"],
    ["env --split-string", "env --split-string 'git push origin worktree-a' && ls"],
    ["env -S joined", "env '-Sgit push origin worktree-a' && ls"],
    ["env --split-string=", "env '--split-string=git push origin worktree-a' && ls"],
    ["env -S, the push alone inside", "ls && env -S 'git push origin worktree-a'"],
  ])("reads the text of env -S as a command: %s", (_name, command) => {
    expect(judgeCommand(command)).toMatchObject({ outward: ["git push origin"], chained: true });
  });
});

// Bash takes each backslash and the new line after it out of the command
// before it reads it, outside single quotes, a comment and the body of a
// quoted heredoc. So the reader does the same, once, for the whole command.
describe("a line continuation", () => {
  const C = "\\\n";

  it.each([
    ["joins two pipes into ||", `git push origin worktree-a |${C}| ls`],
    ["joins two pipes into ||, two at once", `git push origin worktree-a |${C}${C}| ls`],
    ["joins & and & into &&, two at once", `ls &${C}${C}& git push origin worktree-a`],
    ["joins | and & into |&, two at once", `ls |${C}${C}& git push origin worktree-a`],
    ["joins two brackets into ((", `(${C}(x = 1<<2))\ngit push origin worktree-a\n2`],
    ["joins two brackets into ((, two at once", `(${C}${C}(x = 1<<2))\ngit push origin worktree-a\n2`],
    ["joins << to a third <", `cat <<${C}<x\ngit push origin worktree-a\n\nls`],
    ["joins $ to (", `echo $${C}(git push origin worktree-a)`],
    ["joins $ to (, two at once", `echo $${C}${C}(git push origin worktree-a)`],
    ["joins $ to ( in double quotes", `echo "$${C}(git push origin worktree-a)"`],
    ["joins $ to ( inside ${…}", `echo \${x:-$${C}(git push origin worktree-a)}`],
    ["joins $ to ( inside arithmetic", `echo $(( $${C}(git push origin worktree-a) ))`],
    ["joins the letters of push", `ls && git pu${C}${C}sh origin worktree-a`],
    ["joins the letters of gh", `ls && g${C}${C}h pr merge 1`],
    ["is none after an escaped backslash, where the new line ends the step", "echo a\\\\\ngit push origin worktree-a"],
    ["stays in a quoted heredoc's body, where the line after it ends the body", `cat <<'EOF'\nx${C}EOF\ngit push origin worktree-a`],
    ["stays in a quoted heredoc's body that strips tabs", `cat <<-'EOF'\nx${C}\tEOF\ngit push origin worktree-a`],
  ])("%s", (_name, command) => {
    expect(judgeCommand(command)?.chained).toBe(true);
    expect(judgeCall({ tool_name: "Bash", tool_input: { command } })?.decision).toBe("deny");
  });

  it.each([
    ["splits case, two at once, inside $(…)", `echo "$(ca${C}${C}se x in a) ;; esac; git push origin worktree-a)"`],
    ["joins ; and ; into ;; inside a case", `echo "$(case x in a) ;${C}${C}; esac; git push origin worktree-a)"`],
    ["ends a comment, where bash does not take it out", `ls # a note ${C}git push origin worktree-a`],
    ["splits push in a command that cannot be read", `git pu${C}${C}sh origin worktree-a 'never closed`],
    ["splits gh in a command that cannot be read", `g${C}${C}h pr merge 1 'never closed`],
    // Backticks make `\\` a backslash, so a new line after it is a continuation in what they hold: text read again.
    ["comes of backticks, in a word", "echo `git pu\\\\\nsh origin worktree-a`"],
    ["comes of backticks, in double quotes", 'echo `echo "a\\\\\nb" && git push origin worktree-a`'],
    ["comes of backticks, inside ${…}", "echo `echo ${x:-a\\\\\nb} && git push origin worktree-a`"],
    ["comes of backticks, inside arithmetic", "echo `echo $((1 + \\\\\n2)) && git push origin worktree-a`"],
    ["comes of backticks, in a heredoc's body", "echo `cat <<EOF\na\\\\\nb\nEOF\n` && git push origin worktree-a"],
    ["comes of backticks in an unquoted heredoc's body", "cat <<EOF\n`git pu\\\\\nsh origin worktree-a`\nEOF"],
    ["ends a comment inside ((…)), which dash runs as commands", `echo first, at some length; ((x # c${C}git push origin worktree-a\n))`],
  ])("is not read where it %s, and is asked about", (_name, command) => {
    expect(judgeCommand(command)).toBeUndefined();
    expect(judgeCall({ tool_name: "Bash", tool_input: { command } })?.decision).toBe("ask");
  });

  it("is taken out of a pull request's options, and left in its body from a quoted heredoc", () => {
    const command = `gh pr create --title t ${C}  --body "$(cat <<'EOF'\nkeep this \\\nas written; git push && more\nEOF\n)"`;

    expect(judgeCommand(command)).toEqual({ outward: ["gh pr create"], chained: false, redirected: false });
  });

  it("is left in single quotes, where it is text", () => {
    expect(parseShell(`echo 'a${C}b' c${C}d`).steps).toEqual([[["echo", `a${C}b`, "cd"]]]);
  });
});

describe("a command that cannot be read", () => {
  it.each([
    ["a quote that never closes", 'git commit -m "wip && git push'],
    ["a single quote that never closes", "echo 'git push && ls"],
    ["a substitution that never closes", "echo $(git push && ls"],
    ["a heredoc that never ends", "cat <<EOF && git push\nbody"],
    ["$'…' that never closes after an escaped quote", "echo $'a\\' && git push"],
    ["a substitution in an unquoted heredoc that the heredoc's end cuts off", "cat <<EOF\n$(git push\nEOF\nls)\nEOF"],
    ["backticks in an unquoted heredoc that never close", "cat <<EOF\n`git push\nEOF"],
    ["${…} that never closes", "echo ${x:-$(git push)"],
    ["a single quote inside ${…} in an unquoted heredoc", "cat <<EOF\n${x:-'}'$(git push)}\nEOF"],
    ["a single quote inside arithmetic", "echo $(( '$(git push)' ))"],
    ["quotes inside ${…} in double quotes", "echo \"${x:-'\"'$(git push origin worktree-a)'\"'}\""],
    ["arithmetic that never closes", "echo $[1 + $(git push)"],
    ["a case inside $(…), whose patterns close with a bracket", 'echo "$(case x in a) ;; esac; git push origin worktree-a)"'],
    ["a case in a function's braces inside $(…)", 'echo "$(f() { case x in a) ;; esac; }; git push origin worktree-a)"'],
    ["a case as a function's body inside $(…)", 'echo "$(f() case x in a) ;; esac; git push origin worktree-a)"'],
    ["a case split by a line continuation inside $(…)", 'echo "$(ca\\\nse x in a) ;; esac; git push origin worktree-a)"'],
    ["a case in a function written with its keyword inside $(…)",'echo "$(function f { case x in a) ;; esac; }; git push origin worktree-a)"'],
    ["a heredoc opened inside $(…) whose body comes after it", 'echo "$(cat <<EOF)"\ngit push origin worktree-a\nEOF'],
    ["a heredoc opened inside backticks", "echo `cat <<EOF`\ngit push origin worktree-a\nEOF"],
    ["a heredoc whose body would begin inside $(…)", "cat <<EOF $(echo a\ngit push)\nbody\nEOF"],
    ["a heredoc whose body would end inside $(…)", "cat <<EOF $(echo a\nEOF\ngit push origin worktree-a)"],
    // Bash 5 runs the push and reports the quote; bash 3.2 and zsh run nothing.
    ["backticks that close inside single quotes", "echo `echo 'x`; git push origin worktree-a; echo `echo '`"],
    ["backticks that close inside double quotes", 'echo `echo "x`; git push origin worktree-a; echo `echo "`'],
  ])("has no verdict: %s", (_name, command) => {
    expect(judgeCommand(command)).toBeUndefined();
    expect(judgeCall({ tool_name: "Bash", tool_input: { command } })?.decision).toBe("ask");
  });
});

describe("the reader", () => {
  it("splits words, drops redirections, and keeps a pipe inside one step", () => {
    expect(parseShell("A=1 git  push 2>&1 >out.log | tail -n 2 && ls 'a b' \"c d\"").steps).toEqual([
      [
        ["A=1", "git", "push"],
        ["tail", "-n", "2"],
      ],
      [["ls", "a b", "c d"]],
    ]);
  });

  it("keeps a hash inside a word, and a here-string out of the words", () => {
    expect(parseShell("echo a#b <<<'git push' c").steps).toEqual([[["echo", "a#b", "c"]]]);
    // A here-string is not a heredoc: the next line is a step, not a body to skip.
    expect(parseShell("cat <<<'text'\ngit push").steps).toEqual([[["cat"]], [["git", "push"]]]);
  });

  it("keeps a parameter expansion whole outside quotes, whatever is inside its braces", () => {
    expect(parseShell("git push origin ${BRANCH:-main}").steps).toEqual([[["git", "push", "origin", "${BRANCH:-main}"]]]);
    expect(parseShell("echo ${MESSAGE:-wip && git push}").steps).toEqual([[["echo", "${MESSAGE:-wip && git push}"]]]);
  });

  it("keeps a parameter and an arithmetic expansion as text", () => {
    // A substitution leaves a mark where it stood: the word is still there.
    expect(parseShell('git push origin "${BRANCH:-main}" $((1 + 2)) $[3] $(date)').steps).toEqual([[["git", "push", "origin", "${BRANCH:-main}", "$((…))", "$[…]", "$(…)"]]]);
  });
});

describe("the hook", () => {
  it("reads the command from a Claude Code payload, and from a list of words", () => {
    expect(commandOf({ tool_name: "Bash", tool_input: { command: "git push" } })).toBe("git push");
    expect(commandOf({ tool_input: { command: ["bash", "-lc", "echo 'it's'"] } })).toBe("'bash' '-lc' 'echo '\\''it'\\''s'\\'''");
    expect(commandOf({ tool_name: "Write", tool_input: {} })).toBeUndefined();
  });

  it("refuses a chain and says which step is outward and what to do", () => {
    const answer = judgeCall({ tool_name: "Bash", tool_input: { command: "git add -A && git commit -m wip && git push" } });

    expect(answer?.decision).toBe("deny");
    expect(answer?.reason).toContain("Refused");
    expect(answer?.reason).toContain("(git push)");
    expect(answer?.reason).toContain("a tool call of its own");
  });

  it("refuses a chain sent as a list of words", () => {
    const answer = judgeCall({ tool_input: { command: ["bash", "-lc", "git commit -m \"it's done\" && git push"] } });

    expect(answer?.decision).toBe("deny");
    expect(answer?.reason).toContain("git push");
  });

  it("says nothing about a lone outward step, a local chain, or a tool that runs no command", () => {
    expect(judgeCall({ tool_name: "Bash", tool_input: { command: "git push -u origin worktree-a" } })).toBeUndefined();
    expect(judgeCall({ tool_name: "Bash", tool_input: { command: "git add -A && git commit -m wip" } })).toBeUndefined();
    expect(judgeCall({ tool_name: "Write", tool_input: {} })).toBeUndefined();
    expect(judgeCall({})).toBeUndefined();
  });

  it("asks about a push that holds a colon, and says why", () => {
    const answer = judgeCall({ tool_name: "Bash", tool_input: { command: "git push origin worktree-a:main" } });

    expect(answer?.decision).toBe("ask");
    expect(answer?.reason).toContain("holds a colon");
    expect(answer?.reason).toContain("whatever rule allows a push");
  });

  it("asks nothing of Codex, which sends the id of its turn and does not read a question", () => {
    const fromCodex = { tool_name: "Bash", tool_input: { command: "git push origin worktree-a:main" }, turn_id: "turn-1" };

    expect(judgeCall(fromCodex)).toBeUndefined();
    expect(judgeCall({ ...fromCodex, turn_id: undefined })?.decision).toBe("ask");
    expect(judgeCall({ ...fromCodex, tool_input: { command: "git add -A && git push origin worktree-a:main" } })?.decision).toBe("deny");
  });

  it("asks about a push whose branch the shell fills in, which may come to hold a colon", () => {
    expect(judgeCall({ tool_name: "Bash", tool_input: { command: 'git push origin "$BRANCH"' } })?.reason).toContain("a word the shell turns into another");
    expect(judgeCall({ tool_name: "Bash", tool_input: { command: "GIT_CONFIG_VALUE_0=worktree-a:main git push" } })?.decision).toBe("ask");
  });

  it.each([
    ["a force hidden in quotes", 'git push origin worktree-a -"f"'],
    ["a force joined to another option", "git push origin worktree-a -uf"],
    ["a delete cut short", "git push origin worktree-a --de"],
    ["a push behind nice, with a colon", "nice git push origin worktree-a:main"],
    ["a push that xargs adds words to", "xargs git push origin worktree-a < branches.txt"],
  ])("asks about %s, which no rule of the host reads", (_name, command) => {
    expect(judgeCall({ tool_name: "Bash", tool_input: { command } })?.decision).toBe("ask");
    expect(judgeCall({ tool_name: "Monitor", tool_input: { command } })?.decision).toBe("ask");
  });

  it.each([
    ["behind nice", "git add -A && git commit -m wip && nice git push origin worktree-a"],
    ["behind timeout", "git add -A && timeout 30 git push origin worktree-a"],
    ["fed by a pipe", "echo :main | xargs git push origin worktree-a"],
    ["inside the message of a commit", 'git commit -m "$(git push origin worktree-a 2>&1)"'],
  ])("refuses a chain with the push %s", (_name, command) => {
    expect(judgeCall({ tool_name: "Bash", tool_input: { command } })?.decision).toBe("deny");
  });

  it("says nothing about a plain push behind a program that only runs it", () => {
    expect(judgeCall({ tool_name: "Bash", tool_input: { command: "nice -n 5 timeout 30 git push -u origin worktree-a" } })).toBeUndefined();
  });

  it("asks about a command it cannot read that names an outward step, and says nothing of it to Codex", () => {
    const unread = { tool_name: "Bash", tool_input: { command: "git push origin worktree-a 'never closed" } };
    const answer = judgeCall(unread);

    expect(answer?.decision).toBe("ask");
    expect(answer?.reason).toContain("could not be read");
    expect(judgeCall({ ...unread, turn_id: "turn-1" })).toBeUndefined();
    expect(judgeCall({ tool_name: "Bash", tool_input: { command: "pnpm test 'never closed" } })).toBeUndefined();
  });

  it("refuses, and does not ask, when a push that holds a colon is joined to another command", () => {
    expect(judgeCall({ tool_name: "Bash", tool_input: { command: "git commit -m wip && git push origin worktree-a:main" } })?.decision).toBe("deny");
  });

  it("asks in the shape Claude Code reads, when run as a command", () => {
    const asked = runHook({ tool_name: "Bash", tool_input: { command: "git push origin :worktree-a" }, permission_mode: "default" });
    const reply = JSON.parse(asked.stdout) as { hookSpecificOutput: Record<string, string> };

    expect(asked.status).toBe(0);
    expect(Object.keys(reply.hookSpecificOutput)).toEqual(["hookEventName", "permissionDecision", "permissionDecisionReason"]);
    expect(reply.hookSpecificOutput.permissionDecision).toBe("ask");
    expect(runHook({ tool_name: "Bash", tool_input: { command: "git push origin :worktree-a" }, turn_id: "turn-1" }).stdout).toBe("");
  });

  it("replies in the shape both hosts read, when run as a command", () => {
    const refused = runHook({ tool_name: "Bash", tool_input: { command: "git commit -m wip && git push" } });
    const reply = JSON.parse(refused.stdout) as { hookSpecificOutput: Record<string, string> };

    expect(refused.status).toBe(0);
    expect(reply.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(reply.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(reply.hookSpecificOutput.permissionDecisionReason).toContain("git push");
  });

  it("prints nothing for a command it lets through, when run as a command", () => {
    const allowed = runHook({ tool_name: "Bash", tool_input: { command: "git push 2>&1 | tail -2" } });

    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toBe("");
    expect(allowed.stderr).toBe("");
  });

  it("lets a call through when it is sent nothing at all", () => {
    const empty = spawnSync(process.execPath, [HOOK], { input: "", encoding: "utf8" });

    expect(empty.status).toBe(0);
    expect(empty.stdout).toBe("");
  });
});

function runHook(payload: unknown): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
}

function createHeredocCommit(command: string): string {
  return `${command} <<'EOF'\nfix: split the calls\n\nNever write git push && gh pr create in one call.\nEOF`;
}
