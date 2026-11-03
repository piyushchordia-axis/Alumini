import { MENTOR_AREA_LABELS, MENTOR_AVAILABILITY_LABELS, memberRoleLine, mentorCardLabel, mentorshipStatusLabel, mentorshipWhen, type MentorArea, type MentorCardDto, type MentorshipDto } from "@illuminize/shared";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { RequestRow } from "@/components/connections/RequestRow";
import { Avatar, Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { mentorHref } from "@/lib/mentors";
import { colors, radius, spacing } from "@/theme";

const card = { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border } as const;

/** A mentor's areas, each its own badge, wrapping on a narrow phone. */
export function MentorAreas({ areas }: { areas: MentorArea[] }) {
  return (
    <View role="list" aria-label="Mentor areas" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {areas.map((a) => (
        <View key={a} role="listitem">
          <Badge label={MENTOR_AREA_LABELS[a]} tone="primary" />
        </View>
      ))}
    </View>
  );
}

const batchLine = (m: { batchYear: number; city: string | null }) => `Batch of ${m.batchYear}${m.city ? ` · ${m.city}` : ""}`;

/**
 * One mentor in Find mentors, opening their page. A link's name stands in for everything inside it, so it says the role,
 * batch, areas and availability the card shows, or a screen reader would hear only the name. The web app's card link has
 * the same name.
 */
export function MentorCard({ slug, mentor }: { slug: string; mentor: MentorCardDto }) {
  const router = useRouter();
  const { member } = mentor;
  const role = memberRoleLine(member);
  const availability = `Availability: ${MENTOR_AVAILABILITY_LABELS[mentor.availability]}`;
  return (
    <Pressable
      onPress={() => router.push(mentorHref(slug, member.id))}
      accessibilityRole="link"
      accessibilityLabel={mentorCardLabel(mentor)}
      style={({ pressed }) => [card, { padding: spacing.lg, gap: spacing.sm, backgroundColor: pressed ? colors.bg : colors.card }]}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <Avatar name={member.fullName} src={member.avatarUrl} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>{member.fullName}</Text>
          <Text style={{ fontSize: 13, color: "#475569" }}>{role}</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{batchLine(member)}</Text>
        </View>
      </View>
      <MentorAreas areas={mentor.areas} />
      <Text style={{ fontSize: 12, color: colors.muted }}>{availability}</Text>
    </Pressable>
  );
}

const TONE = { REQUESTED: "warning", ACCEPTED: "success", DECLINED: "neutral", ENDED: "neutral" } as const;

/** One request or mentorship, as one side of it sees it, with whatever this member can do about it in `actions`. */
export function MentorshipRow({ m, onOpenProfile, actions, notice }: { m: MentorshipDto; onOpenProfile?: () => void; actions?: ReactNode; notice?: ReactNode }) {
  return (
    <RequestRow
      member={m.member}
      onOpenProfile={onOpenProfile}
      status={mentorshipStatusLabel(m)}
      // A request waiting for this member's answer stands out; one they're waiting on reads as information.
      tone={m.status === "REQUESTED" && m.box === "sent" ? "info" : TONE[m.status]}
      when={mentorshipWhen(m, (iso) => formatDate(iso))}
      noteLabel={m.box === "received" ? "Their note" : "Your note"}
      note={m.note}
      actions={actions}
      notice={notice}
    />
  );
}
