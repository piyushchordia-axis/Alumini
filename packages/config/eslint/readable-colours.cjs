// CommonJS, like no-emoji-icons.cjs, so the web app's config (an ES module) and the phone app's CommonJS config can
// both load it as it is. A plugin rule rather than no-restricted-syntax, because a second no-restricted-syntax for the
// same files would replace the emoji selectors instead of adding to them.
//
// It keeps out the colours CLAUDE.md -> Greys and tones and Brand colour rule out, where it can see them without types
// or a stylesheet:
// - web, in any string or template (a className, a clsx argument, a class map): raw brand text, icons, outlines,
//   rings and checkbox fills (text-, outline-, accent-, decoration-, ring-, fill- and stroke-primary, and arbitrary
//   forms such as text-[rgb(var(--c-primary))], accent-[var(--color-primary)] and text-(--color-primary); a ring's,
//   fill's or stroke's tint, ring-primary/20, is allowed); white text in a class list that fills with the raw brand,
//   or in a className whose other strings do; a placeholder in slate-300 or slate-400; and an inline colour written as
//   the raw brand variable, quoted or in backticks. In a className only: text-slate-400 under any variant but a
//   disabled one, a placeholder's or an svg child's, unless the element is an icon (Icon*, svg) or it or an element
//   around it is always aria-hidden;
// - phone: placeholderTextColor={colors.faint}; color: colors.faint or color: <anything>.primary in the style written
//   on a Text or TextInput; <anything>.primary as the color of an Icon* or an ActivityIndicator, or the tintColor or
//   colors of a RefreshControl.
// Not checked: StyleSheet entries and style maps on the phone, and on the web text-slate-400 outside a className (a
// class map may be an icon's), since what they colour isn't visible where they're written; nor a colour value held in
// a variable or passed down as a prop. An icon-only control whose class colours only its icon takes a commented
// eslint-disable-next-line saying so.

const messages = {
  faintText: "Grey text is slate-500 or darker: slate-400 is for icons, borders and tag edges (CLAUDE.md -> Greys and tones).",
  rawBrand:
    "Brand text, icons, outlines and checkbox fills use the ink: text-primary-ink (text-page-ink on the page), outline-primary-ink, accent-primary-ink.",
  whiteOnBrand: "Text on the brand colour uses text-on-primary.",
  faintPlaceholder: "Placeholders use the meta grey (placeholder:text-slate-500).",
  faintTextPhone: "Grey text uses colors.muted (Muted on the page); colors.faint is for icons, borders and tag edges.",
  rawBrandPhone: "Brand text and icons use theme.primaryInk (theme.pageInk on the page).",
};

// A class starts a string, follows a space, or follows its variants ("hover:", "[&>svg]:") or an important mark ("!").
const START = String.raw`(?:^|[\s:!])`;
// The brand itself, not --c-primary-ink, --color-primary-edge or the like.
const BRAND_VAR = String.raw`--(?:c|color)-primary(?![-\w])`;
// Text at any opacity is still the raw brand; a ring, a fill or a stroke at an opacity (ring-primary/20) is a tint.
const RAW_BRAND = new RegExp(
  String.raw`${START}(?:(?:text|outline|accent|decoration)-primary(?![-\w])|(?:ring|fill|stroke)-primary(?![-\w/]))`,
);
const RAW_BRAND_ARBITRARY = new RegExp(
  String.raw`${START}(?:(?:text|outline|accent|decoration|ring|fill|stroke)-[[(]|\[(?:color|accent-color|outline-color|text-decoration-color|fill|stroke):)[^\s\]]*?${BRAND_VAR}`,
);
// bg-primary/10 and the like are tints, under which text is dark.
const BRAND_FILL = new RegExp(String.raw`${START}bg-(?:primary(?![-\w/])|[[(][^\s\]]*?${BRAND_VAR})`);
const ANY_FILL = new RegExp(String.raw`${START}bg-`);
const WHITE_TEXT = new RegExp(String.raw`${START}text-white(?![-\w])`);
const FAINT_PLACEHOLDER = /placeholder:text-slate-(?:300|400)(?![-\w])/;
// The class with its variants ("hover:", "sm:", "aria-[current=page]:"), each read by faintText.
const FAINT_TEXT = /(?:^|\s)(\S*:)?!?text-slate-400(?![-\w])/g;
// A disabled control's (WCAG doesn't hold one to 4.5:1): disabled:, aria-disabled:, group-disabled:, peer-disabled/x:,
// data-disabled:, aria-[disabled=true]:. Not not-disabled:, which is the enabled control.
const DISABLED_VARIANT = /^(?:(?:group|peer)-)?(?:(?:aria|data)-)?(?:disabled|\[disabled(?:=["']?true["']?)?\])(?:\/[\w-]+)?$/;
// A child svg's colour, as in [&>svg]: or [&_svg]:.
const SVG_CHILD_VARIANT = /^\[.*\bsvg\b.*\]$/;
const BRAND_VAR_VALUE = new RegExp(BRAND_VAR);
const INLINE_COLOUR_KEYS = new Set(["color", "accentColor", "outlineColor", "textDecorationColor", "caretColor"]);
const TEXT_ELEMENTS = new Set(["Text", "TextInput"]);

/** A class's variants, split at the colons outside brackets: "aria-[x]:[&:hover]:" -> ["aria-[x]", "[&:hover]"]. */
function variantsOf(prefix) {
  const variants = [];
  let depth = 0;
  let current = "";
  for (const ch of prefix) {
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ":" && depth === 0) {
      variants.push(current.replace(/^!/, ""));
      current = "";
    } else current += ch;
  }
  return variants;
}

/** Whether the classes hold text-slate-400 that colours text: not a disabled control's, a placeholder's or a child svg's. */
function hasFaintText(text) {
  for (const match of text.matchAll(FAINT_TEXT)) {
    const variants = variantsOf(match[1] ?? "");
    if (!variants.some((v) => v === "placeholder" || DISABLED_VARIANT.test(v) || SVG_CHILD_VARIANT.test(v))) return true;
  }
  return false;
}

/** The JSX element's own name: "Text" for Animated.Text. */
function elementName(opening) {
  const name = opening.name;
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return name.property.name;
  if (name.type === "JSXNamespacedName") return name.name.name;
  return "";
}

/** The attribute a value is written in (`className="…"`, `style={[…, { color }]}`), or null outside one. */
function enclosingAttribute(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === "JSXAttribute") return n;
    if (n.type === "JSXElement" || n.type === "JSXFragment") return null;
  }
  return null;
}

function attributeName(attribute) {
  return attribute.name.type === "JSXIdentifier" ? attribute.name.name : null;
}

/** Whether an aria-hidden value is true whatever happens: bare, "true", {true}, or a ternary of those. */
function alwaysTrue(value) {
  if (!value) return true;
  switch (value.type) {
    case "JSXExpressionContainer":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return alwaysTrue(value.expression);
    case "Literal":
      return value.value === true || value.value === "true";
    case "ConditionalExpression":
      return alwaysTrue(value.consequent) && alwaysTrue(value.alternate);
    default:
      return false;
  }
}

/** aria-hidden on the element whatever its state: a condition (aria-hidden={!open}) may show what's inside. */
function isHidden(opening) {
  return opening.attributes.some((a) => a.type === "JSXAttribute" && attributeName(a) === "aria-hidden" && alwaysTrue(a.value));
}

/** Whether text-slate-400 in this string colours text: it's in a className of an element that isn't an icon or hidden. */
function colourText(node) {
  const attribute = enclosingAttribute(node);
  if (!attribute || attributeName(attribute) !== "className") return false;
  const name = elementName(attribute.parent);
  if (/^Icon/.test(name) || name === "svg") return false;
  // From the element itself (its JSXElement) out through every element around it.
  for (let n = attribute.parent.parent; n; n = n.parent) {
    if (n.type === "JSXElement" && isHidden(n.openingElement)) return false;
  }
  return true;
}

/**
 * The values an expression may take: both sides of a ternary, the right of `a && b`, a template and its expressions, an
 * array's items.
 */
function candidates(expression) {
  if (!expression) return [];
  switch (expression.type) {
    case "ConditionalExpression":
      return [...candidates(expression.consequent), ...candidates(expression.alternate)];
    case "LogicalExpression":
      return expression.operator === "&&" ? candidates(expression.right) : [...candidates(expression.left), ...candidates(expression.right)];
    case "TemplateLiteral":
      return [expression, ...expression.expressions.flatMap(candidates)];
    case "ArrayExpression":
      return expression.elements.flatMap(candidates);
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return candidates(expression.expression);
    default:
      return [expression];
  }
}

function isMember(node, object, property) {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === property &&
    (object === null || (node.object.type === "Identifier" && object.includes(node.object.name)))
  );
}

const isFaint = (node) => isMember(node, ["colors", "GREYS"], "faint");
/** theme.primary, t.primary, …: the raw brand, which only fills, borders and tracks take. */
const isRawBrand = (node) => isMember(node, null, "primary");
/** The text of a string or a template (its cooked quasis), or null for anything else. */
const stringText = (node) =>
  node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node.type === "TemplateLiteral"
      ? node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(" ")
      : null;

function propertyName(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Keep faint grey and the raw brand colour out of text, icons, outlines and placeholders." },
    schema: [],
    messages,
  },
  create(context) {
    // Each className's strings, read together when it closes: clsx("bg-primary", on && "text-white") is white on the
    // brand though no one string says so.
    const classNames = new Map();

    function checkClasses(node, text) {
      const found = new Set();
      if (RAW_BRAND.test(text) || RAW_BRAND_ARBITRARY.test(text)) found.add("rawBrand");
      if (BRAND_FILL.test(text) && WHITE_TEXT.test(text)) found.add("whiteOnBrand");
      if (FAINT_PLACEHOLDER.test(text)) found.add("faintPlaceholder");
      if (hasFaintText(text) && colourText(node)) found.add("faintText");
      for (const messageId of found) context.report({ node, messageId });
      const attribute = enclosingAttribute(node);
      if (attribute && attributeName(attribute) === "className") {
        if (!classNames.has(attribute)) classNames.set(attribute, []);
        classNames.get(attribute).push(text);
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") checkClasses(node, node.value);
      },
      // The cooked text, as no-emoji-icons reads it, with the quasis joined so a class list split by an expression
      // still reads as one.
      TemplateLiteral(node) {
        checkClasses(node, stringText(node));
      },
      Property(node) {
        const key = propertyName(node);
        if (!key) return;
        const values = candidates(node.value);
        // Web: style={{ color: "rgb(var(--c-primary))" }}, or in backticks with an opacity.
        if (INLINE_COLOUR_KEYS.has(key) && values.some((v) => BRAND_VAR_VALUE.test(stringText(v) ?? ""))) {
          context.report({ node, messageId: "rawBrand" });
        }
        // Phone: a Text's own style.
        if (key !== "color") return;
        const attribute = enclosingAttribute(node);
        if (!attribute || attributeName(attribute) !== "style" || !TEXT_ELEMENTS.has(elementName(attribute.parent))) return;
        if (values.some(isFaint)) context.report({ node, messageId: "faintTextPhone" });
        if (values.some(isRawBrand)) context.report({ node, messageId: "rawBrandPhone" });
      },
      JSXAttribute(node) {
        if (!node.value || node.value.type !== "JSXExpressionContainer") return;
        const name = attributeName(node);
        const element = elementName(node.parent);
        const values = candidates(node.value.expression);
        if (name === "placeholderTextColor" && values.some(isFaint)) context.report({ node, messageId: "faintTextPhone" });
        // An icon's or a spinner's own colour.
        const drawsInk =
          (name === "color" && (/^Icon/.test(element) || element === "ActivityIndicator")) ||
          ((name === "tintColor" || name === "colors") && element === "RefreshControl");
        if (drawsInk && values.some(isRawBrand)) context.report({ node, messageId: "rawBrandPhone" });
      },
      "JSXAttribute:exit"(node) {
        const texts = classNames.get(node);
        if (!texts) return;
        classNames.delete(node);
        // One string with both is reported on its own; white in a string with a fill of its own is on that fill.
        if (texts.some((t) => BRAND_FILL.test(t) && WHITE_TEXT.test(t))) return;
        if (texts.some((t) => BRAND_FILL.test(t)) && texts.some((t) => WHITE_TEXT.test(t) && !ANY_FILL.test(t))) {
          context.report({ node, messageId: "whiteOnBrand" });
        }
      },
    };
  },
};

/** @type {import("eslint").Linter.Config} */
module.exports = {
  name: "illuminize/readable-colours",
  files: ["src/**/*.{ts,tsx}"],
  plugins: { "illuminize-colours": { rules: { "readable-colours": rule } } },
  rules: { "illuminize-colours/readable-colours": "error" },
};
