import type { ReactNode } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type PressableProps, type TextInputProps, type ViewStyle } from "react-native";
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

/** Horizontal chip picker used as a lightweight select on mobile. */
export function ChipSelect<T extends string>({ label, options, value, onChange, allowEmpty }: { label?: string; options: { value: T; label: string }[]; value: T | ""; onChange: (v: T | "") => void; allowEmpty?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {allowEmpty && <Chip label="Any" active={value === ""} onPress={() => onChange("")} color={theme.primary} />}
        {options.map((o) => (
          <Chip key={o.value} label={o.label} active={value === o.value} onPress={() => onChange(o.value)} color={theme.primary} />
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

export function Chip({ label, active, onPress, color }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  const theme = useTheme();
  const c = color ?? theme.primary;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" {...toggleState(!!active)} style={[styles.chip, active ? { backgroundColor: c, borderColor: c } : null]}>
      <Text style={[styles.chipText, active ? { color: "#fff" } : null]}>{label}</Text>
    </Pressable>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {/* Labels stay on one line: tabs share the width when they fit and scroll sideways when they don't. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        {tabs.map((t) => (
          <Pressable key={t.value} onPress={() => onChange(t.value)} accessibilityRole="tab" aria-selected={value === t.value} style={[styles.tab, value === t.value ? styles.tabActive : null]}>
            <Text numberOfLines={1} style={[styles.tabText, value === t.value ? { color: colors.text } : null]}>
              {t.label}
            </Text>
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
  tabs: { backgroundColor: "#e2e8f0", borderRadius: radius.md, padding: 3, overflow: "hidden" },
  tab: { flexGrow: 1, paddingVertical: 8, paddingHorizontal: spacing.md, alignItems: "center", borderRadius: 9 },
  tabActive: { backgroundColor: "#fff" },
  tabText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "600" },
  empty: { alignItems: "center", gap: 6, padding: spacing.xl, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg, backgroundColor: "#fff" },
  emptyTitle: { fontWeight: "600", color: colors.text, fontSize: 15 },
  errorBox: { backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: radius.md, padding: 10 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: "#1e293b" },
});
