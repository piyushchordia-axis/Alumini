import { CONTROL_TEXT_MAX_SCALE, STATUS_TONES, avatarTone, brandAvatarTone, type ListView, type SkeletonShape, type ToneName } from "@illuminize/shared";
import { cloneElement, useEffect, useEffectEvent, useMemo, useRef, useState, type ComponentRef, type ReactElement, type ReactNode, type Ref } from "react";
import type { Href } from "expo-router";
import { AccessibilityInfo, ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type PressableProps, type RefreshControlProps, type ScrollViewInstance, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { PageBackdrop, PageShell } from "@/components/PageBackdrop";
import { ListSkeleton, type PhoneSkeletonFrame } from "@/components/Skeleton";
import { StackHeader } from "@/components/StackHeader";
import { IconAlert, IconCheck, IconInfo, IconProfile, type IconProps } from "@/components/icons";
import { initials } from "@/lib/format";
import { CHOICE_SIZES } from "@/lib/layout";
import { colors, radius, spacing, useTheme } from "@/theme";

/**
 * Standard screen container. Pass `topInset` on screens without a navigation header so content clears the status bar
 * and notch. Pass `title` on pushed stack screens (profile, settings) to draw an in-tree back bar instead of a native
 * header that can float over content, and `actions` for buttons at its end. The content moves up with the keyboard on
 * both platforms: edge to edge, Android no longer resizes the window for it, and where it still does the overlap
 * measures 0 (as in ChatScreen). `scrollRef` reaches the scroll view, to bring part of a long form into view, and
 * `refreshControl` gives it pull to refresh. `badge` and `fallbackHref` go to the back bar (see StackHeader).
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  topInset = false,
  title,
  actions,
  badge,
  fallbackHref,
  scrollRef,
  refreshControl,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  topInset?: boolean;
  title?: string;
  actions?: ReactNode;
  badge?: string;
  fallbackHref?: Href;
  scrollRef?: Ref<ScrollViewInstance>;
  refreshControl?: ReactElement<RefreshControlProps>;
  style?: ViewStyle;
}) {
  const { page } = useTheme();
  const content = padded ? <View style={[styles.padded, style]}>{children}</View> : <View style={[{ flex: scroll ? undefined : 1 }, style]}>{children}</View>;
  const edges: Edge[] = topInset && title == null ? ["top", "left", "right", "bottom"] : ["left", "right", "bottom"];
  return (
    // The page is the member's background (theme.page): the plain page outside the signed-in app and in the console.
    <PageShell>
      <SafeAreaView style={[styles.screen, { backgroundColor: page.color }]} edges={edges}>
        <PageBackdrop />
        {title != null && <StackHeader title={title} actions={actions} badge={badge} fallbackHref={fallbackHref} />}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
          {scroll ? (
            <ScrollView ref={scrollRef} refreshControl={refreshControl} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ paddingBottom: spacing.xl }}>
              {content}
            </ScrollView>
          ) : (
            content
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </PageShell>
  );
}

/** Full-screen error with a retry and an optional way back (failed institution or membership load, offline). */
export function LoadError({ error, onRetry, onBack, backLabel = "Choose another institution" }: { error: unknown; onRetry?: () => void; onBack?: () => void; backLabel?: string }) {
  return (
    <SafeAreaView style={[styles.screen, { justifyContent: "center", padding: spacing.xl, gap: spacing.md }]}>
      <View style={{ alignItems: "center" }}>
        <IconAlert size={40} color={colors.faint} />
      </View>
      <Text style={[styles.title, { textAlign: "center", fontSize: 18 }]}>{"Couldn't load this"}</Text>
      <ErrorText error={error} />
      {onRetry && <Button title="Try again" onPress={onRetry} />}
      {onBack && <Button title={backLabel} variant="ghost" onPress={onBack} />}
    </SafeAreaView>
  );
}

/**
 * `icon` draws before the title, given the title's colour (an SVG from components/icons). `ref` reaches the pressable, to
 * move focus to it. `size="compact"` is the admin console's denser button, still a 44-point target, for a row's actions.
 */
export function Button({
  title,
  variant = "primary",
  size = "regular",
  loading,
  disabled,
  icon,
  style,
  ref,
  ...rest
}: PressableProps & {
  title: string;
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "regular" | "compact";
  loading?: boolean;
  icon?: (color: string) => ReactNode;
  style?: ViewStyle;
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  const compact = size === "compact";
  const theme = useTheme();
  const bg = variant === "primary" ? theme.primary : variant === "danger" ? colors.danger : "transparent";
  const fg = variant === "primary" ? theme.onPrimary : variant === "danger" ? "#fff" : variant === "outline" ? colors.text : theme.primaryInk;
  return (
    <Pressable
      ref={ref}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      aria-disabled={!!(disabled || loading)}
      aria-busy={!!loading}
      style={({ pressed }) => [styles.button, compact ? styles.buttonCompact : null, icon ? styles.buttonWithIcon : null, { backgroundColor: bg, borderColor: variant === "outline" ? colors.border : bg, opacity: pressed || disabled || loading ? 0.7 : 1 }, style]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon?.(fg)}
          <Text style={[styles.buttonText, compact ? styles.buttonTextCompact : null, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** `ref` reaches the text box, to focus it. */
export function Input({ label, error, hint, style, ref, ...rest }: TextInputProps & { label?: string; error?: string; hint?: string; ref?: Ref<ComponentRef<typeof TextInput>> }) {
  return (
    <View style={{ gap: 4 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.faint}
        accessibilityLabel={rest.accessibilityLabel ?? label ?? rest.placeholder}
        style={[styles.input, error ? { borderColor: colors.danger } : null, rest.multiline ? { minHeight: 96, textAlignVertical: "top" } : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * Horizontal chip picker used as a lightweight select on mobile. `tall` makes each chip a full 44-point target. `emptyLabel`
 * names the chip that picks nothing. The chosen chip is kept in view, so on a narrow phone a choice past the edge (a saved
 * "Executive", say) still shows.
 */
export function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  allowEmpty,
  emptyLabel = "Any",
  tall = false,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T | "";
  onChange: (v: T | "") => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  tall?: boolean;
}) {
  const theme = useTheme();
  const scroller = useRef<ScrollViewInstance>(null);
  // Where each chip is in the row, by its value ("" for the empty one), and the row's width, full width and scroll position.
  const chips = useRef(new Map<string, { x: number; width: number }>());
  const row = useRef({ width: 0, content: 0, x: 0 });
  const chosen = value === "" ? (allowEmpty ? "" : null) : options.some((o) => o.value === value) ? value : null;

  /**
   * Scrolls the row as little as brings the chosen chip fully into view, with a little of the next one showing, and not at
   * all when it's in view already, so the row stays where the member left it. Nothing until the row and the chip are laid
   * out, which each call it again.
   */
  const reveal = (animated: boolean) => {
    const chip = chosen === null ? undefined : chips.current.get(chosen);
    const { width, content, x } = row.current;
    if (!chip || !width) return;
    let to = x;
    if (chip.x < x) to = chip.x - spacing.lg;
    else if (chip.x + chip.width > x + width) to = chip.x + chip.width - width + spacing.lg;
    to = Math.max(0, Math.min(to, content - width));
    if (Math.abs(to - x) < 1) return;
    row.current.x = to;
    scroller.current?.scrollTo({ x: to, animated });
  };
  // A press on a chip at the edge, or a value set from outside (a form filled in, filters cleared).
  const revealChosen = useEffectEvent(() => reveal(true));
  useEffect(() => revealChosen(), [chosen]);
  const measured = (key: string, e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    chips.current.set(key, { x, width });
    // Its first layout, or it moved: options arriving late, or the labels around it changing.
    if (key === chosen) reveal(false);
  };

  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8 }}
        scrollEventThrottle={32}
        onScroll={(e) => {
          row.current.x = e.nativeEvent.contentOffset.x;
        }}
        onLayout={(e) => {
          row.current.width = e.nativeEvent.layout.width;
          reveal(false);
        }}
        onContentSizeChange={(width) => {
          row.current.content = width;
          reveal(false);
        }}
      >
        {allowEmpty && <Chip label={emptyLabel} active={chosen === ""} onPress={() => onChange("")} onLayout={(e) => measured("", e)} color={theme.primary} tall={tall} />}
        {options.map((o) => (
          <Chip key={o.value} label={o.label} active={chosen === o.value} onPress={() => onChange(o.value)} onLayout={(e) => measured(o.value, e)} color={theme.primary} tall={tall} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * On/off state for a toggle button. aria-selected is what React Native maps to accessibilityState on devices, but it
 * isn't valid on role="button" in a browser, so the web build also needs aria-pressed. React Native's types omit it.
 */
export const toggleState = (on: boolean) => ({ "aria-selected": on, "aria-pressed": on }) as { "aria-selected": boolean };

/**
 * Describes a control by the element whose `nativeID` is `id`, in the browser build, which ignores accessibilityHint:
 * pass the same text as the hint, which phones read. React Native's types omit aria-describedby, and phones have no use
 * for it.
 */
export const describedBy = (id: string): Record<never, never> => (Platform.OS === "web" ? { "aria-describedby": id } : {});

/**
 * A heading at `level`. The web build makes it an <h2>, <h3> and so on from aria-level, which React Native's types omit;
 * phones have one heading role and no levels.
 */
export const headingRole = (level: 2 | 3 | 4) => ({ role: "heading", "aria-level": level }) as { role: "heading" };

/** Something focus can be moved to: a view or pressable, such as a Button through its `ref`. */
export type Focusable = ComponentRef<typeof View>;

/** Moves screen-reader focus (and, in the browser build, keyboard focus) to `target`. */
export function focusOn(target: Focusable | null | undefined) {
  if (!target) return;
  if (Platform.OS === "web") (target as unknown as { focus?: () => void }).focus?.();
  else AccessibilityInfo.sendAccessibilityEvent(target, "focus");
}

/**
 * A chip that is pressed to choose it, its state in aria-pressed. Chosen, it is the solid brand colour, as the one choice of
 * a ChipSelect still is. With `check` (Open to, the institution's multiple-choice questions, a report's reason), chosen,
 * it takes the wash, a thin ring and the ink, with a tick before its label, so it isn't told by colour alone, which a pale
 * brand's fill would be, as the web's ToggleChip is.
 *
 * `tall` makes it a full 44-point target, for a choice that matters. `fit` is for a chip in a wrapping row (`flexWrap:
 * "wrap"`): it is never wider than the row, so chips wrap to the next line first, and a label wraps inside its chip (at its
 * spaces, and inside a word only as a last resort) only when the chip alone is wider than the row. The label grows with
 * the system text size up to CONTROL_TEXT_MAX_SCALE.
 */
export function Chip({
  label,
  active,
  onPress,
  color,
  tall = false,
  fit = false,
  check = false,
  onLayout,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
  tall?: boolean;
  fit?: boolean;
  check?: boolean;
  onLayout?: PressableProps["onLayout"];
}) {
  const theme = useTheme();
  const c = color ?? theme.primary;
  const ticked = check && !!active;
  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="button"
      {...toggleState(!!active)}
      style={[
        styles.chip,
        tall ? styles.chipTall : null,
        fit ? { maxWidth: "100%" } : null,
        ticked ? { backgroundColor: theme.primaryWash, borderColor: theme.primaryRing } : active ? { backgroundColor: c, borderColor: c } : null,
      ]}
    >
      {ticked && <IconCheck size={16} color={theme.primaryInk} strokeWidth={2.5} />}
      <Text
        maxFontSizeMultiplier={CONTROL_TEXT_MAX_SCALE}
        style={[styles.chipText, fit ? { flexShrink: 1, minWidth: 0 } : null, ticked ? { color: theme.primaryInk } : active ? { color: theme.onPrimary } : null]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A checkbox's box or a radio's ring, drawn alike in any institution colour: a meta-grey edge (3:1 on white and the page)
 * when clear; chosen, the box filled with the brand's ink holding a white tick, or an ink ring and dot. Disabled, the same
 * at half opacity, as the web's ChoiceInput. Hidden from screen readers: the choice around it says its state.
 */
export function ChoiceMark({ kind, checked, disabled = false, size = 20, style }: { kind: "checkbox" | "radio"; checked: boolean; disabled?: boolean; size?: number; style?: ViewStyle }) {
  const theme = useTheme();
  const mark = theme.primaryInk;
  return (
    <View
      aria-hidden
      style={[
        {
          width: size,
          height: size,
          borderRadius: kind === "checkbox" ? Math.round(size / 4) : size / 2,
          borderWidth: 2,
          borderColor: checked ? mark : colors.muted,
          backgroundColor: kind === "checkbox" && checked ? mark : "transparent",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {checked && (kind === "checkbox" ? <IconCheck size={size - 6} color="#fff" strokeWidth={3} /> : <View style={{ width: size / 2, height: size / 2, borderRadius: size / 4, backgroundColor: mark }} />)}
    </View>
  );
}

/**
 * One choice, as a checkbox or a radio: 44 points tall, its state in aria-checked, which React Native maps on devices and
 * react-native-web emits. `hint` says what choosing it does, for a screen reader, when that's written beside it too; give
 * that text's `nativeID` as `hintId` and the browser build, which ignores the hint, is described by it as well. Chosen,
 * it takes the wash, a thin ring and the ink box, which show it's chosen, and the label stays `colors.text`. Disabled,
 * ticked or not, it is the plain grey tile with a faded box and a meta-grey label, as the web's Choice and Checkbox are.
 * The label grows with the system text size up to CONTROL_TEXT_MAX_SCALE. Its padding, border, box, gap and label size
 * are `CHOICE_SIZES` (lib/layout.ts), which the unit tests size chips from.
 *
 * `fit` sizes it to its label, as a chip in a wrapping row (`flexWrap: "wrap"`), never wider than the row: chips wrap to
 * the next line first, so a label wraps (at its spaces, and inside a word only as a last resort) only when its chip
 * alone is wider than the row.
 */
export function Choice({
  kind,
  label,
  checked,
  disabled = false,
  hint,
  hintId,
  fit = false,
  onPress,
  style,
}: {
  kind: "checkbox" | "radio";
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  hintId?: string;
  fit?: boolean;
  onPress: () => void;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={kind}
      accessibilityLabel={label}
      accessibilityHint={hint}
      {...(hint && hintId ? describedBy(hintId) : {})}
      aria-checked={checked}
      aria-disabled={disabled}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: CHOICE_SIZES.gap,
          minHeight: 44,
          borderWidth: CHOICE_SIZES.border,
          borderRadius: radius.md,
          paddingHorizontal: CHOICE_SIZES.paddingX,
          paddingVertical: spacing.sm,
          borderColor: checked && !disabled ? theme.primaryRing : colors.border,
          backgroundColor: disabled ? colors.bg : checked ? theme.primaryWash : pressed ? colors.bg : colors.card,
        },
        fit ? { maxWidth: "100%" } : null,
        style,
      ]}
    >
      <ChoiceMark kind={kind} checked={checked} disabled={disabled} size={CHOICE_SIZES.mark} />
      {/* Long labels wrap inside their box rather than widening it. A chip's label shrinks rather than grows: with a
          basis of 0, `flex: 1` would fold a chip with no width of its own down to its box. */}
      <Text maxFontSizeMultiplier={CONTROL_TEXT_MAX_SCALE} style={[fit ? { flexShrink: 1, minWidth: 0 } : { flex: 1 }, { fontSize: CHOICE_SIZES.fontSize, color: disabled ? colors.muted : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, tall = false }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; tall?: boolean }) {
  const scroller = useRef<ScrollViewInstance>(null);
  const offsets = useRef(new Map<string, number>());
  const pressed = useRef(false);
  // The chosen tab in view when a link chose it, even one past the edge of a narrow screen. A tab the member pressed is
  // already in view, and the row stays where they left it.
  const reveal = (x: number | undefined) => {
    if (x !== undefined) scroller.current?.scrollTo({ x: Math.max(0, x - spacing.lg), animated: false });
  };
  useEffect(() => {
    if (!pressed.current) reveal(offsets.current.get(value));
    pressed.current = false;
  }, [value]);
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {/* Labels stay on one line: tabs share the width when they fit and scroll sideways when they don't. */}
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        {tabs.map((t) => (
          <Pressable
            key={t.value}
            onPress={() => {
              pressed.current = t.value !== value;
              onChange(t.value);
            }}
            onLayout={(e) => {
              offsets.current.set(t.value, e.nativeEvent.layout.x);
              if (t.value === value) reveal(e.nativeEvent.layout.x);
            }}
            accessibilityRole="tab"
            aria-selected={value === t.value}
            style={[styles.tab, tall ? styles.tabTall : null, value === t.value ? styles.tabActive : null]}
          >
            <Text numberOfLines={1} style={[styles.tabText, value === t.value ? { color: colors.text } : null]}>
              {t.label}
            </Text>
            {t.count !== undefined && (
              <View style={styles.tabCount}>
                <Text style={styles.tabCountText}>{t.count > 99 ? "99+" : t.count}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * `highlight` frames the card in the brand's edge (a pinned post), 3:1 against the white card for any brand. On a
 * member's tinted page it can fall a little under 3:1 against the page outside, so it only adds to words that say the
 * same (the post's Pinned line), never stands for them. `busy` marks a card that can be pressed as being updated (one kept
 * from the search before), which VoiceOver and TalkBack say after its name.
 */
export function Card({ children, style, onPress, accessibilityLabel, highlight = false, busy = false }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; accessibilityLabel?: string; highlight?: boolean; busy?: boolean }) {
  const theme = useTheme();
  const edge = highlight ? { borderColor: theme.primaryEdge } : null;
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} aria-busy={busy || undefined} style={({ pressed }) => [styles.card, edge, pressed ? { opacity: 0.85 } : null, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, edge, style]}>{children}</View>;
}

/**
 * A tag, in one of the shared status tones (STATUS_TONES) or the brand's, as the web draws it: its fill, a 1px edge, which
 * keeps its shape where the fill doesn't show, and its ink. `icon` draws before the label in the ink (an SVG from
 * components/icons); screen readers skip it, as the label says it all.
 */
export function Badge({ label, tone = "neutral", icon }: { label: string; tone?: ToneName | "primary"; icon?: (color: string) => ReactNode }) {
  const theme = useTheme();
  const look = tone === "primary" ? { fill: theme.primarySoft, edge: theme.primaryEdge, ink: theme.primaryInk } : STATUS_TONES[tone];
  return (
    <View style={[styles.badge, icon ? styles.badgeWithIcon : null, { backgroundColor: look.fill, borderColor: look.edge }]}>
      {icon ? (
        <View aria-hidden>{icon(look.ink)}</View>
      ) : null}
      <Text style={[styles.badgeText, { color: look.ink }]}>{label}</Text>
    </View>
  );
}

/**
 * A note in one of two shared tones (STATUS_TONES), never the brand's, as the web draws it: `info` (sky, IconInfo) for
 * something worth knowing before acting, `warning` (amber, IconAlert) for what went wrong or needs waiting for. It isn't
 * live: a warning that appears later is a StatusLine, which screen readers hear. The text is a direct child of the box.
 */
export function Notice({ tone, text, icon }: { tone: "info" | "warning"; text: string; icon?: (color: string) => ReactNode }) {
  const look = STATUS_TONES[tone];
  return (
    <View style={[styles.notice, { backgroundColor: look.fill }]}>
      <View aria-hidden style={{ paddingTop: 1 }}>
        {icon ? icon(look.ink) : tone === "info" ? <IconInfo size={16} color={look.ink} /> : <IconAlert size={16} color={look.ink} />}
      </View>
      <Text style={{ flexShrink: 1, fontSize: 13, color: look.ink }}>{text}</Text>
    </View>
  );
}

/**
 * A photo, or initials in its place, as on the web app. A member's initials pass `toneKey`, their membership id, for a
 * colour of their own (avatarTone) that is the same on every screen; a list of several institutions passes each one's
 * `brandColor`. Otherwise (this institution, a business, a group) they are the brand's ink on its solid tint.
 */
export function Avatar({ name, src, size = 40, toneKey, brandColor }: { name: string; src?: string | null; size?: number; toneKey?: string | null; brandColor?: string | null }) {
  const theme = useTheme();
  // The initials (or, with no name yet, a person icon) show while the photo loads and whenever it won't (deleted,
  // offline). Remembering which src loaded or failed, rather than flags, makes a new photo start over.
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const tone = useMemo(() => (toneKey ? avatarTone(toneKey) : brandColor ? brandAvatarTone(brandColor) : null), [toneKey, brandColor]);
  const photo = src && src !== failed ? src : null;
  const shown = !!photo && loaded === photo;
  const letters = initials(name);
  const ink = tone?.fg ?? theme.primaryInk;
  return (
    // Once the photo is in, the tint goes, so a logo with see-through parts looks as it would on its own.
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: shown ? "transparent" : (tone?.bg ?? theme.primaryTint), alignItems: "center", justifyContent: "center" }}>
      {!shown &&
        (letters ? (
          <Text aria-hidden={!!photo} style={{ color: ink, fontWeight: "700", fontSize: size * 0.36 }}>
            {letters}
          </Text>
        ) : (
          <IconProfile size={Math.round(size * 0.45)} color={ink} />
        ))}
      {photo && (
        <Image
          source={{ uri: photo }}
          onLoad={() => setLoaded(photo)}
          onError={() => setFailed(photo)}
          accessibilityIgnoresInvertColors
          accessible={false}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
        />
      )}
    </View>
  );
}

export function Spinner({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={{ padding: spacing.xl, alignItems: "center", gap: 8 }} accessibilityRole="progressbar" accessibilityLabel={label ?? "Loading"}>
      <ActivityIndicator color={theme.primary} />
      {label && <Text style={styles.hint}>{label}</Text>}
    </View>
  );
}

/**
 * The round badge an empty state or a chat notice draws its icon in, which screen readers skip: the brand's wash, with the
 * icon in its ink, which reads on it at 3:1 whatever colour the institution chose. It sets the icon's size and colour, so
 * `icon` is an SVG from `components/icons.tsx` passed bare, such as `<IconMail />`.
 */
export function EmptyIcon({ icon, size = "regular", style }: { icon: ReactElement<IconProps>; size?: "regular" | "small"; style?: ViewStyle }) {
  const theme = useTheme();
  const side = size === "small" ? 40 : 56;
  return (
    <View aria-hidden style={[{ width: side, height: side, borderRadius: side / 2, backgroundColor: theme.primaryWash, alignItems: "center", justifyContent: "center" }, style]}>
      {cloneElement(icon, { size: side / 2, color: theme.primaryInk })}
    </View>
  );
}

/**
 * What a list or a screen says when it has nothing to show. `icon` is an SVG from `components/icons.tsx`, passed bare
 * (EmptyIcon draws it). `action` holds its ways on, Buttons stacked full width: the main way on first, as primary; a second
 * way, a way back or one that clears a search or a filter may be outline. `inline` is for inside a card or a list: no
 * frame, and a smaller badge. `live` is for search and filter results: screen readers
 * read the title and the description when it appears. The title stays a direct child of the box, which is how the e2e
 * scripts find it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  inline = false,
  live = false,
}: {
  icon?: ReactElement<IconProps>;
  title: string;
  description?: string;
  action?: ReactNode;
  inline?: boolean;
  live?: boolean;
}) {
  const { pageMuted } = useTheme();
  useAnnounced(live ? [title, description].filter(Boolean).join(". ") : "");
  return (
    <View style={inline ? styles.emptyInline : styles.empty} accessibilityLiveRegion={live ? "polite" : undefined}>
      {icon ? <EmptyIcon icon={icon} size={inline ? "small" : "regular"} style={{ marginBottom: inline ? spacing.xs : spacing.sm }} /> : null}
      <Text {...headingRole(3)} style={[styles.emptyTitle, inline ? { fontSize: 15 } : null]}>
        {title}
      </Text>
      {/* Inline, it may sit on the member's background rather than in a box. */}
      {description ? <Text style={[styles.emptyText, inline ? { color: pageMuted } : null]}>{description}</Text> : null}
      {action ? <View style={styles.emptyActions}>{action}</View> : null}
    </View>
  );
}

/**
 * Empty-list slot, on every list: the list's outline (`skeleton`, a shared shape, with `count`, `frame` and `label` where
 * the list's own differ) while its first page loads, the error with a retry, otherwise the given empty state. `view` comes
 * from useInfiniteList (listView), and a list switched off draws nothing; a list that reads its own state passes `loading`.
 * With useInfiniteList's `retry`, the error stays while the retry is on its way (`retrying`), its button busy and keeping
 * focus.
 */
export function ListEmpty({
  view,
  loading = false,
  error,
  onRetry,
  retrying = false,
  skeleton = "row",
  count,
  frame,
  label,
  children,
}: ({ view: ListView; loading?: never } | { loading: boolean; view?: never }) & {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  skeleton?: SkeletonShape;
  count?: number;
  frame?: PhoneSkeletonFrame;
  label?: string;
  children: ReactNode;
}) {
  const state: ListView = view ?? (loading ? "loading" : error ? "error" : "empty");
  if (state === "idle" || state === "rows") return null;
  if (state === "loading") return <ListSkeleton shape={skeleton} count={count} frame={frame} label={label} />;
  if (state === "error")
    return (
      <View style={{ gap: spacing.sm }}>
        <ErrorText error={error} />
        <RetryButton onRetry={onRetry} retrying={retrying} />
      </View>
    );
  return <>{children}</>;
}

/**
 * A list error's retry ("Try again", or `title`). While `retrying` it shows it's busy and ignores presses, but stays
 * enabled: a disabled button drops focus (the web build makes it a disabled `<button>`), which this keeps.
 */
export function RetryButton({ title = "Try again", onRetry, retrying = false }: { title?: string; onRetry: () => void; retrying?: boolean }) {
  return (
    <Button
      title={title}
      variant="outline"
      aria-busy={retrying}
      icon={retrying ? (color) => <ActivityIndicator color={color} /> : undefined}
      style={retrying ? { opacity: 0.7 } : undefined}
      onPress={() => {
        if (!retrying) onRetry();
      }}
    />
  );
}

/**
 * Has screen readers read `message` when it appears or changes. role="alert" does it on the web build only: Android
 * follows a live region (the caller sets `accessibilityLiveRegion`), and iOS has to be told.
 */
function useAnnounced(message: string) {
  useEffect(() => {
    if (message && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}

export function ErrorText({ error }: { error: unknown }) {
  const msg = !error ? "" : error instanceof Error ? error.message : String(error);
  useAnnounced(msg);
  if (!msg) return null;
  return (
    <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion={Platform.OS === "android" ? "polite" : undefined}>
      <Text style={{ color: "#991b1b", fontSize: 13 }}>{msg}</Text>
    </View>
  );
}

/** A field's own error: red text under the control, like Input's, read out when it appears. */
export function FieldError({ error }: { error?: string | null }) {
  useAnnounced(error ?? "");
  if (!error) return null;
  return (
    <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion={Platform.OS === "android" ? "polite" : undefined}>
      {error}
    </Text>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.title}>{children}</Text>
      {sub ? <Text style={styles.hint}>{sub}</Text> : null}
    </View>
  );
}

export function Row({ children, style, gap = spacing.sm }: { children: ReactNode; style?: ViewStyle; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap, flexWrap: "wrap" }, style]}>{children}</View>;
}

/** Grey text, one shade darker (slate-600) on a tint or a background photo (theme.pageMuted), so it reads wherever it sits. */
export function Muted({ children, size = 12 }: { children: ReactNode; size?: number }) {
  const { pageMuted } = useTheme();
  return <Text style={{ color: pageMuted, fontSize: size }}>{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: spacing.lg, gap: spacing.md },
  button: { height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, borderWidth: 1 },
  buttonText: { fontWeight: "600", fontSize: 15 },
  buttonCompact: { height: 44, paddingHorizontal: spacing.md },
  buttonTextCompact: { fontSize: 14 },
  buttonWithIcon: { flexDirection: "row", gap: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: "#334155" },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text },
  error: { color: STATUS_TONES.danger.ink, fontSize: 12 },
  hint: { color: colors.muted, fontSize: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
  chipText: { fontSize: 13, color: colors.text },
  chipTall: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  tabs: { backgroundColor: "#e2e8f0", borderRadius: radius.md, padding: 3, overflow: "hidden" },
  tab: { flexGrow: 1, paddingVertical: 8, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, borderRadius: 9 },
  tabTall: { minHeight: 44 },
  tabActive: { backgroundColor: "#fff" },
  tabText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  tabCount: { backgroundColor: "#cbd5e1", borderRadius: radius.full, paddingHorizontal: 6, minWidth: 18, alignItems: "center" },
  tabCountText: { fontSize: 11, fontWeight: "700", color: colors.text },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  // The edge takes a pixel of the padding, so it doesn't make the tag bigger.
  badge: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.full, alignSelf: "flex-start" },
  badgeWithIcon: { flexDirection: "row", alignItems: "center", gap: 4 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  // The web's text-xs font-medium.
  badgeText: { fontSize: 12, fontWeight: "500" },
  empty: { alignItems: "center", gap: spacing.xs, padding: spacing.xl, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, backgroundColor: "#fff" },
  emptyInline: { alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  emptyTitle: { fontWeight: "700", color: colors.text, fontSize: 16, textAlign: "center" },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center", maxWidth: 320 },
  emptyActions: { width: "100%", maxWidth: 320, gap: spacing.sm, marginTop: spacing.md },
  errorBox: { backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: radius.md, padding: 10 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: "#1e293b" },
});

export { ListSkeleton, SkeletonBox, SkeletonGroup, SkeletonLines } from "@/components/Skeleton";
export { SectionScreen } from "@/components/SectionScreen";
export { StackScreen } from "@/components/StackScreen";
export { StackHeader } from "@/components/StackHeader";
