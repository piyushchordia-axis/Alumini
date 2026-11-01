import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, Text } from "react-native";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, useTheme } from "@/theme";

const WEEK_MS = 7 * 86_400_000;

/** A link to this week's digest at the top of the feed, for a week after it is made. */
export function DigestBanner({ slug }: { slug: string }) {
  const router = useRouter();
  const theme = useTheme();
  const q = useQuery({ queryKey: qk.digest(slug), queryFn: () => api.celebrations.digest(slug), staleTime: 10 * 60_000 });
  const d = q.data;
  if (!d || q.dataUpdatedAt - new Date(d.createdAt).getTime() > WEEK_MS) return null;
  const parts = [d.posts.length && `${d.posts.length} posts`, d.jobs.length && `${d.jobs.length} jobs`, d.events.length && `${d.events.length} events`].filter(Boolean);
  return (
    <Pressable
      onPress={() => router.push(`/t/${slug}/feed/digest`)}
      accessibilityRole="link"
      style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}
    >
      <Text>📰</Text>
      <Text style={{ flex: 1, color: colors.text }}>
        <Text style={{ fontWeight: "700" }}>This week</Text>
        <Text style={{ color: colors.muted }}> · {parts.join(", ")}</Text>
      </Text>
      <Text style={{ color: theme.primary, fontWeight: "600" }}>Read →</Text>
    </Pressable>
  );
}
