import {
  MENTOR_AREA_LABELS,
  MENTOR_AREAS,
  MENTOR_AVAILABILITIES,
  MENTOR_AVAILABILITY_LABELS,
  MENTOR_FILTER_ANY,
  MENTORS_TAB_LABELS,
  MENTORS_TABS,
  MENTORSHIP_CONFIRM,
  STOP_MENTORING_EXPLAINED,
  mentorsTabFrom,
  mentorshipAvailable,
  mentorshipBoxFrom,
  mentorshipKeys,
  type MentorArea,
  type MentorAvailability,
  type MentorFilters,
  type MentorsTab,
  type MentorshipBox,
} from "@illuminize/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Platform, ScrollView, Text, View } from "react-native";
import { StatusLine } from "@/components/chat/ChatFrame";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { MentorCard } from "@/components/mentors/MentorCards";
import { MentorProfileForm } from "@/components/mentors/MentorProfileForm";
import { MentorshipRequests, useMentorshipList } from "@/components/mentors/MentorshipRequests";
import { Button, Card, ChipSelect, EmptyState, ErrorText, Input, ListEmpty, Spinner, Tabs } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { useGroupNotice } from "@/lib/groups";
import { api } from "@/lib/api";
import { refreshMentorship } from "@/lib/mentors";
import { homeHref } from "@/lib/sections";
import { colors, radius, spacing } from "@/theme";

const PAGE = 20;
const heading = { fontSize: 16, fontWeight: "700", color: colors.text } as const;
const body = { fontSize: 14, color: colors.muted } as const;

/** The tab and, on Requests, the list, kept in the URL as on the web app, so a mentorship push opens the right one. */
function useMentorsParams() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; box?: string }>();
  const tab = mentorsTabFrom(params.tab);
  const box = mentorshipBoxFrom(params.box);
  // Received is the default list, as Find mentors is the default tab, and neither needs a parameter.
  const go = (next: MentorsTab, nextBox: MentorshipBox = "received") => router.setParams({ tab: next === "find" ? undefined : next, box: next === "requests" && nextBox === "sent" ? "sent" : undefined });
  return { tab, box, go };
}

function FindMentors({ slug, onOffer }: { slug: string; onOffer: () => void }) {
  const [q, setQ] = useState("");
  const [area, setArea] = useState<MentorArea | "">("");
  const [availability, setAvailability] = useState<MentorAvailability | "">("");
  const search = useDebounced(q.trim());
  const filters: MentorFilters = { ...(search ? { q: search } : {}), ...(area ? { area } : {}), ...(availability ? { availability } : {}) };
  const filtered = Object.keys(filters).length > 0;
  const list = useInfiniteList(mentorshipKeys.mentors(slug, filters), (cursor) => api.mentorship.mentors(slug, { ...filters, cursor, limit: PAGE }));
  // The list leaves out the viewer, so an empty one says something different to someone who is listed themselves.
  const nobody = !filtered && !list.isLoading && list.items.length === 0;
  const listed = !!useMyMentorProfile(slug, nobody).data?.isActive;
  const clear = () => {
    setQ("");
    setArea("");
    setAvailability("");
  };
  return (
    <>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        {/* Off, so the web build's browser doesn't keep what's typed here for session restore. */}
        <Input accessibilityLabel="Search mentors" placeholder="Search by name" value={q} onChangeText={setQ} autoCorrect={false} autoComplete="off" />
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(m) => m.member.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        // With the list, so the filters scroll out of the way of the mentors they found.
        ListHeaderComponent={
          <View style={{ gap: spacing.sm }}>
            <View role="group" aria-label="Area">
              <ChipSelect tall label="Area" options={MENTOR_AREAS.map((a) => ({ value: a, label: MENTOR_AREA_LABELS[a] }))} value={area} onChange={setArea} allowEmpty emptyLabel={MENTOR_FILTER_ANY.area} />
            </View>
            <View role="group" aria-label="Availability">
              <ChipSelect
                tall
                label="Availability"
                options={MENTOR_AVAILABILITIES.map((v) => ({ value: v, label: MENTOR_AVAILABILITY_LABELS[v] }))}
                value={availability}
                onChange={setAvailability}
                allowEmpty
                emptyLabel={MENTOR_FILTER_ANY.availability}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            {filtered ? (
              <View style={{ gap: spacing.md }}>
                <EmptyState icon="🔎" title="No mentors match" description="Try another name, area or availability." />
                <Button title="Clear filters" variant="outline" onPress={clear} />
              </View>
            ) : listed ? (
              <View style={{ gap: spacing.md }}>
                <EmptyState icon="🧭" title="You're the only mentor so far" description="Members find you here, and other mentors will be listed here too when they offer to mentor." />
                <Button title="See your mentor profile" variant="outline" onPress={onOffer} />
              </View>
            ) : (
              <View style={{ gap: spacing.md }}>
                <EmptyState icon="🧭" title="No mentors yet" description="When members offer to mentor, they're listed here. You could be the first." />
                <Button title="Offer to mentor" onPress={onOffer} />
              </View>
            )}
          </ListEmpty>
        }
        renderItem={({ item }) => <MentorCard slug={slug} mentor={item} />}
      />
    </>
  );
}

/** Stop mentoring, for a member listed as a mentor: said what it does beside the button, and asked again before it's done. */
function StopMentoring({ slug, onStopped }: { slug: string; onStopped: (text: string) => void }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const stop = useMutation({
    mutationFn: () => api.mentorship.stop(slug),
    onSuccess: () => {
      setConfirming(false);
      void refreshMentorship(qc, slug);
      onStopped("You've stopped mentoring");
    },
  });
  return (
    <Card>
      <Text role="heading" style={heading}>
        Stop mentoring
      </Text>
      <Text style={body}>{STOP_MENTORING_EXPLAINED}</Text>
      <Button
        title="Stop mentoring"
        variant="outline"
        onPress={() => {
          stop.reset();
          setConfirming(true);
        }}
      />
      <ConfirmSheet
        open={confirming}
        title={MENTORSHIP_CONFIRM.stop.title}
        body={MENTORSHIP_CONFIRM.stop.body}
        confirmLabel={MENTORSHIP_CONFIRM.stop.confirm}
        destructive
        busy={stop.isPending}
        error={stop.error}
        onConfirm={() => stop.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}

function useMyMentorProfile(slug: string, enabled = true) {
  return useQuery({ queryKey: mentorshipKeys.me(slug), queryFn: () => api.mentorship.me(slug), enabled });
}

function BeAMentor({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const me = useMyMentorProfile(slug);
  const [status, setStatus] = useStatus();
  if (me.isLoading) return <Spinner />;
  // Only with nothing to show: a refetch failing in the background keeps the form and what was typed.
  if (me.data === undefined)
    return (
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <ErrorText error={me.error ?? "Your mentor profile couldn't be loaded"} />
        <Button title="Retry loading" variant="outline" onPress={() => void me.refetch()} />
      </View>
    );
  const profile = me.data;
  const [title, text] = profile?.isActive
    ? ["You're listed as a mentor", "Members can find you in Find mentors and ask you to mentor them. Their requests wait in Requests, and you choose which to accept."]
    : profile
      ? ["You're not listed as a mentor", "Save your profile to be listed in Find mentors again."]
      : ["Offer to mentor", "Members will find you in Find mentors and can ask you to mentor them, with a note about what they'd like help with. You choose which requests to accept, and accepting opens a private chat."];
  return (
    // iOS moves what's focused clear of the keyboard here; Android resizes the window for it.
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={Platform.OS === "ios"} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 48 }}>
      <Card>
        <Text role="heading" style={heading}>
          {title}
        </Text>
        <Text style={body}>{text}</Text>
        <View style={{ marginTop: spacing.md }}>
          <MentorProfileForm
            profile={profile}
            onSave={async (input) => {
              const saved = await api.mentorship.saveMe(slug, input);
              qc.setQueryData(mentorshipKeys.me(slug), saved);
              void refreshMentorship(qc, slug);
              setStatus(profile?.isActive ? "Mentor profile saved" : "You're listed as a mentor");
            }}
          />
        </View>
      </Card>
      {/* Under the form's Save, where the member is when they tap it, rather than at the top of a long form. */}
      <StatusLine flush text={status} />
      {profile?.isActive && <StopMentoring slug={slug} onStopped={setStatus} />}
    </ScrollView>
  );
}

function Title({ subtitle }: { subtitle?: string }) {
  return (
    <View>
      <Text role="heading" style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
        Mentors
      </Text>
      {subtitle ? <Text style={{ fontSize: 13, color: colors.muted }}>{subtitle}</Text> : null}
    </View>
  );
}

/** Find mentors, Requests and Be a mentor, for a member who can use mentorship. */
function MentorsSection({ slug }: { slug: string }) {
  const { tab, box, go } = useMentorsParams();
  // Requests says how many are waiting for an answer, from the received list itself, which its tab then shows at once.
  const waiting = useMentorshipList(slug, "received").first?.waiting ?? 0;
  const [status, setStatus] = useStatus();
  // Such as "Request sent", from the request form, which has gone.
  useGroupNotice("mentors", setStatus);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm }}>
        <Title subtitle="Members who offer to guide others, and your requests" />
        <Tabs tall value={tab} onChange={(next) => go(next, box)} tabs={MENTORS_TABS.map((t) => ({ value: t, label: MENTORS_TAB_LABELS[t], ...(t === "requests" && waiting > 0 ? { count: waiting } : {}) }))} />
      </View>
      <StatusLine text={status} />
      <View role="tabpanel" aria-label={MENTORS_TAB_LABELS[tab]} style={{ flex: 1 }}>
        {tab === "find" ? (
          <FindMentors slug={slug} onOffer={() => go("be-a-mentor")} />
        ) : tab === "requests" ? (
          <MentorshipRequests slug={slug} box={box} onBoxChange={(next) => go("requests", next)} onFind={() => go("find")} />
        ) : (
          <BeAMentor slug={slug} />
        )}
      </View>
    </View>
  );
}

/**
 * For a member who can't use mentorship now, because the institution switched it off or they're a current pupil. Whatever
 * they're already in stays theirs to leave: requests to withdraw, mentorships to end, a listing to stop, as the API allows.
 * With nothing of the kind, it just says Mentors aren't available.
 */
function MentorsWayOut({ slug }: { slug: string }) {
  const { tenant, membership } = useMembership();
  const router = useRouter();
  const { box, go } = useMentorsParams();
  const received = useMentorshipList(slug, "received");
  const sent = useMentorshipList(slug, "sent");
  const me = useMyMentorProfile(slug);
  const [status, setStatus] = useStatus();
  if (received.isLoading || sent.isLoading || me.isLoading) return <Spinner />;
  const failed = [received, sent, me].find((q) => q.error && q.data === undefined);
  if (failed)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.sm }}>
        <ErrorText error={failed.error} />
        <Button title="Retry loading" variant="outline" onPress={() => void failed.refetch()} />
      </View>
    );
  const listed = !!me.data?.isActive;
  if (!listed && received.items.length === 0 && sent.items.length === 0)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.md }}>
        <EmptyState icon="🔒" title="Mentors aren't available" description={`Mentorship isn't open to your account at ${tenant.shortName ?? tenant.name}.`} />
        <Button title="Go to the app" accessibilityRole="link" onPress={() => router.replace(homeHref(slug, tenant.settings.features))} />
      </View>
    );
  const why = membership.chatEligible ? `${tenant.shortName ?? tenant.name} has switched mentorship off.` : "Mentorship isn't open to your account.";
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MentorshipRequests
        slug={slug}
        box={box}
        onBoxChange={(next) => go("requests", next)}
        limited
        header={
          <View style={{ gap: spacing.md }}>
            <Title />
            <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", padding: spacing.md }}>
              <Text style={{ fontSize: 14, color: "#78350f" }}>
                {`${why} You can't find mentors or answer requests, but you can still ${listed ? "withdraw your requests, end mentorships and stop mentoring" : "withdraw your requests and end mentorships"} here.`}
              </Text>
            </View>
            <StatusLine text={status} />
            {listed && <StopMentoring slug={slug} onStopped={setStatus} />}
          </View>
        }
      />
    </View>
  );
}

/** Mentors: finding one, the requests both ways, and offering to mentor. The tab is in the URL, as on Groups. */
export default function MentorsScreen() {
  const { tenant, membership } = useMembership();
  if (mentorshipAvailable(tenant.settings.features, membership.chatEligible)) return <MentorsSection slug={tenant.slug} />;
  return <MentorsWayOut slug={tenant.slug} />;
}
