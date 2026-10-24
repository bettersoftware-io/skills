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

/**
 * Where an expansion stands: in a word, inside double quotes, or in text the
 * shell reads as it reads double quotes but with quotes as text (a heredoc's
 * body, arithmetic).
 */
type Context = "word" | "double" | "body";

/** A command with its line continuations taken out, and where in what is left each one stood. */
interface Joined {
  text: string;
  /** In order: each is where the text after a continuation now starts. */
  at: number[];
}

/**
 * Takes out each line continuation (a backslash and the new line after it),
 * as bash does before it reads a command: `ca`, a continuation and `se` are
 * `case`; `|`, two continuations and `|` are `||`. An escaped backslash is no
 * continuation. Bash leaves one in place in three places: single quotes,
 * where only the text inside changes; a comment; and a quoted heredoc's body.
 * The reader refuses to read the last two when a continuation was taken out
 * there (`Scanner.joinedWithin`).
 */
function joinLines(text: string): Joined {
  let joined = "";
  const at: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "\\" && text[index + 1] === "\n") {
      at.push(joined.length);
      index += 1;
    } else if (char === "\\") {
      joined += text.slice(index, index + 2);
      index += 1;
    } else {
      joined += char;
    }
  }

  return { text: joined, at };
}

/** How many characters the reader may read again, in all, after `((` turned out not to be arithmetic. */
interface Lookahead {
  characters: number;
}

export function parseShell(text: string): Script {
  if (text.length > LONGEST_SCRIPT) {
    throw new LimitError(`the command is longer than ${LONGEST_SCRIPT} characters`);
  }

  const joined = joinLines(text);

  return new Scanner(joined.text, 0, { characters: 0 }, joined.at).script(undefined);
}

class Scanner {
  private readonly text: string;
  private position = 0;
  private depth = 0;
  private readonly heredocs: Heredoc[] = [];
  /** Where a `((` was found to close with one bracket, so that it is looked at once. */
  private readonly notArithmetic = new Set<number>();
  /** Shared by every scanner of one command, so that the bound is on the whole of it. */
  private readonly lookahead: Lookahead;

  /**
   * Where line continuations were taken out of this text. A reader of text
   * made from the command (what backticks hold, a heredoc's body) has none:
   * bash takes those out before it reads such text as well.
   */
  private readonly joins: readonly number[];

  constructor(text: string, depth = 0, lookahead: Lookahead = { characters: 0 }, joins: readonly number[] = []) {
    this.text = text;
    this.depth = depth;
    this.lookahead = lookahead;
    this.joins = joins;
  }

  /** A scanner of part of this text, or of text made from it, at this depth and on this budget. */
  private reader(text: string, joins: readonly number[] = []): Scanner {
    return new Scanner(text, this.depth, this.lookahead, joins);
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
      } else if (char === "\n") {
        if (outside > 0) {
          throw new ShellError("a heredoc's body would begin inside a substitution");
        }

        this.position += 1;
        this.readHeredocBodies(script);
        endStep();
      } else if (char === "#") {
        // Only reached where a word would start, which is where a comment may.
        const from = this.position;

        this.skipLine();

        if (this.joinedWithin(from + 1, this.position + 1)) {
          throw new ShellError("a comment that a line continuation ends is not read: bash keeps the new line there");
        }
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
          const end = this.position - 2;

          script.nested.push(this.reader(this.text.slice(start, end), this.joinsBetween(start, end)).script(undefined));
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
        const start = this.position;
        const word = this.word(script);

        // `2>file`: the digits name a file descriptor, they are not a word.
        if (/^\d+$/.test(word) && (this.text[this.position] === "<" || this.text[this.position] === ">")) {
          continue;
        }

        // A pattern of a `case` ends in `)`, which this would take for the end of the `$(…)`. Wherever `case`
        // stands (after `f()`, `{`, `function f {`), and whether or not it starts a command, it is not read.
        if (closer === ")" && this.text.slice(start, this.position) === "case") {
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

        value += this.unjoined(this.position + 1, end);
        this.position = end + 1;
      } else if (char === '"') {
        this.position += 1;
        value += this.doubleQuoted(script);
      } else if (char === "\\") {
        const next = this.text[this.position + 1];

        this.escape();
        value += next ?? "";
        this.position += 2;
      } else if (char === "$" && this.text[this.position + 1] === "'") {
        value += this.ansiC();
      } else {
        const mark = this.substitution(script, "word");

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
   * nothing, when none starts here.
   */
  private substitution(script: Script, context: Context): string | undefined {
    const char = this.text[this.position];
    const next = this.text[this.position + 1];

    if (char === "`") {
      this.backticks(script, context);

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
      this.parameter(script, context);

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

        this.escape();
        // Inside double quotes a backslash only escapes these.
        value += ['"', "\\", "$", "`"].includes(next) ? next : `\\${next}`;
        this.position += 2;
      } else {
        const mark = this.substitution(script, "double");

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
   * nested `${…}` inside it are read. Anywhere but in a word, a quote inside
   * it is read differently by each shell, and is not read.
   */
  private parameter(script: Script, context: Context): void {
    const quoted = context !== "word";

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
        this.escape();
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
      } else if (this.substitution(script, context) === undefined) {
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
        // Each `((` of a long run is tried to its own close: what such tries read is bounded, over the whole command.
        this.lookahead.characters += this.position - start;

        if (this.lookahead.characters > LONGEST_SCRIPT) {
          throw new LimitError(`the command makes the reader look ahead more than ${LONGEST_SCRIPT} characters`);
        }

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
        this.escape();
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
      } else if (this.substitution(script, "body") === undefined) {
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
   * is then read as a command of its own. Inside double quotes a backslash
   * escapes a double quote there too.
   */
  private backticks(script: Script, context: Context): void {
    const escaped = context === "double" ? ["\\", "`", "$", '"'] : ["\\", "`", "$"];
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
        inside += escaped.includes(next) ? next : `\\${next}`;
        index += 2;
      } else {
        inside += char;
        index += 1;
      }
    }

    this.position = index + 1;

    const reader = this.reader(inside);

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
        const stop = lineEnd === -1 ? this.text.length : lineEnd;
        // A quoted body keeps its continuations: of a line joined here, only what follows the last of them was a line of its own.
        const line = this.text.slice(quoted ? Math.max(this.position, this.lastJoinUpTo(stop)) : this.position, stop);

        end = this.position;
        this.position = stop === this.text.length ? stop : stop + 1;

        if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) {
          break;
        }
      }

      if (!quoted) {
        this.reader(this.text.slice(start, end)).heredocBody(script);
      }
    }
  }

  /** Reads this scanner's whole text as the body of a heredoc whose delimiter is not quoted. */
  private heredocBody(script: Script): void {
    while (this.position < this.text.length) {
      if (this.text[this.position] === "\\") {
        this.escape();
        this.position += 2;
      } else if (this.substitution(script, "body") === undefined) {
        this.position += 1;
      }
    }
  }

  /** Where in `joins` the first place at `at` or after it is. */
  private firstJoinFrom(at: number): number {
    let low = 0;
    let high = this.joins.length;

    while (low < high) {
      const middle = (low + high) >> 1;

      if ((this.joins[middle] ?? 0) < at) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }

  /** The places from `from` up to, not including, `to` where a line continuation was taken out, counted from `from`. */
  private joinsBetween(from: number, to: number): number[] {
    return this.joins.slice(this.firstJoinFrom(from), this.firstJoinFrom(to)).map((join) => join - from);
  }

  /**
   * At a backslash, which escapes what follows it. A new line there is a line
   * continuation that was not taken out before reading: in text made again
   * from the command (backticks make two backslashes one), never in the
   * command itself. Bash would take it out; this does not read such text.
   */
  private escape(): void {
    if (this.text[this.position + 1] === "\n") {
      throw new ShellError("a line continuation in text read again is not read");
    }
  }

  /** Whether a line continuation was taken out at a place from `from` up to, not including, `to`. */
  private joinedWithin(from: number, to: number): boolean {
    return (this.joins[this.firstJoinFrom(from)] ?? to) < to;
  }

  /** The last place up to `to`, included, where a line continuation was taken out, or -1. */
  private lastJoinUpTo(to: number): number {
    return this.joins[this.firstJoinFrom(to + 1) - 1] ?? -1;
  }

  /** The text from `from` to `to` with its line continuations put back, as single quotes keep them. */
  private unjoined(from: number, to: number): string {
    let text = "";
    let at = from;

    for (let index = this.firstJoinFrom(from); index < this.joins.length && (this.joins[index] ?? to + 1) <= to; index += 1) {
      const join = this.joins[index] ?? to;

      text += `${this.text.slice(at, join)}\\\n`;
      at = join;
    }

    return text + this.text.slice(at, to);
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
