// Text that came from outside the tool, made safe in the two places it ends
// up: on a line of a report, and as a word of a command printed for someone
// to paste.
//
// A branch's name, a path, a file's name, a commit's subject and what git
// wrote to stderr are all written by someone else. A report that prints them
// as they are can be made to say what it did not find.

/**
 * What a terminal acts on or does not show, by Unicode's own classes and not
 * by a list of ranges, which a new character would not be in: a control
 * character (Cc); a format mark, such as one that turns the text round, has
 * no width, or is a tag (Cf); half a pair, a private character and one that
 * is not assigned (Cs, Co, Cn); a line or paragraph end (Zl, Zp); and a
 * space that is not the space.
 */
const NOT_SHOWN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]|(?! )\p{Zs}/gu;

/** What Node puts where bytes were not text. The name it stands in is another name than the one on disk. */
const NOT_READ = "\ufffd";

/** Needs no quoting in a shell. `-` may not come first: see `shellWord`. */
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./][A-Za-z0-9_@%+=:,./-]*$/;

/**
 * A line as it may be printed. A control character in a commit's subject can
 * clear the line above and write a verdict nobody gave, a line end can start
 * a line of its own, and a mark that turns the text round can show a command
 * other than the one that is pasted. Each is written out as its escape
 * (`\u001b`), so a line of outside text is one line and reads as it is.
 */
export function shown(line: string): string {
  // One escape for each of its two halves, when the character has two: that is how JSON writes it.
  return line.replace(NOT_SHOWN, (character) => Array.from({ length: character.length }, (_, half) => `\\u${character.charCodeAt(half).toString(16).padStart(4, "0")}`).join(""));
}

/**
 * `text` as one word of a command for a POSIX shell (sh, bash, zsh), or
 * undefined when no word that is printed would be that text when pasted.
 *
 * A word of letters, digits and `_ @ % + = : , . / -` is printed as it is.
 * Any other is put in single quotes, inside which a shell reads nothing but
 * the quote itself, written `'\''`. Three kinds of word are refused:
 *
 *   - one that holds a character `shown` writes out. The line it is printed
 *     on goes through `shown`, so the word on the screen would hold the
 *     escape and not the character, and would name something else;
 *   - one that holds the mark Node leaves where bytes were not text;
 *   - one that is empty or starts with `-`, which the program it is handed
 *     to reads as an option.
 */
export function shellWord(text: string): string | undefined {
  if (text === "" || text.startsWith("-") || text.includes(NOT_READ) || shown(text) !== text) {
    return undefined;
  }

  return PLAIN_WORD.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}
