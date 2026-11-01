import type { CelebrationDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert, Pressable, Text, View } from "react-native";
import { Avatar, Button, Card, Muted, Row } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, useTheme } from "@/theme";

const what = (c: CelebrationDto) => (c.kind === "BIRTHDAY" ? "🎂 Birthday" : `🎉 ${c.years} year${c.years === 1 ? "" : "s"} with us`);

/** Today's birthdays and membership anniversaries on the feed, with "Send wishes". Never shows a year or age. */
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
    <Card>
      {d.items.length > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={{ fontWeight: "700", color: colors.text }}>🎉 Celebrating today</Text>
          {d.items.map((c) => (
            <Row key={`${c.membershipId}-${c.kind}`} gap={10}>
              <Pressable onPress={() => router.push(`/t/${slug}/directory/${c.membershipId}`)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <Avatar name={c.fullName} src={c.avatarUrl} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "600" }} numberOfLines={1}>
                    {c.isMe ? "You" : c.fullName}
                  </Text>
                  <Muted>
                    {what(c)} · batch of {c.batchYear}
                  </Muted>
                </View>
              </Pressable>
              {c.isMe ? (
                <Muted>{c.wishCount ? `${c.wishCount} wish${c.wishCount === 1 ? "" : "es"}` : "Your day!"}</Muted>
              ) : c.wishedByMe ? (
                <Text style={{ color: "#047857", fontSize: 12 }}>Wished ✓</Text>
              ) : (
                <Button title="Send wishes" variant="outline" loading={wish.isPending && wish.variables?.membershipId === c.membershipId} onPress={() => wish.mutate(c)} />
              )}
            </Row>
          ))}
          {d.more > 0 && <Muted>…and {d.more} more celebrating today.</Muted>}
        </View>
      )}
      {d.showNotice && (
        <View style={{ gap: 6, borderTopWidth: d.items.length ? 1 : 0, borderTopColor: colors.border, paddingTop: d.items.length ? 8 : 0 }}>
          <Text style={{ color: colors.text }}>🎂 On your birthday, classmates will see it here (the day only, never the year) so they can send wishes.</Text>
          <Row>
            <Pressable onPress={() => seen.mutate()} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: theme.primary, fontWeight: "600" }}>Got it</Text>
            </Pressable>
            <Pressable onPress={() => router.push(`/t/${slug}/profile/edit`)} accessibilityRole="link" hitSlop={8}>
              <Text style={{ color: colors.muted }}>Change in my profile</Text>
            </Pressable>
          </Row>
        </View>
      )}
    </Card>
  );
}
