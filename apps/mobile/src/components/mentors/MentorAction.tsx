import { mentorshipKeys, type MentorDto } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { chatHref, mentorRequestHref, mentorsHref } from "@/lib/mentors";
import { colors, spacing } from "@/theme";

/** One mentor's page, shared with the request form, which needs the same mentor and whether they've been asked already. */
export function useMentor(slug: string, membershipId: string) {
  return useQuery({ queryKey: mentorshipKeys.mentor(slug, membershipId), queryFn: () => api.mentorship.mentor(slug, membershipId) });
}

const firstName = (fullName: string) => fullName.split(/\s+/)[0] ?? fullName;
const said = { fontSize: 14, color: colors.muted } as const;

/**
 * What this member can do about this mentor: ask, see where their request stands, or open the chat it led to. The Mentors
 * tabs are under this screen, so going to one of them goes back down to it rather than stacking a second copy.
 */
export function MentorAction({ slug, mentor }: { slug: string; mentor: MentorDto }) {
  const router = useRouter();
  const name = mentor.member.fullName;
  if (mentor.isMe)
    return (
      <View style={{ gap: spacing.sm }}>
        <Text style={said}>This is how members see your mentor profile.</Text>
        <Button title="Edit mentor profile" variant="outline" accessibilityRole="link" onPress={() => router.dismissTo(mentorsHref(slug, "be-a-mentor"))} />
      </View>
    );
  const mine = mentor.myRequest;
  if (mine?.status === "ACCEPTED")
    return (
      <View style={{ gap: spacing.sm }}>
        <Text style={said}>{firstName(name)} is your mentor.</Text>
        {mine.conversationId && <Button title="Open chat" accessibilityRole="link" onPress={() => router.push(chatHref(slug, mine.conversationId!))} />}
      </View>
    );
  if (mine)
    return (
      <View style={{ gap: spacing.sm }}>
        <Text style={said}>{`You've asked ${firstName(name)} to mentor you. Their answer will show in Requests.`}</Text>
        <Button title="See your request" variant="outline" accessibilityRole="link" onPress={() => router.dismissTo(mentorsHref(slug, "requests", "sent"))} />
      </View>
    );
  return <Button title="Request mentorship" accessibilityRole="link" onPress={() => router.push(mentorRequestHref(slug, mentor.member.id))} />;
}
