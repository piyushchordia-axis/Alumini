/**
 * Text laid side by side (a job's facts, a member's, the console's tiles, the landing's sections) takes as many columns
 * as leave room for its longest word, down to one, so a narrow phone or large text gets fewer columns rather than a word
 * broken in two ("Entrepreneurshi p"). Words are measured by an estimate, never on screen, so both apps can choose the
 * columns before anything is drawn: web `fitColumns` (lib/layout.ts) and mobile `FitGrid`.
 */

/**
 * A character's width, in ems, for the estimate. It errs wide (semibold Latin averages about 0.55), which only means one
 * column a little sooner.
 */
export const CHAR_WIDTH_EM = 0.6;

/** Where a line may end inside a run of text: after a hyphen, a dash or a slash, which stays on the left piece. */
const BREAKS_AFTER = new Set(["-", "‐", "–", "—", "/"]);
/**
 * Of those, the two a line doesn't end after when a digit follows, by UAX #14's LB25 (HY × NU, and SY × NU, which newer
 * engines keep only within a number), as browsers, Android and iOS break: "Noida-201301", "Sector-62" and "12/2026" are
 * drawn whole. Here both always join, the longer reading. The hyphen (U+2010) and the dashes may still end a line before
 * a digit ("₹25,000–35,000").
 */
const JOINS_A_NUMBER = new Set(["-", "/"]);
/** Whitespace a line may end at: any but the non-breaking spaces, which a formatted time ("5:40 pm") may hold. */
const BREAKING_SPACE = /[^\S\u00a0\u2007\u202f]/u;

/**
 * Whether a character is a digit: ASCII, Arabic-Indic, the Indian scripts' (Devanagari to Sinhala, each at the same
 * place in its block) or full width. By code point, as an engine the phone runs may lack \p{Nd}.
 */
function isDigit(char: string | undefined): boolean {
  const c = char?.codePointAt(0);
  if (c === undefined) return false;
  return (c >= 0x30 && c <= 0x39) || (c >= 0x660 && c <= 0x669) || (c >= 0x6f0 && c <= 0x6f9) || (c >= 0x900 && c <= 0xdff && (c & 0x7f) >= 0x66 && (c & 0x7f) <= 0x6f) || (c >= 0xff10 && c <= 0xff19);
}

/**
 * The length of the longest word in `texts`, in characters (code points, so "₹" or an accent is one). A word ends at
 * whitespace (not a non-breaking space) and after `-`, `‐`, `–`, `—` or `/`, where a browser or a phone may wrap the
 * line: "On-site" is "On-" and "site". Not after a `-` or `/` with a digit next ("Noida-201301" is one word), nor
 * after one that starts the word ("-5"). Empty and missing texts count for nothing. Text with no spaces in it (Chinese,
 * say) counts as one word. Where engines may differ, it takes the longer reading, which errs towards fewer columns.
 */
export function longestWordLength(texts: Iterable<string | null | undefined>): number {
  let longest = 0;
  for (const text of texts) {
    if (!text) continue;
    const chars = Array.from(text);
    let word = 0;
    chars.forEach((char, i) => {
      if (BREAKING_SPACE.test(char)) {
        word = 0;
        return;
      }
      word += 1;
      longest = Math.max(longest, word);
      if (BREAKS_AFTER.has(char) && word > 1 && !(JOINS_A_NUMBER.has(char) && isDigit(chars[i + 1]))) word = 0;
    });
  }
  return longest;
}

/**
 * How wide a column must be for a word of `chars` characters at `fontSize`, plus `chrome` (an icon and its gap, a
 * tile's padding and border), and never under `floor`. In whatever unit `fontSize` and `chrome` are given in: points on
 * the phone, rem on the web. The word's width is rounded up to a hundredth of that unit (toFixed first drops the
 * floating-point dust that would otherwise round 5.25 up to 5.26).
 */
export function wordColumnWidth(chars: number, fontSize: number, { chrome = 0, floor = 0, em = CHAR_WIDTH_EM }: { chrome?: number; floor?: number; em?: number } = {}): number {
  const word = Math.ceil(Number((chars * fontSize * em * 100).toFixed(4))) / 100;
  return Math.max(floor, word + chrome);
}

/**
 * How far the phone lets a control's label (`Choice`, `Chip`) grow with the system text size: to twice the usual, WCAG
 * 1.4.4's 200%, while the rest of the screen keeps growing. A label sits beside its box in a chip no wider than its row,
 * and by the estimate above twice is as far as "Entrepreneurship" stays whole in Be a mentor's row on a 390-point phone.
 */
export const CONTROL_TEXT_MAX_SCALE = 2;
