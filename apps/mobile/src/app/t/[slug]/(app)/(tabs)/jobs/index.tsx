import { CAN_REFER_BADGE, JOB_TYPES, JOB_TYPE_LABELS, JOBS_TAB_LABELS, JOBS_TABS, jobsTabFrom, plainExcerpt, referralBoxFrom, type JobDto, type JobSeekerDto, type JobsTab, type JobType, type ReferralBox } from "@illuminize/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { StatusLine } from "@/components/chat/ChatFrame";
import { ReferralRequests, ReferralsWayOut } from "@/components/jobs/ReferralRequests";
import { useReferralList } from "@/components/jobs/ReferralRows";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge } from "@/components/ModerationBadge";
import { Badge, Button, Card, ChipSelect, Choice, EmptyState, Input, ListEmpty, Muted, Row, SectionScreen, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useGroupNotice } from "@/lib/groups";
import { qk } from "@/lib/queryKeys";
import { jobHref, useReferralsAvailable, useReferralsWayOut } from "@/lib/referrals";
import { colors, spacing, useTheme } from "@/theme";

function JobCard({ slug, job }: { slug: string; job: JobDto }) {
  const router = useRouter();
  return (
    <Card onPress={() => router.push(jobHref(slug, job.id))}>
      {/* The badges have a line of their own, so a long title keeps the width. */}
      <Text style={{ fontWeight: "700", color: colors.text }} numberOfLines={2}>
        {job.title}
      </Text>
      <Row gap={6}>
        <Badge label={JOB_TYPE_LABELS[job.jobType]} tone="info" />
        {/* A closed job takes no requests, whatever its poster offered. */}
        {job.canRefer && !job.isClosed && <Badge label={CAN_REFER_BADGE} tone="success" />}
        {job.isClosed && <Badge label="Closed" />}
        <ModerationBadge status={job.moderationStatus} />
      </Row>
      <Muted size={13}>
        {job.companyName}
        {job.location ? ` · ${job.location}` : ""}
        {job.isRemote ? " · Remote" : ""}
      </Muted>
      <Text numberOfLines={2} style={{ color: "#475569" }}>
        {plainExcerpt(job.description, 200)}
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

/** The tab and, on Referrals, the list, kept in the URL as on the web app, so a referral push opens the right one. */
function useJobsParams() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; box?: string }>();
  const tab = jobsTabFrom(params.tab);
  const box = referralBoxFrom(params.box);
  // Openings is the default tab, as Received is the default list, and neither needs a parameter.
  const go = (next: JobsTab, nextBox: ReferralBox = "received") => router.setParams({ tab: next === "openings" ? undefined : next, box: next === "referrals" && nextBox === "sent" ? "sent" : undefined });
  return { tab, box, go };
}

/** Jobs: openings, members looking for work, and referral requests both ways. The tab is in the URL, as on Mentors. */
export default function JobsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const theme = useTheme();
  const { tab, box, go } = useJobsParams();
  const available = useReferralsAvailable();
  const wayOut = useReferralsWayOut();
  // Referrals says how many requests wait for this member's answer, from the received list itself, which its tab then shows at once.
  const received = useReferralList(slug, "received", available);
  const waiting = available ? (received.first?.waiting ?? 0) : (wayOut?.received ?? 0);
  // Shown while the member can use referrals, and otherwise while they still have requests to withdraw or answer. A link
  // straight to it (a notification, say) opens it either way, and it says what's left there.
  const showReferrals = available || tab === "referrals" || (!!wayOut && wayOut.received + wayOut.sent > 0);
  const [q, setQ] = useState("");
  const [jobType, setJobType] = useState<JobType | "">("");
  const [canRefer, setCanRefer] = useState(false);
  const filters = { q: q || undefined, jobType: jobType || undefined, canRefer: (available && canRefer) || undefined };
  const jobs = useInfiniteList(qk.jobs(slug, filters), (cursor) => api.jobs.list(slug, { ...filters, cursor, limit: 20 }), tab === "openings");
  const seekers = useInfiniteList(qk.seekers(slug), (cursor) => api.jobs.seekers.list(slug, { cursor, limit: 20 }), tab === "seekers");
  const [status, setStatus] = useStatus();
  // Such as "Request sent", from the request form, which has gone.
  useGroupNotice("jobs", setStatus);

  return (
    <SectionScreen>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm }}>
        <Tabs
          tall
          value={tab}
          onChange={(next) => go(next, box)}
          tabs={JOBS_TABS.filter((t) => t !== "referrals" || showReferrals).map((t) => ({ value: t, label: JOBS_TAB_LABELS[t], ...(t === "referrals" && waiting > 0 ? { count: waiting } : {}) }))}
        />
      </View>
      <StatusLine text={status} />
      <View role="tabpanel" aria-label={JOBS_TAB_LABELS[tab]} style={{ flex: 1 }}>
        {tab === "openings" ? (
          <>
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
              {/* Off, so the web build's browser doesn't keep what's typed here for session restore. */}
              <Input accessibilityLabel="Search jobs" placeholder="Search title or company" value={q} onChangeText={setQ} autoCorrect={false} autoComplete="off" />
            </View>
            <FlatList
              data={jobs.items}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 96 }}
              keyboardShouldPersistTaps="handled"
              onEndReached={jobs.loadMore}
              refreshing={jobs.isRefetching && !jobs.isFetchingNextPage}
              onRefresh={() => void jobs.refetch()}
              // With the list, so the filters scroll out of the way of the jobs they found.
              ListHeaderComponent={
                <View style={{ gap: spacing.sm }}>
                  <ChipSelect options={JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t] }))} value={jobType} onChange={setJobType} allowEmpty />
                  {available && <Choice kind="checkbox" label={CAN_REFER_BADGE} checked={canRefer} onPress={() => setCanRefer(!canRefer)} />}
                </View>
              }
              ListEmptyComponent={
                <ListEmpty loading={jobs.isLoading} error={jobs.error} onRetry={() => void jobs.refetch()}>
                  {filters.canRefer ? (
                    <EmptyState icon="🤝" title="No openings can refer right now" description="When a poster offers to refer people for a job, it shows here." />
                  ) : (
                    <EmptyState icon="💼" title="No openings right now" description="Know of a role? Post it for your batchmates." />
                  )}
                </ListEmpty>
              }
              renderItem={({ item }) => <JobCard slug={slug} job={item} />}
            />
            <Pressable
              onPress={() => router.push(`/t/${slug}/jobs/new`)}
              accessibilityRole="button"
              accessibilityLabel="Post a job"
              style={{ position: "absolute", right: 20, bottom: 24, backgroundColor: theme.primary, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", elevation: 4 }}
            >
              <Text style={{ color: "#fff", fontSize: 28, lineHeight: 30 }}>+</Text>
            </Pressable>
          </>
        ) : tab === "seekers" ? (
          <>
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
              <Button title="I'm looking for work / update my status" variant="outline" onPress={() => router.push(`/t/${slug}/jobs/seeker`)} />
            </View>
            <FlatList
              data={seekers.items}
              keyExtractor={(item) => item.member.id}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 96 }}
              onEndReached={seekers.loadMore}
              refreshing={seekers.isRefetching && !seekers.isFetchingNextPage}
              onRefresh={() => void seekers.refetch()}
              ListEmptyComponent={
                <ListEmpty loading={seekers.isLoading} error={seekers.error} onRetry={() => void seekers.refetch()}>
                  <EmptyState icon="🙋" title="Nobody is looking right now" />
                </ListEmpty>
              }
              renderItem={({ item }) => <SeekerCard slug={slug} seeker={item} />}
            />
          </>
        ) : available ? (
          <ReferralRequests
            slug={slug}
            box={box}
            onBoxChange={(next) => go("referrals", next)}
            limited={false}
            onBrowse={() => {
              setCanRefer(true);
              go("openings");
            }}
          />
        ) : (
          <ReferralsWayOut slug={slug} box={box} onBoxChange={(next) => go("referrals", next)} onBack={() => go("openings")} />
        )}
      </View>
    </SectionScreen>
  );
}
