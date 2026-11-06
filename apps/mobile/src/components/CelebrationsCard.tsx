import { memberYearsLabel, type CelebrationDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { IconCake, IconSpark } from "@/components/icons";
import { Avatar, Button, Card, Muted, Row } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, useTheme } from "@/theme";

const what = (c: CelebrationDto) => (c.kind === "BIRTHDAY" ? "Birthday" : `${c.years} year${c.years === 1 ? "" : "s"} with us`);

/** Today's birthdays and membership anniversaries on the feed, with "Wish". Never shows a birth year or age. */
export function CelebrationsCard({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const theme = useTheme();
  const today = useQuery({ queryKey: qk.celebrations(slug), queryFn: () => api.celebrations.today(slug), staleTime: 5 * 60_000 });
  const wish = useMutation({
    mutationFn: (c: CelebrationDto) => api.celebrations.wish(slug, c.membershipId, c.kind),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.celebrations(slug) }),
    onError: (e) => Alert.alert("Could not send wishes", errorMessage(e)),
  });
  const seen = useMutation({ mutationFn: () => api.notifications.updatePrefs(slug, { celebrationsNoticeSeen: true }), onSuccess: () => void qc.invalidateQueries({ queryKey: qk.celebrations(slug) }) });
  const d = today.data;
  if (!d || (d.items.length === 0 && !d.showNotice)) return null;
  return (
    <Card style={{ paddingVertical: 12 }}>
      {d.items.length > 0 && (
        <View style={{ gap: 8 }}>
          <Row gap={6}>
            <IconSpark size={16} color={theme.primary} />
            <Text style={{ fontWeight: "700", color: colors.text, fontSize: 14 }}>Celebrating today</Text>
          </Row>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {d.items.map((c) => (
              <View key={`${c.membershipId}-${c.kind}`} style={{ width: 220, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 8 }}>
                <Pressable onPress={() => router.push(`/t/${slug}/directory/${c.membershipId}`)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  <Avatar name={c.fullName} src={c.avatarUrl} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "600", fontSize: 13 }} numberOfLines={1}>
                      {c.isMe ? "You" : c.fullName}
                    </Text>
                    <Row gap={4} style={{ flexWrap: "nowrap" }}>
                      {c.kind === "BIRTHDAY" ? <IconCake size={11} color={colors.muted} /> : <IconSpark size={11} color={colors.muted} />}
                      <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>
                        {what(c)} · {memberYearsLabel(c)}
                      </Text>
                    </Row>
                  </View>
                </Pressable>
                {c.isMe ? (
                  <Muted>{c.wishCount ? `${c.wishCount} wish${c.wishCount === 1 ? "" : "es"}` : "Your day"}</Muted>
                ) : c.wishedByMe ? (
                  <Text style={{ color: "#047857", fontSize: 12 }}>Wished</Text>
                ) : (
                  <Button title="Wish" variant="outline" loading={wish.isPending && wish.variables?.membershipId === c.membershipId} onPress={() => wish.mutate(c)} style={{ height: 34, paddingHorizontal: 10 }} />
                )}
              </View>
            ))}
          </ScrollView>
          {d.more > 0 && <Muted>…and {d.more} more today.</Muted>}
        </View>
      )}
      {d.showNotice && (
        <View style={{ gap: 6, borderTopWidth: d.items.length ? 1 : 0, borderTopColor: colors.border, paddingTop: d.items.length ? 8 : 0 }}>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>On your birthday, classmates see it here (day only, never the year).</Text>
          <Row>
            <Pressable onPress={() => seen.mutate()} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: theme.primary, fontWeight: "600" }}>Got it</Text>
            </Pressable>
            <Pressable onPress={() => router.push(`/t/${slug}/profile/edit`)} accessibilityRole="link" hitSlop={8}>
              <Text style={{ color: colors.muted }}>Change in profile</Text>
            </Pressable>
          </Row>
        </View>
      )}
    </Card>
  );
}
