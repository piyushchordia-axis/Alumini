import { inlineText, parseRichText, textDirection, type RichBlock, type RichInline } from "@illuminize/shared";
import { Fragment, useMemo } from "react";
import { I18nManager, Linking, Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { colors, spacing, useTheme } from "@/theme";

/** Members write these links, so they pass no referrer, no opener and no search-engine credit. */
const EXTERNAL_REL = "noopener noreferrer nofollow ugc";

/** A phone with nothing to open the link (no mail app, say) leaves the screen as it was rather than throwing. */
function openLink(href: string) {
  Linking.openURL(href).catch(() => undefined);
}

/**
 * On the web export a link is a real anchor that the browser opens, from the keyboard too; react-native-web only makes an
 * anchor of a Text with `href`, which React Native's types don't know. A mail link opens in place.
 */
function linkProps(href: string): object {
  if (Platform.OS !== "web") return { onPress: () => openLink(href) };
  return { href, hrefAttrs: href.startsWith("mailto:") ? { rel: EXTERNAL_REL } : { target: "_blank", rel: EXTERNAL_REL } };
}

function Inlines({ nodes, linkColor }: { nodes: RichInline[]; linkColor: string }) {
  return nodes.map((node, i) =>
    node.type === "text" ? (
      <Fragment key={i}>{node.text}</Fragment>
    ) : (
      <Text key={i} role="link" style={[styles.link, { color: linkColor }]} {...linkProps(node.href)}>
        {node.text}
      </Text>
    ),
  );
}

/** The web's 24px from the list's edge to its text: a 16px marker column and an 8px gap. */
const MARKER_WIDTH = 16;
/** Room for one more digit, so a numbered list's text stays lined up when it goes from 9 to 10, or 99 to 100. */
const DIGIT_WIDTH = 9;

function List({ block, style, linkColor }: { block: Extract<RichBlock, { type: "list" }>; style: StyleProp<TextStyle>; linkColor: string }) {
  // Like the web's <ul dir="auto">, the whole list reads the way its first letter does: markers on that side, text aligned to it.
  const rtl = textDirection(block.items.map(inlineText).join(" ")) === "rtl";
  // "row" runs right to left when the whole app is laid out that way. react-native-web has no `isRTL`, only the constant.
  const appRtl = I18nManager.getConstants().isRTL === true;
  const row = { flexDirection: rtl === appRtl ? "row" : "row-reverse" } as const;
  const text: TextStyle = { textAlign: rtl ? "right" : "left", writingDirection: rtl ? "rtl" : "ltr" };
  const last = block.start + block.items.length - 1;
  // A number sits against its item's text, on whichever side that is.
  const marker: TextStyle = {
    minWidth: MARKER_WIDTH + (block.ordered ? DIGIT_WIDTH * (String(last).length - 1) : 0),
    textAlign: block.ordered ? (rtl ? "left" : "right") : "center",
  };
  return (
    <View role="list" style={styles.list}>
      {block.items.map((item, i) => (
        <View key={i} role="listitem" style={[styles.item, row]}>
          {block.ordered ? (
            // A screen reader can't tell where a numbered list starts, so the number is read out.
            <Text style={[styles.body, style, styles.number, marker]}>{`${block.start + i}.`}</Text>
          ) : (
            // A bullet says nothing the list doesn't, so it's only for the eye.
            <Text accessible={false} aria-hidden style={[styles.body, style, styles.bullet, marker]}>
              •
            </Text>
          )}
          <Text style={[styles.body, style, styles.itemText, text]}>
            <Inlines nodes={item} linkColor={linkColor} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function Block({ block, style, linkColor }: { block: RichBlock; style: StyleProp<TextStyle>; linkColor: string }) {
  if (block.type === "list") return <List block={block} style={style} linkColor={linkColor} />;
  return (
    <Text style={[styles.body, style]}>
      {block.lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && "\n"}
          <Inlines nodes={line} linkColor={linkColor} />
        </Fragment>
      ))}
    </Text>
  );
}

/**
 * A long description, bio or pitch: paragraphs, bullet and numbered lists, and links, parsed by the shared `parseRichText`.
 * `style` sets the text's size and colour; links take the institution's colour.
 */
export function RichText({ text, style }: { text: string | null | undefined; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  const blocks = useMemo(() => parseRichText(text), [text]);
  if (blocks.length === 0) return null;
  return (
    <View style={styles.root}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} style={style} linkColor={theme.primary} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  // The colour of `Body` (ui.tsx), which these screens used before, and of slate-800 on the web.
  body: { fontSize: 15, lineHeight: 22, color: "#1e293b" },
  // As the web's font-medium.
  link: { fontWeight: "500", textDecorationLine: "underline" },
  list: { gap: spacing.xs },
  item: { gap: spacing.sm },
  // Slate-500 on both apps.
  bullet: { color: colors.muted },
  number: { color: colors.muted, fontVariant: ["tabular-nums"] },
  // Without minWidth a long web address keeps its whole width on the web export instead of wrapping.
  itemText: { flex: 1, minWidth: 0 },
});
