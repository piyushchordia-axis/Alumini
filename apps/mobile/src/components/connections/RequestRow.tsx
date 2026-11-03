import { DELETED_MEMBER_NAME, memberRoleLine, type MemberCardDto } from "@illuminize/shared";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Avatar, Badge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

export type RequestTone = "warning" | "info" | "success" | "neutral";

const card = { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border } as const;

/**
 * One request between two members (a mentorship, a referral), as one side of it sees it: who it's with, what it's about,
 * the note, where it stands and when, whatever this member can do about it in `actions`, and below them what just happened
 * to it in `notice`. The name opens their profile when there's a directory to open it in. A member who has deleted their
 * account shows as such.
 */
export function RequestRow({
  member,
  onOpenProfile,
  status,
  tone,
  when,
  about,
  noteLabel,
  note,
  actions,
  notice,
}: {
  member: MemberCardDto | null;
  onOpenProfile?: () => void;
  status: string;
  tone: RequestTone;
  when: string;
  /** What the request is about, under who it's with. */
  about?: ReactNode;
  noteLabel: string;
  note: string;
  actions?: ReactNode;
  notice?: ReactNode;
}) {
  const name = member?.fullName ?? DELETED_MEMBER_NAME;
  const nameText = (
    <Text role="heading" style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>
      {name}
    </Text>
  );
  return (
    <View style={[card, { padding: spacing.lg, gap: spacing.md }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <Avatar name={name} src={member?.avatarUrl} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {/* The status follows the name, and wraps under it rather than squeezing it. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm, rowGap: 4 }}>
            {onOpenProfile ? (
              // A full 44-point target: the text is shorter, so the box is taller than it, and the status beside it centres on it.
              <Pressable onPress={onOpenProfile} accessibilityRole="link" accessibilityLabel={name} style={{ minHeight: 44, justifyContent: "center" }}>
                {nameText}
              </Pressable>
            ) : (
              nameText
            )}
            <Badge label={status} tone={tone} />
          </View>
          {member && (
            <Text style={{ fontSize: 13, color: "#475569" }}>
              {memberRoleLine(member)} · Batch of {member.batchYear}
            </Text>
          )}
          {about}
          <Text style={{ fontSize: 12, color: colors.muted }}>{when}</Text>
        </View>
      </View>
      <View style={{ backgroundColor: colors.bg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted }}>{noteLabel}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: "#1e293b" }}>{note}</Text>
      </View>
      {actions ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{actions}</View> : null}
      {notice}
    </View>
  );
}
