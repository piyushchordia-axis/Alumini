import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Card, EmptyState, LoadError, Muted, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors } from "@/theme";

function Item({ title, meta, onPress }: { title: string; meta: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={{ gap: 2 }}>
      <Text style={{ color: colors.text, fontWeight: "600" }}>{title}</Text>
      <Muted>{meta}</Muted>
    </Pressable>
  );
}

/** "This week": the latest weekly digest. */
export default function DigestScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const q = useQuery({ queryKey: qk.digest(slug), queryFn: () => api.celebrations.digest(slug) });
  if (q.isLoading)
    return (
      <Screen title="This week">
        <Spinner />
      </Screen>
    );
  if (q.error)
    return (
      <Screen title="This week">
        <LoadError error={q.error} onRetry={() => void q.refetch()} onBack={() => router.back()} backLabel="Back" />
      </Screen>
    );
  const d = q.data;
  if (!d) {
    return (
      <Screen title="This week">
        <EmptyState icon="📰" title="No digest yet" description="Every Monday morning we round up the week's popular posts, new jobs and upcoming events." />
      </Screen>
    );
  }
  const when = (iso: string, tz: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
  return (
    <Screen title="This week">
      <Muted size={13}>Week of {new Date(`${d.weekStart}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" })}</Muted>
      {d.posts.length > 0 && (
        <Card>
          <Text style={{ fontWeight: "700", color: colors.text }}>Popular posts</Text>
          {d.posts.map((p) => (
            <Item key={p.id} title={p.excerpt} meta={`${p.authorName} · ${p.reactionCount} reactions · ${p.commentCount} comments`} onPress={() => router.push(`/t/${slug}/feed/${p.id}`)} />
          ))}
        </Card>
      )}
      {d.jobs.length > 0 && (
        <Card>
          <Text style={{ fontWeight: "700", color: colors.text }}>New jobs</Text>
          {d.jobs.map((j) => (
            <Item key={j.id} title={j.title} meta={[j.companyName, j.isRemote ? "Remote" : j.location].filter(Boolean).join(" · ")} onPress={() => router.push(`/t/${slug}/jobs/${j.id}`)} />
          ))}
        </Card>
      )}
      {d.events.length > 0 && (
        <Card>
          <Text style={{ fontWeight: "700", color: colors.text }}>Coming up</Text>
          {d.events.map((e) => (
            <Item key={e.id} title={e.title} meta={`${when(e.startAt, e.timezone)} · ${e.city}`} onPress={() => router.push(`/t/${slug}/events/${e.id}`)} />
          ))}
        </Card>
      )}
      {d.newMembers > 0 && (
        <View>
          <Text style={{ color: colors.text }}>
            👋 {d.newMembers} new member{d.newMembers === 1 ? "" : "s"} joined that week.
          </Text>
        </View>
      )}
    </Screen>
  );
}
