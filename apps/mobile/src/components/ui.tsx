import { useEffect, useRef, type ReactNode } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type PressableProps, type ScrollViewInstance, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { initials } from "@/lib/format";
import { colors, radius, spacing, useTheme } from "@/theme";

/**
 * Standard screen container. Pass `topInset` on screens without a navigation header so content clears the status bar
 * and notch. The content moves up with the keyboard on iOS (Android resizes the window itself).
 */
export function Screen({ children, scroll = true, padded = true, topInset = false, style }: { children: ReactNode; scroll?: boolean; padded?: boolean; topInset?: boolean; style?: ViewStyle }) {
  const content = padded ? <View style={[styles.padded, style]}>{children}</View> : <View style={[{ flex: scroll ? undefined : 1 }, style]}>{children}</View>;
  const edges: Edge[] = topInset ? ["top", "left", "right", "bottom"] : ["left", "right", "bottom"];
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ paddingBottom: spacing.xl }}>
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
      <Text style={{ fontSize: 40, textAlign: "center" }}>📡</Text>
      <Text style={[styles.title, { textAlign: "center", fontSize: 18 }]}>{"Couldn't load this"}</Text>
      <ErrorText error={error} />
      {onRetry && <Button title="Try again" onPress={onRetry} />}
      {onBack && <Button title={backLabel} variant="ghost" onPress={onBack} />}
    </SafeAreaView>
  );
}

export function Button({ title, variant = "primary", loading, disabled, style, ...rest }: PressableProps & { title: string; variant?: "primary" | "outline" | "ghost" | "danger"; loading?: boolean; style?: ViewStyle }) {
  const theme = useTheme();
  const bg = variant === "primary" ? theme.primary : variant === "danger" ? colors.danger : "transparent";
  const fg = variant === "primary" || variant === "danger" ? "#fff" : variant === "outline" ? colors.text : theme.primary;
  return (
    <Pressable
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      aria-disabled={!!(disabled || loading)}
      aria-busy={!!loading}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: variant === "outline" ? colors.border : bg, opacity: pressed || disabled || loading ? 0.7 : 1 }, style]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Input({ label, error, hint, style, ...rest }: TextInputProps & { label?: string; error?: string; hint?: string }) {
  return (
    <View style={{ gap: 4 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput placeholderTextColor={colors.faint} accessibilityLabel={rest.accessibilityLabel ?? label ?? rest.placeholder} style={[styles.input, error ? { borderColor: colors.danger } : null, rest.multiline ? { minHeight: 96, textAlignVertical: "top" } : null, style]} {...rest} />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Horizontal chip picker used as a lightweight select on mobile. `tall` makes each chip a full 44-point target. `emptyLabel` names the chip that picks nothing. */
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
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
        {allowEmpty && <Chip label={emptyLabel} active={value === ""} onPress={() => onChange("")} color={theme.primary} tall={tall} />}
        {options.map((o) => (
          <Chip key={o.value} label={o.label} active={value === o.value} onPress={() => onChange(o.value)} color={theme.primary} tall={tall} />
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

/** `tall` makes it a full 44-point target, for a choice that matters, such as a report's reason. */
export function Chip({ label, active, onPress, color, tall = false }: { label: string; active?: boolean; onPress?: () => void; color?: string; tall?: boolean }) {
  const theme = useTheme();
  const c = color ?? theme.primary;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" {...toggleState(!!active)} style={[styles.chip, tall ? styles.chipTall : null, active ? { backgroundColor: c, borderColor: c } : null]}>
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
  if (src) return <Image source={{ uri: src }} accessibilityIgnoresInvertColors accessible={false} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.primarySoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: theme.primary, fontWeight: "700", fontSize: size * 0.36 }}>{initials(name)}</Text>
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

export function EmptyState({ icon, title, description }: { icon?: string; title: string; description?: string }) {
  return (
    <View style={styles.empty}>
      {icon && <Text style={{ fontSize: 32 }}>{icon}</Text>}
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

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Text style={{ color: "#991b1b", fontSize: 13 }}>{msg}</Text>
    </View>
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
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "600" },
  empty: { alignItems: "center", gap: 6, padding: spacing.xl, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, backgroundColor: "#fff" },
  emptyTitle: { fontWeight: "600", color: colors.text, fontSize: 15 },
  errorBox: { backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: radius.md, padding: 10 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: "#1e293b" },
});
