import {
  CAN_REFER_BADGE,
  JOB_EXPERIENCE_MAX_YEARS,
  JOB_SENIORITIES,
  JOB_SENIORITY_LABELS,
  JOB_TYPES,
  JOB_TYPE_LABELS,
  JOBS_TAB_LABELS,
  JOBS_TABS,
  SEEKERS_EMPTY,
  WORK_MODES,
  WORK_MODE_LABELS,
  jobsEmpty,
  jobsTabFrom,
  onlyFiltersChanged,
  referralBoxFrom,
  type JobSeekerDto,
  type JobSeniority,
  type JobsTab,
  type JobType,
  type ReferralBox,
  type WorkMode,
} from "@illuminize/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { StatusLine } from "@/components/chat/ChatFrame";
import { IconJobs, IconProfile, IconSearch } from "@/components/icons";
import { JobCard } from "@/components/jobs/JobCard";
import { ReferralRequests, ReferralsWayOut } from "@/components/jobs/ReferralRequests";
import { useReferralList } from "@/components/jobs/ReferralRows";
import { MemberRow } from "@/components/MemberRow";
import { Button, Card, ChipSelect, Choice, EmptyState, Input, ListEmpty, Muted, Row, SectionScreen, Tabs } from "@/components/ui";
import { KEPT_ROW, UpdatingNote } from "@/components/UpdatingNote";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { usePrefetchDirectoryAfter } from "@/lib/directory";
import { moveFocus } from "@/lib/focus";
import { useGroupNotice } from "@/lib/groups";
import { qk } from "@/lib/queryKeys";
import { useReferralsAvailable, useReferralsWayOut } from "@/lib/referrals";
import { spacing, useTheme } from "@/theme";

function SeekerCard({ slug, seeker }: { slug: string; seeker: JobSeekerDto }) {
  return (
    <Card>
      <MemberRow slug={slug} member={seeker.member} meta={seeker.member.headline ?? [seeker.member.designation, seeker.member.companyName].filter(Boolean).join(" · ")} />
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
  const member = useMembership();
  const { tenant } = member;
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
  // A moment after the typing stops, so a search that finds nothing is read out once, not at every letter.
  const search = useDebounced(q.trim());
  const [jobType, setJobType] = useState<JobType | "">("");
  const [canRefer, setCanRefer] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [workMode, setWorkMode] = useState<WorkMode | "">("");
  const [seniority, setSeniority] = useState<JobSeniority | "">("");
  const [experience, setExperience] = useState("");
  // Whole years in range, or no filter: the API refuses anything else, and a half-typed box shouldn't empty the list.
  const years = /^\d{1,2}$/.test(experience.trim()) && Number(experience) <= JOB_EXPERIENCE_MAX_YEARS ? Number(experience) : undefined;
  const filters = {
    q: search || undefined,
    jobType: jobType || undefined,
    workMode: workMode || undefined,
    seniority: seniority || undefined,
    experience: years,
    canRefer: (available && canRefer) || undefined,
  };
  const moreActive = [workMode, seniority, years !== undefined].filter(Boolean).length;
  const filtersToggle = useRef<ComponentRef<typeof View>>(null);
  const searchBox = useRef<ComponentRef<typeof TextInput>>(null);
  const empty = jobsEmpty(member, { canRefer: !!filters.canRefer, filtered: !!(moreActive || filters.q || filters.jobType) });
  // Every filter, the ones behind Filters too, and the search; the button goes with the empty list, so focus moves to the
  // search box.
  const showAll = () => {
    setQ("");
    setJobType("");
    setCanRefer(false);
    setWorkMode("");
    setSeniority("");
    setExperience("");
    moveFocus(searchBox.current);
  };
  const clearMore = () => {
    setWorkMode("");
    setSeniority("");
    setExperience("");
    // The button goes with the filters it cleared, so focus moves to the toggle beside it.
    moveFocus(filtersToggle.current);
  };
  const jobsKey = qk.jobs(slug, filters);
  // A new search or filter keeps the cards on screen, faded, until its answer comes: they only open a job.
  const jobs = useInfiniteList(jobsKey, (cursor) => api.jobs.list(slug, { ...filters, cursor, limit: 20 }), { enabled: tab === "openings", keepPreviousWhile: (previous) => onlyFiltersChanged(previous, jobsKey) });
  const seekers = useInfiniteList(qk.seekers(slug), (cursor) => api.jobs.seekers.list(slug, { cursor, limit: 20 }), tab === "seekers");
  const [status, setStatus] = useStatus();
  // Such as "Request sent", from the request form, which has gone.
  useGroupNotice("jobs", setStatus);
  usePrefetchDirectoryAfter("jobs", jobs.isFetched || seekers.isFetched);

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
              <Input ref={searchBox} accessibilityLabel="Search jobs" placeholder="Search title, company or skill" value={q} onChangeText={setQ} autoCorrect={false} autoComplete="off" />
            </View>
            <FlatList
              data={jobs.items}
              extraData={jobs.updating}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 96 }}
              keyboardShouldPersistTaps="handled"
              onEndReached={jobs.loadMore}
              refreshing={jobs.refreshing}
              onRefresh={() => void jobs.refetch()}
              // Raised over the rows, so the note at its foot can float on the first one's top edge, below the filters.
              ListHeaderComponentStyle={{ zIndex: 1 }}
              // With the list, so the filters scroll out of the way of the jobs they found.
              // Search, type and Can refer stay in view; the rest waits behind Filters, as on the directory.
              ListHeaderComponent={
                <View style={{ gap: spacing.sm }}>
                  <View role="group" aria-label="Job type">
                    <ChipSelect tall options={JOB_TYPES.map((t) => ({ value: t, label: JOB_TYPE_LABELS[t] }))} value={jobType} onChange={setJobType} allowEmpty emptyLabel="All types" />
                  </View>
                  {available && <Choice kind="checkbox" label={CAN_REFER_BADGE} checked={canRefer} onPress={() => setCanRefer(!canRefer)} />}
                  <Row style={{ justifyContent: "space-between" }}>
                    <Pressable ref={filtersToggle} onPress={() => setShowFilters((v) => !v)} accessibilityRole="button" aria-expanded={showFilters} style={{ minHeight: 44, justifyContent: "center" }}>
                      <Text style={{ color: theme.pageInk, fontWeight: "600" }}>
                        {showFilters ? "Hide filters" : "Filters"}
                        {moreActive ? ` (${moreActive})` : ""}
                      </Text>
                    </Pressable>
                    {moreActive > 0 && (
                      <Pressable onPress={clearMore} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}>
                        <Text style={{ color: theme.pageMuted }}>Clear filters</Text>
                      </Pressable>
                    )}
                  </Row>
                  {showFilters && (
                    <View style={{ gap: spacing.sm, paddingBottom: spacing.xs }}>
                      <View role="group" aria-label="Work mode">
                        <ChipSelect tall label="Work mode" options={WORK_MODES.map((m) => ({ value: m, label: WORK_MODE_LABELS[m] }))} value={workMode} onChange={setWorkMode} allowEmpty />
                      </View>
                      <View role="group" aria-label="Seniority">
                        <ChipSelect tall label="Seniority" options={JOB_SENIORITIES.map((s) => ({ value: s, label: JOB_SENIORITY_LABELS[s] }))} value={seniority} onChange={setSeniority} allowEmpty />
                      </View>
                      <Input
                        label="Your experience (years)"
                        value={experience}
                        onChangeText={setExperience}
                        keyboardType="number-pad"
                        maxLength={2}
                        hint="Lists the jobs whose experience range fits you."
                        style={{ width: 120 }}
                      />
                    </View>
                  )}
                  {/* On the first card's top edge, below every filter, as on the web: the content's gap further down. */}
                  <UpdatingNote updating={jobs.updating} gap={spacing.md} />
                </View>
              }
              ListEmptyComponent={
                <ListEmpty view={jobs.view} skeleton="listing" error={jobs.error} onRetry={jobs.retry} retrying={jobs.retrying}>
                  <EmptyState
                    icon={empty.live ? <IconSearch /> : <IconJobs />}
                    title={empty.title}
                    description={empty.description}
                    live={empty.live}
                    action={
                      empty.action &&
                      (empty.action.kind === "showAll" ? (
                        <Button title={empty.action.label} variant={empty.action.variant} onPress={showAll} />
                      ) : (
                        <Button title={empty.action.label} variant={empty.action.variant} accessibilityRole="link" onPress={() => router.push(`/t/${slug}/jobs/new`)} />
                      ))
                    }
                  />
                </ListEmpty>
              }
              // Kept rows are faded and busy, each of them, not the list, whose header holds the filters just used.
              renderItem={({ item }) => (
                <View style={jobs.updating ? KEPT_ROW : undefined}>
                  <JobCard slug={slug} job={item} kept={jobs.updating} />
                </View>
              )}
            />
            <Pressable
              onPress={() => router.push(`/t/${slug}/jobs/new`)}
              accessibilityRole="button"
              accessibilityLabel="Post a job"
              style={{ position: "absolute", right: 20, bottom: 24, backgroundColor: theme.primary, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", elevation: 4 }}
            >
              <Text style={{ color: theme.onPrimary, fontSize: 28, lineHeight: 30 }}>+</Text>
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
              refreshing={seekers.refreshing}
              onRefresh={() => void seekers.refetch()}
              ListEmptyComponent={
                <ListEmpty view={seekers.view} skeleton="member" error={seekers.error} onRetry={seekers.retry} retrying={seekers.retrying}>
                  <EmptyState icon={<IconProfile />} title={SEEKERS_EMPTY.title} description={SEEKERS_EMPTY.description} />
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
