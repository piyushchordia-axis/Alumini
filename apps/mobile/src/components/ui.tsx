import { useEffect, useEffectEvent, useRef, useState, type ComponentRef, type ReactNode, type Ref } from "react";
import { AccessibilityInfo, ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type PressableProps, type ScrollViewInstance, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { StackHeader } from "@/components/StackHeader";
import { IconAlert, IconProfile } from "@/components/icons";
import { initials } from "@/lib/format";
import { colors, radius, spacing, useTheme } from "@/theme";

/**
 * Standard screen container. Pass `topInset` on screens without a navigation header so content clears the status bar
 * and notch. Pass `title` on pushed stack screens (profile, settings) to draw an in-tree back bar instead of a native
 * header that can float over content, and `actions` for buttons at its end. The content moves up with the keyboard on
 * iOS (Android resizes the window itself). `scrollRef` reaches the scroll view, to bring part of a long form into view.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  topInset = false,
  title,
  actions,
  scrollRef,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  topInset?: boolean;
  title?: string;
  actions?: ReactNode;
  scrollRef?: Ref<ScrollViewInstance>;
  style?: ViewStyle;
}) {
  const content = padded ? <View style={[styles.padded, style]}>{children}</View> : <View style={[{ flex: scroll ? undefined : 1 }, style]}>{children}</View>;
  const edges: Edge[] = topInset && title == null ? ["top", "left", "right", "bottom"] : ["left", "right", "bottom"];
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {title != null && <StackHeader title={title} actions={actions} />}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {scroll ? (
          <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ paddingBottom: spacing.xl }}>
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
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

/** `icon` draws before the title, given the title's colour (an SVG from components/icons). `ref` reaches the pressable, to move focus to it. */
export function Button({
  title,
  variant = "primary",
  loading,
  disabled,
  icon,
  style,
  ref,
  ...rest
}: PressableProps & {
  title: string;
  variant?: "primary" | "outline" | "ghost" | "danger";
  loading?: boolean;
  icon?: (color: string) => ReactNode;
  style?: ViewStyle;
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  const theme = useTheme();
  const bg = variant === "primary" ? theme.primary : variant === "danger" ? colors.danger : "transparent";
  const fg = variant === "primary" || variant === "danger" ? "#fff" : variant === "outline" ? colors.text : theme.primary;
  return (
    <Pressable
      ref={ref}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      aria-disabled={!!(disabled || loading)}
      aria-busy={!!loading}
      style={({ pressed }) => [styles.button, icon ? styles.buttonWithIcon : null, { backgroundColor: bg, borderColor: variant === "outline" ? colors.border : bg, opacity: pressed || disabled || loading ? 0.7 : 1 }, style]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon?.(fg)}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
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

/** `tall` makes it a full 44-point target, for a choice that matters, such as a report's reason. */
export function Chip({ label, active, onPress, color, tall = false, onLayout }: { label: string; active?: boolean; onPress?: () => void; color?: string; tall?: boolean; onLayout?: PressableProps["onLayout"] }) {
  const theme = useTheme();
  const c = color ?? theme.primary;
  return (
    <Pressable onPress={onPress} onLayout={onLayout} accessibilityRole="button" {...toggleState(!!active)} style={[styles.chip, tall ? styles.chipTall : null, active ? { backgroundColor: c, borderColor: c } : null]}>
      <Text style={[styles.chipText, active ? { color: "#fff" } : null]}>{label}</Text>
    </Pressable>
  );
}

/**
 * One choice, as a checkbox or a radio: 44 points tall, its state in aria-checked, which React Native maps on devices and
 * react-native-web emits. `hint` says what choosing it does, for a screen reader, when that's written beside it too.
 */
export function Choice({
  kind,
  label,
  checked,
  disabled = false,
  hint,
  onPress,
  style,
}: {
  kind: "checkbox" | "radio";
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
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
      aria-checked={checked}
      aria-disabled={disabled}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: 44,
          borderWidth: 1,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderColor: checked ? theme.primary : colors.border,
          backgroundColor: disabled ? colors.bg : checked ? theme.primarySoft : pressed ? colors.bg : colors.card,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: kind === "checkbox" ? 5 : 10,
          borderWidth: 2,
          borderColor: checked ? theme.primary : disabled ? colors.border : colors.faint,
          backgroundColor: kind === "checkbox" && checked ? theme.primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && (kind === "checkbox" ? <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>✓</Text> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.primary }} />)}
      </View>
      {/* Long labels wrap inside their box rather than widening it. */}
      <Text style={{ flex: 1, fontSize: 14, color: disabled ? colors.faint : colors.text }}>{label}</Text>
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

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; accessibilityLabel?: string }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [styles.card, pressed ? { opacity: 0.85 } : null, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" | "primary" }) {
  const theme = useTheme();
  const map = {
    neutral: { bg: "#f1f5f9", fg: "#334155" },
    success: { bg: "#d1fae5", fg: "#065f46" },
    warning: { bg: "#fef3c7", fg: "#92400e" },
    danger: { bg: "#fee2e2", fg: "#991b1b" },
    info: { bg: "#e0f2fe", fg: "#075985" },
    primary: { bg: theme.primarySoft, fg: theme.primary },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <Text style={[styles.badgeText, { color: map.fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  const theme = useTheme();
  // The initials (or, with no name yet, a person icon) show while the photo loads and whenever it won't (deleted,
  // offline). Remembering which src loaded or failed, rather than flags, makes a new photo start over.
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const photo = src && src !== failed ? src : null;
  const shown = !!photo && loaded === photo;
  const letters = initials(name);
  return (
    // Once the photo is in, the tint goes, so a logo with see-through parts looks as it would on its own.
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: shown ? "transparent" : theme.primarySoft, alignItems: "center", justifyContent: "center" }}>
      {!shown &&
        (letters ? (
          <Text aria-hidden={!!photo} style={{ color: theme.primary, fontWeight: "700", fontSize: size * 0.36 }}>
            {letters}
          </Text>
        ) : (
          <IconProfile size={Math.round(size * 0.45)} color={theme.primary} />
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

/** `icon` is an SVG icon from `components/icons.tsx`; a string is drawn as text, as older screens still pass emoji. */
export function EmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) {
  return (
    <View style={styles.empty}>
      {typeof icon === "string" ? <Text style={{ fontSize: 32 }}>{icon}</Text> : icon}
      <Text style={styles.emptyTitle}>{title}</Text>
      {description && <Text style={styles.hint}>{description}</Text>}
    </View>
  );
}

/** Empty-list slot: spinner while loading, the error with a retry, otherwise the given empty state. */
export function ListEmpty({ loading, error, onRetry, children }: { loading: boolean; error: unknown; onRetry: () => void; children: ReactNode }) {
  if (loading) return <Spinner />;
  if (error)
    return (
      <View style={{ gap: spacing.sm }}>
        <ErrorText error={error} />
        <Button title="Try again" variant="outline" onPress={onRetry} />
      </View>
    );
  return <>{children}</>;
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

export function Muted({ children, size = 12 }: { children: ReactNode; size?: number }) {
  return <Text style={{ color: colors.muted, fontSize: size }}>{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: spacing.lg, gap: spacing.md },
  button: { height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, borderWidth: 1 },
  buttonText: { fontWeight: "600", fontSize: 15 },
  buttonWithIcon: { flexDirection: "row", gap: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: "#334155" },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text },
  error: { color: colors.danger, fontSize: 12 },
  hint: { color: colors.muted, fontSize: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
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
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "600" },
  empty: { alignItems: "center", gap: 6, padding: spacing.xl, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, backgroundColor: "#fff" },
  emptyTitle: { fontWeight: "600", color: colors.text, fontSize: 15 },
  errorBox: { backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: radius.md, padding: 10 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: "#1e293b" },
});

export { SectionScreen } from "@/components/SectionScreen";
export { StackScreen } from "@/components/StackScreen";
export { StackHeader } from "@/components/StackHeader";
