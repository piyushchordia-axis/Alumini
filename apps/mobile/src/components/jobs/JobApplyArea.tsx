import { applicationsClosed, applicationsLine, type JobDto } from "@illuminize/shared";
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { IconEvents, IconExternalLink, IconMail, IconPhone, type IconProps } from "@/components/icons";
import { openLink } from "@/components/RichText";
import { colors, radius, spacing, useTheme } from "@/theme";

/** One way to apply: its icon and what it says, a full 44-point target. `label` is its name for a screen reader. */
function ApplyButton({ label, text, Icon, primary = false, hint, onPress }: { label: string; text: string; Icon: (p: IconProps) => ReactElement; primary?: boolean; hint?: string; onPress: () => void }) {
  const theme = useTheme();
  const fg = primary ? "#fff" : colors.text;
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
      {!primary && <Icon size={18} color={colors.muted} />}
      <Text style={{ flexShrink: 1, color: fg, fontWeight: "600", fontSize: 15 }}>{text}</Text>
      {primary && <Icon size={18} color={fg} />}
    </Pressable>
  );
}

/**
 * How to apply for a job: Apply (its link), its email and its phone, as on the web app. Once the job stops taking
 * applications they go, for everyone, and the line saying so takes their place; the API already keeps them from other
 * members by then.
 */
export function JobApplyArea({ job, now }: { job: JobDto; now: number }) {
  if (applicationsClosed(job, now)) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, backgroundColor: "#f1f5f9", paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
        <IconEvents size={16} color={colors.muted} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: "#334155" }}>{applicationsLine(job, now)}</Text>
      </View>
    );
  }
  if (!job.applyUrl && !job.contactEmail && !job.contactPhone) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {job.applyUrl && <ApplyButton primary label="Apply" text="Apply" Icon={IconExternalLink} hint="Opens the application in your browser" onPress={() => openLink(job.applyUrl!)} />}
      {job.contactEmail && <ApplyButton label={`Email ${job.contactEmail}`} text={job.contactEmail} Icon={IconMail} onPress={() => openLink(`mailto:${job.contactEmail}`)} />}
      {job.contactPhone && <ApplyButton label={`Call ${job.contactPhone}`} text={job.contactPhone} Icon={IconPhone} onPress={() => openLink(`tel:${job.contactPhone}`)} />}
    </View>
  );
}
