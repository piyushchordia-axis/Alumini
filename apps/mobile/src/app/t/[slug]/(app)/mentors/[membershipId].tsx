import { memberRoleLine, mentorAvailabilityText } from "@illuminize/shared";
import { fatalQueryError } from "@illuminize/shared/client";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatHeader, ChatScreen } from "@/components/chat/ChatFrame";
import { MentorAction, useMentor } from "@/components/mentors/MentorAction";
import { MentorAreas } from "@/components/mentors/MentorCards";
import { MentorsOff, MentorUnavailable, useMentorsEnabled } from "@/components/mentors/MentorFrame";
import { Avatar, Button, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { colors, radius, spacing } from "@/theme";

export default function MentorScreen() {
  const enabled = useMentorsEnabled();
  const { membershipId = "" } = useLocalSearchParams<{ membershipId: string }>();
  if (!enabled) return <MentorsOff title="Mentor" />;
  // Keyed, so nothing from one mentor carries into the next.
  return <MentorDetail key={membershipId} id={membershipId} />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text role="heading" style={{ fontSize: 14, fontWeight: "700", color: "#334155" }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A mentor's own page: who they are, what they can help with, when, in their own words, and Request mentorship. */
function MentorDetail({ id }: { id: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useMentor(slug, id);
  // Only an answer, or nothing at all to show: a refetch failing in the background keeps the page.
  const error = fatalQueryError(query);
  if (error) return <MentorUnavailable header="Mentor" error={error} onRetry={() => void query.refetch()} />;
  if (!query.data)
    return (
      <ChatScreen>
        <ChatHeader title="Mentor" />
        <Spinner label="Loading mentor…" />
      </ChatScreen>
    );
  const m = query.data;
  const { member } = m;
  return (
    <ChatScreen>
      <ChatHeader title="Mentor" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl + insets.bottom, gap: spacing.lg }}>
        <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
            <Avatar name={member.fullName} src={member.avatarUrl} size={56} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text role="heading" style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
                {member.fullName}
              </Text>
              <Text style={{ fontSize: 14, color: "#475569" }}>{memberRoleLine(member)}</Text>
              <Text style={{ fontSize: 13, color: colors.muted }}>
                Batch of {member.batchYear}
                {member.city ? ` · ${member.city}` : ""}
              </Text>
            </View>
          </View>
          {tenant.settings.features.directory && (
            // Down into the tabs, which are under this screen, rather than a second set of tabs on top of it.
            <Button title="View full profile" variant="outline" accessibilityRole="link" onPress={() => router.dismissTo(`/t/${slug}/directory/${member.id}`)} />
          )}
          <Section title="Can help with">
            <MentorAreas areas={m.areas} />
          </Section>
          <Section title="Availability">
            <Text style={{ fontSize: 15, color: colors.text }}>{mentorAvailabilityText(m)}</Text>
          </Section>
          {m.note ? (
            <Section title="About their mentoring">
              <Text style={{ fontSize: 15, lineHeight: 22, color: "#1e293b" }}>{m.note}</Text>
            </Section>
          ) : null}
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            <MentorAction slug={slug} mentor={m} />
          </View>
        </View>
      </ScrollView>
    </ChatScreen>
  );
}
