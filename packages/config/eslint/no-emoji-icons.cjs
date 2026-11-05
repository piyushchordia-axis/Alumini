// CommonJS, so the web and shared configs (ES modules) and the phone app's CommonJS config can all load it as it is.
// Comments, regex literals and strings built at runtime (flagEmoji) aren't checked. A later config object that sets
// no-restricted-syntax for the same files replaces these selectors rather than adding to them: list them there too.

const message =
  "Draw icons with the SVG set in components/icons.tsx, not emoji (CLAUDE.md -> Icons). Content such as member text belongs in data, not source.";

/** @type {import("eslint").Linter.Config} */
module.exports = {
  name: "illuminize/no-emoji-icons",
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: "JSXText[value=/\\p{Extended_Pictographic}/u]", message },
      { selector: "Literal[value=/\\p{Extended_Pictographic}/u]", message },
      // The cooked text, like a string's value, so an emoji written as an escape (`\u{1F512}`) is caught too.
      { selector: "TemplateElement[value.cooked=/\\p{Extended_Pictographic}/u]", message },
    ],
  },
};
