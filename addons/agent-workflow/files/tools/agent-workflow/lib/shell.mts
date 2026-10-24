// Reads a shell command line far enough to answer one question: which
// commands does it run, and how are they joined?
//
// It is not a shell. It knows quoting, heredocs, redirections, pipes, the
// separators (`&&`, `||`, `;`, `&`, a newline), grouping, command
// substitution, and the expansions a command can hide in: `${…}`, `$((…))`,
// `$[…]`, `((…))` and the body of a heredoc whose delimiter is not quoted. It
// expands nothing: `$branch` stays the text `$branch`.
//
// A command it cannot read (a quote that never closes) throws `ShellError`,
// and so does one that shells read differently from one another (a `case`
// inside `$(…)`, a single quote inside arithmetic). A command it will not
// read (too long, or nested too deep) throws `LimitError`. The caller decides
// what each means.

export class ShellError extends Error {}

/** Not a `ShellError`: the text was not found unreadable, it was not read. */
export class LimitError extends Error {}

/** Longer than any command a person or an agent writes, a file in a heredoc included. Reading is one pass, so this bounds time. */
export const LONGEST_SCRIPT = 1_000_000;
/**
 * How deep `$(…)`, backticks, `<(…)`, `${…}` and arithmetic may nest. Each
 * level is a call of the reader inside itself: without a bound, a command
 * nested some thousands deep ends the process with a stack overflow, and a
 * hook that died answers nothing.
 */
export const DEEPEST_NESTING = 40;

/** One command of a pipeline: its words, with quotes removed and redirections dropped. */
export type Stage = string[];

/** Commands joined by `|`. Whatever joins two steps (`&&`, `;`, a newline) ends one. */
export type Step = Stage[];

export interface Script {
  steps: Step[];
  /** What runs inside `$(…)`, backticks and `<(…)` anywhere in this script, a heredoc's body and an expansion included. */
  nested: Script[];
}

interface Heredoc {
  delimiter: string;
  /** `<<-`: leading tabs do not count. */
  stripTabs: boolean;
  /** Any quote or backslash in the delimiter. Without one, the shell expands `$(…)`, `${…}` and backticks in the body. */
  quoted: boolean;
}

const WORD_END = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"]);
/** Words after which the next word is still where a command starts. */
const BEFORE_A_COMMAND = new Set(["!", "{", "then", "do", "else", "elif", "if", "while", "until", "time"]);

export function parseShell(text: string): Script {
  if (text.length > LONGEST_SCRIPT) {
    throw new LimitError(`the command is longer than ${LONGEST_SCRIPT} characters`);
  }

  return new Scanner(text).script(undefined);
}

class Scanner {
  private readonly text: string;
  private position = 0;
  private depth = 0;
  private readonly heredocs: Heredoc[] = [];
  /** Where a `((` was found to close with one bracket, so that it is looked at once. */
  private readonly notArithmetic = new Set<number>();

  constructor(text: string, depth = 0) {
    this.text = text;
    this.depth = depth;
  }

  /** Reads commands up to the `)` that closes them, or to the end when there is none. */
  script(closer: ")" | undefined): Script {
    const script: Script = { steps: [], nested: [] };
    let step: Step = [];
    let stage: Stage = [];
    let groups = 0;
    // Heredocs opened outside: their bodies start after a new line out there, not in here.
    const outside = this.heredocs.length;

    this.enter();

    const endStage = (): void => {
      if (stage.length > 0) {
        step.push(stage);
      }

      stage = [];
    };
    const endStep = (): void => {
      endStage();

      if (step.length > 0) {
        script.steps.push(step);
      }

      step = [];
    };

    for (;;) {
      const char = this.text[this.position];

      if (char === undefined) {
        if (closer !== undefined) {
          throw new ShellError(`"${closer}" is never closed`);
        }

        break;
      }

      if (char === " " || char === "\t") {
        this.position += 1;
      } else if (char === "\\" && this.text[this.position + 1] === "\n") {
        this.position += 2;
      } else if (char === "\n") {
        if (outside > 0) {
          throw new ShellError("a heredoc's body would begin inside a substitution");
        }

        this.position += 1;
        this.readHeredocBodies(script);
        endStep();
      } else if (char === "#") {
        // Only reached where a word would start, which is where a comment may.
        this.skipLine();
      } else if (char === ";") {
        this.position += 1;
        endStep();
      } else if (char === "&") {
        if (this.text[this.position + 1] === ">") {
          this.redirection(script);
        } else {
          this.position += this.text[this.position + 1] === "&" ? 2 : 1;
          endStep();
        }
      } else if (char === "|") {
        if (this.text[this.position + 1] === "|") {
          this.position += 2;
          endStep();
        } else {
          this.position += this.text[this.position + 1] === "&" ? 2 : 1;
          endStage();
        }
      } else if (char === "<" || char === ">") {
        this.redirection(script);
      } else if (char === "(") {
        const start = this.position + 2;

        if (this.text[this.position + 1] === "(" && this.arithmetic({ steps: [], nested: [] }, start)) {
          // `((…))` is arithmetic to bash and zsh, and two subshells to dash: what is inside is read as commands, which finds both.
          script.nested.push(new Scanner(this.text.slice(start, this.position - 2), this.depth).script(undefined));
          stage.push("((…))");
        } else {
          // A subshell runs what is inside it: the brackets change nothing here.
          this.position += 1;
          groups += 1;
        }
      } else if (char === ")") {
        if (groups === 0 && closer === ")") {
          this.position += 1;
          break;
        }

        this.position += 1;
        groups = Math.max(0, groups - 1);
      } else {
        const word = this.word(script);

        // `2>file`: the digits name a file descriptor, they are not a word.
        if (/^\d+$/.test(word) && (this.text[this.position] === "<" || this.text[this.position] === ">")) {
          continue;
        }

        // A pattern of a `case` ends in `)`, which this would take for the end of the `$(…)`.
        if (closer === ")" && word === "case" && stage.every((before) => BEFORE_A_COMMAND.has(before))) {
          throw new ShellError("a case inside a substitution is not read");
        }

        stage.push(word);
      }
    }

    if (closer !== undefined && this.heredocs.length > outside) {
      throw new ShellError("a heredoc opened inside a substitution has no body inside it");
    }

    endStep();
    this.leave();

    return script;
  }

  /** Reads one word, with its quotes removed. Substitutions inside it go to `script.nested`. */
  private word(script: Script): string {
    let value = "";

    for (;;) {
      const char = this.text[this.position];

      if (char === undefined || WORD_END.has(char)) {
        return value;
      }

      if (char === "'") {
        const end = this.text.indexOf("'", this.position + 1);

        if (end === -1) {
          throw new ShellError("a single quote is never closed");
        }

        value += this.text.slice(this.position + 1, end);
        this.position = end + 1;
      } else if (char === '"') {
        this.position += 1;
        value += this.doubleQuoted(script);
      } else if (char === "\\") {
        const next = this.text[this.position + 1];

        value += next === undefined || next === "\n" ? "" : next;
        this.position += 2;
      } else if (char === "$" && this.text[this.position + 1] === "'") {
        value += this.ansiC();
      } else {
        const mark = this.substitution(script, false);

        if (mark === undefined) {
          value += char;
          this.position += 1;
        } else {
          value += mark;
        }
      }
    }
  }

  /** Reads `$'…'`, where a backslash escapes the character after it, a quote included. Its text stays as written. */
  private ansiC(): string {
    let end = this.position + 2;

    for (;;) {
      const char = this.text[end];

      if (char === undefined) {
        throw new ShellError("a single quote is never closed");
      }

      if (char === "'") {
        break;
      }

      end += char === "\\" ? 2 : 1;
    }

    const value = this.text.slice(this.position + 2, end);

    this.position = end + 1;

    return value;
  }

  /**
   * Reads the substitution or expansion that starts here: `$(…)`, `$((…))`,
   * `$[…]`, `${…}` or backticks. What runs inside goes to `script.nested`.
   * Returns the mark it leaves in the word, or undefined, having read
   * nothing, when none starts here. `quoted`: it stands inside double quotes,
   * arithmetic or a heredoc's body, where shells disagree about a quote
   * inside `${…}`.
   */
  private substitution(script: Script, quoted: boolean): string | undefined {
    const char = this.text[this.position];
    const next = this.text[this.position + 1];

    if (char === "`") {
      this.backticks(script);

      return "`…`";
    }

    if (char !== "$") {
      return undefined;
    }

    if (next === "(") {
      if (this.text[this.position + 2] === "(" && this.arithmetic(script, this.position + 3)) {
        return "$((…))";
      }

      this.position += 2;
      script.nested.push(this.script(")"));

      return "$(…)";
    }

    if (next === "[") {
      this.position += 2;
      this.arithmeticBody(script, "]");

      return "$[…]";
    }

    if (next === "{") {
      const start = this.position;

      this.position += 2;
      this.parameter(script, quoted);

      return this.text.slice(start, this.position);
    }

    return undefined;
  }

  /** Reads to the closing double quote; the opening one is already behind. */
  private doubleQuoted(script: Script): string {
    let value = "";

    for (;;) {
      const char = this.text[this.position];

      if (char === undefined) {
        throw new ShellError("a double quote is never closed");
      }

      if (char === '"') {
        this.position += 1;

        return value;
      }

      if (char === "\\") {
        const next = this.text[this.position + 1] ?? "";

        // Inside double quotes a backslash only escapes these.
        value += ['"', "\\", "$", "`"].includes(next) ? next : next === "\n" ? "" : `\\${next}`;
        this.position += 2;
      } else {
        // `${…}` stays text here, read on as the rest of the quote is: its own quotes come in pairs.
        const mark = char === "$" && this.text[this.position + 1] === "{" ? undefined : this.substitution(script, true);

        if (mark === undefined) {
          value += char;
          this.position += 1;
        } else {
          value += mark;
        }
      }
    }
  }

  /**
   * Reads `${…}` to its `}`; `${` is already behind. A `}` in quotes, escaped
   * or inside a substitution does not close it, and `$(…)`, backticks and a
   * nested `${…}` inside it are read.
   */
  private parameter(script: Script, quoted: boolean): void {
    this.enter();

    for (;;) {
      const char = this.text[this.position];

      if (char === undefined) {
        throw new ShellError('"${" is never closed');
      }

      if (char === "}") {
        this.position += 1;
        break;
      }

      if (char === "\\") {
        this.position += 2;
      } else if (char === "'" || char === '"') {
        if (quoted) {
          throw new ShellError("a quote inside ${…} within quotes is read differently by each shell");
        }

        if (char === '"') {
          this.position += 1;
          this.doubleQuoted(script);
        } else {
          const end = this.text.indexOf("'", this.position + 1);

          if (end === -1) {
            throw new ShellError("a single quote is never closed");
          }

          this.position = end + 1;
        }
      } else if (!quoted && char === "$" && this.text[this.position + 1] === "'") {
        this.ansiC();
      } else if (this.substitution(script, quoted) === undefined) {
        this.position += 1;
      }
    }

    this.leave();
  }

  /**
   * At `$((` or `((`, with `start` just after the brackets: reads to the
   * closing `))` and returns true when what is inside is arithmetic. When a
   * single `)` closes it first, it is a subshell inside `$(…)` or `(…)`, as
   * the shell reads it: nothing is read and this returns false.
   */
  private arithmetic(script: Script, start: number): boolean {
    if (this.notArithmetic.has(start)) {
      return false;
    }

    const from = this.position;
    const inside: Script = { steps: [], nested: [] };

    this.position = start;

    try {
      this.arithmeticBody(inside, "))");
    } catch (error) {
      if (error instanceof NotArithmetic) {
        this.notArithmetic.add(start);
        this.position = from;

        return false;
      }

      throw error;
    }

    script.nested.push(...inside.nested);

    return true;
  }

  /**
   * Reads arithmetic up to `close`. Inside it `<<` is a shift and `#`, `;`
   * and `&` are characters; only substitutions run, and they are read.
   */
  private arithmeticBody(script: Script, close: "))" | "]"): void {
    const [open, shut] = close === "]" ? ["[", "]"] : ["(", ")"];
    let brackets = 0;
    let singleQuoted = false;

    this.enter();

    for (;;) {
      const char = this.text[this.position];

      if (char === undefined) {
        throw new ShellError(`"${close === "]" ? "$[" : "(("}" is never closed`);
      }

      if (char === shut && brackets > 0) {
        brackets -= 1;
        this.position += 1;
      } else if (char === shut) {
        if (close === "))" && this.text[this.position + 1] !== ")") {
          this.leave();

          throw new NotArithmetic();
        }

        this.position += close.length;
        break;
      } else if (char === open) {
        brackets += 1;
        this.position += 1;
      } else if (char === "\\") {
        this.position += 2;
      } else if (char === "'") {
        // Read past, for a subshell may yet close this; once it is known to be arithmetic, it is not read.
        const end = this.text.indexOf("'", this.position + 1);

        if (end === -1) {
          throw new ShellError("a single quote is never closed");
        }

        singleQuoted = true;
        this.position = end + 1;
      } else if (char === '"') {
        this.position += 1;
        this.doubleQuoted(script);
      } else if (this.substitution(script, true) === undefined) {
        this.position += 1;
      }
    }

    if (singleQuoted) {
      throw new ShellError("a single quote inside arithmetic is read differently by each shell");
    }

    this.leave();
  }

  /**
   * Reads backticks; the opening one is here. What they hold ends at the
   * first backtick no backslash escapes, whatever quotes stand before it, and
   * is then read as a command of its own.
   */
  private backticks(script: Script): void {
    let inside = "";
    let index = this.position + 1;

    for (;;) {
      const char = this.text[index];

      if (char === undefined) {
        throw new ShellError('"`" is never closed');
      }

      if (char === "`") {
        break;
      }

      if (char === "\\") {
        const next = this.text[index + 1] ?? "";

        // Inside backticks a backslash only escapes these.
        inside += ["\\", "`", "$"].includes(next) ? next : `\\${next}`;
        index += 2;
      } else {
        inside += char;
        index += 1;
      }
    }

    this.position = index + 1;

    const reader = new Scanner(inside, this.depth);

    script.nested.push(reader.script(undefined));

    if (reader.heredocs.length > 0) {
      throw new ShellError("a heredoc opened inside backticks has no body inside them");
    }
  }

  /** Reads a redirection and what it points at. Neither is a word of the command. */
  private redirection(script: Script): void {
    const operator = /^(?:&>>?|<<<|<<-?|<&|<>|<\(|>\(|>>|>&|>\||<|>)/.exec(this.text.slice(this.position))?.[0] ?? "";

    this.position += operator.length;

    if (operator === "<(" || operator === ">(") {
      script.nested.push(this.script(")"));

      return;
    }

    while (this.text[this.position] === " " || this.text[this.position] === "\t") {
      this.position += 1;
    }

    const start = this.position;
    const target = this.word(script);

    if (operator === "<<" || operator === "<<-") {
      this.heredocs.push({ delimiter: target, stripTabs: operator === "<<-", quoted: /['"\\]/.test(this.text.slice(start, this.position)) });
    }
  }

  /**
   * Called just after a newline: reads the body of every heredoc opened on
   * the line before. A body under a quoted delimiter is text; any other is
   * read as the inside of double quotes is, but with quotes as text.
   */
  private readHeredocBodies(script: Script): void {
    for (const { delimiter, stripTabs, quoted } of this.heredocs.splice(0)) {
      const start = this.position;
      let end = start;

      for (;;) {
        if (this.position >= this.text.length) {
          throw new ShellError(`the heredoc "${delimiter}" is never closed`);
        }

        const lineEnd = this.text.indexOf("\n", this.position);
        const line = this.text.slice(this.position, lineEnd === -1 ? this.text.length : lineEnd);

        end = this.position;
        this.position = lineEnd === -1 ? this.text.length : lineEnd + 1;

        if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) {
          break;
        }
      }

      if (!quoted) {
        new Scanner(this.text.slice(start, end), this.depth).heredocBody(script);
      }
    }
  }

  /** Reads this scanner's whole text as the body of a heredoc whose delimiter is not quoted. */
  private heredocBody(script: Script): void {
    while (this.position < this.text.length) {
      if (this.text[this.position] === "\\") {
        this.position += 2;
      } else if (this.substitution(script, true) === undefined) {
        this.position += 1;
      }
    }
  }

  private skipLine(): void {
    const end = this.text.indexOf("\n", this.position);

    this.position = end === -1 ? this.text.length : end;
  }

  /** One level deeper, within the bound. */
  private enter(): void {
    this.depth += 1;

    if (this.depth > DEEPEST_NESTING + 1) {
      throw new LimitError(`the command nests substitutions more than ${DEEPEST_NESTING} deep`);
    }
  }

  private leave(): void {
    this.depth -= 1;
  }
}

/** Thrown inside arithmetic that a single `)` closes, which is a subshell after all. Never leaves the scanner. */
class NotArithmetic extends Error {}
