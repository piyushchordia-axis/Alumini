import { JOB_TYPES, JOB_TYPE_LABELS, type JobDto, type JobSeekerDto, type JobType } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge } from "@/components/ModerationBadge";
import { Badge, Button, Card, ChipSelect, EmptyState, Input, Muted, Row, Spinner, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

function JobCard({ slug, job }: { slug: string; job: JobDto }) {
  const router = useRouter();
  return (
    <Card onPress={() => router.push(`/t/${slug}/jobs/${job.id}`)}>
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={{ fontWeight: "700", color: colors.text, flex: 1 }} numberOfLines={1}>
          {job.title}
        </Text>
        <Badge label={JOB_TYPE_LABELS[job.jobType]} tone="info" />
        {job.isClosed && <Badge label="Closed" />}
        <ModerationBadge status={job.moderationStatus} />
      </Row>
      <Muted size={13}>
        {job.companyName}
        {job.location ? ` · ${job.location}` : ""}
        {job.isRemote ? " · Remote" : ""}
      </Muted>
      <Text numberOfLines={2} style={{ color: "#475569" }}>
        {job.description}
      </Text>
      <Muted>
        {job.author.fullName} · {timeAgo(job.createdAt)}
        {job.salaryRange ? ` · ${job.salaryRange}` : ""}
      </Muted>
    </Card>
  );
}

function SeekerCard({ slug, seeker }: { slug: string; seeker: JobSeekerDto }) {
  return (
    <Card>
      <MemberRow slug={slug} member={seeker.member} />
      <Text style={{ color: "#1e293b" }}>{seeker.note}</Text>
      {seeker.preferredRoles && <Muted>Roles: {seeker.preferredRoles}</Muted>}
      {seeker.preferredLocations && <Muted>Locations: {seeker.preferredLocations}</Muted>}
    </Card>
  );
}

export default function JobsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const theme = useTheme();
  const [tab, setTab] = useState<"openings" | "seekers">("openings");
  const [q, setQ] = useState("");
  const [jobType, setJobType] = useState<JobType | "">("");
  const filters = { q: q || undefined, jobType: jobType || undefined };
  const jobs = useInfiniteList(qk.jobs(slug, filters), (cursor) => api.jobs.list(slug, { ...filters, cursor, limit: 20 }), tab === "openings");
  const seekers = useInfiniteList(qk.seekers(slug), (cursor) => api.jobs.seekers.list(slug, { cursor, limit: 20 }), tab === "seekers");
  const active = tab === "openings" ? jobs : seekers;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "openings", label: "Openings" }, { value: "seekers", label: "Looking for work" }]} />
        {tab === "openings" ? (
          <>
            <Input placeholder="Search title or company" value={q} onChangeText={setQ} />
            <ChipSelect options={JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t] }))} value={jobType} onChange={setJobType} allowEmpty />
          </>
        ) : (
          <Button title="I'm looking for work / update my status" variant="outline" onPress={() => router.push(`/t/${slug}/jobs/seeker`)} />
        )}
      </View>
      <FlatList
        data={active.items as (JobDto | JobSeekerDto)[]}
        keyExtractor={(item) => ("id" in item ? item.id : item.member.id)}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 96 }}
        onEndReached={active.loadMore}
        refreshing={active.isRefetching && !active.isFetchingNextPage}
        onRefresh={() => void active.refetch()}
        ListEmptyComponent={active.isLoading ? <Spinner /> : <EmptyState icon={tab === "openings" ? "💼" : "🙋"} title={tab === "openings" ? "No openings right now" : "Nobody is looking right now"} />}
        renderItem={({ item }) => ("id" in item ? <JobCard slug={slug} job={item} /> : <SeekerCard slug={slug} seeker={item} />)}
      />
      {tab === "openings" && (
        <Pressable onPress={() => router.push(`/t/${slug}/jobs/new`)} style={{ position: "absolute", right: 20, bottom: 24, backgroundColor: theme.primary, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", elevation: 4 }}>
          <Text style={{ color: "#fff", fontSize: 28, lineHeight: 30 }}>+</Text>
        </Pressable>
      )}
    </View>
  );
}
