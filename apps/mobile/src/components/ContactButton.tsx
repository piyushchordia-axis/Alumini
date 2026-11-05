import type { ReactElement } from "react";
import { Pressable, Text } from "react-native";
import type { IconProps } from "@/components/icons";
import { colors, radius, spacing, useTheme } from "@/theme";

/**
 * One way to get in touch (a website, an email address, a phone number, a job's Apply link): its icon and what it says, a
 * full 44-point target. `label` is its name for a screen reader, such as `Email ${address}`, so the icon is never read.
 * The icon goes before the text unless `iconAfter`, as Apply's external-link arrow does.
 */
export function ContactButton({
  label,
  text,
  Icon,
  primary = false,
  iconAfter = false,
  hint,
  onPress,
}: {
  label: string;
  text: string;
  Icon: (p: IconProps) => ReactElement;
  primary?: boolean;
  iconAfter?: boolean;
  hint?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const fg = primary ? "#fff" : colors.text;
  const icon = <Icon size={18} color={primary ? fg : colors.muted} />;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        minHeight: 46,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: primary ? theme.primary : colors.border,
        backgroundColor: primary ? theme.primary : colors.card,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {!iconAfter && icon}
      <Text style={{ flexShrink: 1, color: fg, fontWeight: "600", fontSize: 15 }}>{text}</Text>
      {iconAfter && icon}
    </Pressable>
  );
}
