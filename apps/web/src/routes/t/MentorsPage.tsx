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
  mentorsQuery,
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
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ListBody } from "@/components/common/ListBody";
import { MentorsUnavailable } from "@/components/guards/RequireFeature";
import { IconMentors, IconSearch } from "@/components/icons";
import { MentorCard } from "@/components/mentors/MentorCard";
import { MentorProfileForm } from "@/components/mentors/MentorProfileForm";
import { MentorshipRequests, useMentorshipList } from "@/components/mentors/MentorshipRequests";
import { Button, Card, EmptyState, ErrorBox, Input, Loading, PageHeader, Select, Tabs } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { refreshMentorship } from "@/lib/mentors";
import { toast } from "@/stores/uiStore";

const PAGE = 20;

/** The tab and, on Requests, the list, kept in the URL, as the mentorship notifications link to them. Received needs no `box`. */
function useMentorsParams() {
  const [params, setParams] = useSearchParams();
  const tab = mentorsTabFrom(params.get("tab"));
  const box = mentorshipBoxFrom(params.get("box"));
  const go = (next: MentorsTab, nextBox: MentorshipBox = "received") => setParams(new URLSearchParams(mentorsQuery(next, nextBox === "sent" ? "sent" : undefined)), { replace: true });
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
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input aria-label="Search mentors" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} type="search" autoComplete="off" className="min-h-11" />
        <Select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value as MentorArea | "")} className="min-h-11">
          <option value="">{MENTOR_FILTER_ANY.area}</option>
          {MENTOR_AREAS.map((a) => (
            <option key={a} value={a}>
              {MENTOR_AREA_LABELS[a]}
            </option>
          ))}
        </Select>
        <Select aria-label="Availability" value={availability} onChange={(e) => setAvailability(e.target.value as MentorAvailability | "")} className="min-h-11">
          <option value="">{MENTOR_FILTER_ANY.availability}</option>
          {MENTOR_AVAILABILITIES.map((v) => (
            <option key={v} value={v}>
              {MENTOR_AVAILABILITY_LABELS[v]}
            </option>
          ))}
        </Select>
      </div>
      <ListBody
        list={{ ...list, hasNextPage: !!list.hasNextPage }}
        empty={
          filtered ? (
            <EmptyState icon={<IconSearch size={32} className="text-slate-400" />} title="No mentors match" description="Try another name, area or availability." action={<Button variant="outline" className="min-h-11" onClick={clear}>Clear filters</Button>} />
          ) : listed ? (
            <EmptyState
              icon={<IconMentors size={32} className="text-slate-400" />}
              title="You're the only mentor so far"
              description="Members find you here, and other mentors will be listed here too when they offer to mentor."
              action={
                <Button variant="outline" className="min-h-11" onClick={onOffer}>
                  See your mentor profile
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<IconMentors size={32} className="text-slate-400" />} title="No mentors yet" description="When members offer to mentor, they're listed here. You could be the first." action={<Button className="min-h-11" onClick={onOffer}>Offer to mentor</Button>} />
          )
        }
      >
        {(items) => items.map((m) => <MentorCard key={m.member.id} slug={slug} mentor={m} />)}
      </ListBody>
    </div>
  );
}

/** Stop mentoring, for a member listed as a mentor: said what it does beside the button, and asked again before it's done. */
function StopMentoring({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const stop = useMutation({
    mutationFn: () => api.mentorship.stop(slug),
    onSuccess: () => {
      setConfirming(false);
      void refreshMentorship(qc, slug);
      toast.success("You've stopped mentoring");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card as="section" className="p-5">
      <h2 className="text-base font-semibold text-slate-900">Stop mentoring</h2>
      <p className="mt-1 text-sm text-slate-600">{STOP_MENTORING_EXPLAINED}</p>
      <Button variant="outline" className="mt-3 min-h-11" onClick={() => setConfirming(true)}>
        Stop mentoring
      </Button>
      <ConfirmDialog
        open={confirming}
        title={MENTORSHIP_CONFIRM.stop.title}
        body={MENTORSHIP_CONFIRM.stop.body}
        confirmLabel={MENTORSHIP_CONFIRM.stop.confirm}
        destructive
        busy={stop.isPending}
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
  if (me.isLoading) return <Loading />;
  // Only with nothing to show: a refetch failing in the background keeps the form and what was typed.
  if (me.data === undefined)
    return (
      <div className="space-y-3">
        <ErrorBox error={me.error ?? "Your mentor profile couldn't be loaded"} />
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => void me.refetch()}>
          Retry loading
        </Button>
      </div>
    );
  const profile = me.data;
  const [title, text] = profile?.isActive
    ? ["You're listed as a mentor", "Members can find you in Find mentors and ask you to mentor them. Their requests wait in Requests, and you choose which to accept."]
    : profile
      ? ["You're not listed as a mentor", "Save your profile to be listed in Find mentors again."]
      : ["Offer to mentor", "Members will find you in Find mentors and can ask you to mentor them, with a note about what they'd like help with. You choose which requests to accept, and accepting opens a private chat."];
  return (
    <div className="space-y-4">
      <Card as="section" className="p-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{text}</p>
        <div className="mt-5">
          <MentorProfileForm
            profile={profile}
            onSave={async (input) => {
              const saved = await api.mentorship.saveMe(slug, input);
              qc.setQueryData(mentorshipKeys.me(slug), saved);
              void refreshMentorship(qc, slug);
              toast.success(profile?.isActive ? "Mentor profile saved" : "You're listed as a mentor");
            }}
          />
        </div>
      </Card>
      {profile?.isActive && <StopMentoring slug={slug} />}
    </div>
  );
}

/** Find mentors, Requests and Be a mentor, for a member who can use mentorship. */
function MentorsSection({ slug }: { slug: string }) {
  const { tab, box, go } = useMentorsParams();
  // Requests says how many are waiting for an answer, from the received list itself, which its tab then shows at once.
  const waiting = useMentorshipList(slug, "received").first?.waiting ?? 0;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Mentors" subtitle="Members who offer to guide others, and your requests" />
      <Tabs
        className="w-full [&>button]:min-h-11 [&>button]:flex-1"
        value={tab}
        onChange={(next) => go(next, box)}
        tabs={MENTORS_TABS.map((t) => ({ value: t, label: MENTORS_TAB_LABELS[t], ...(t === "requests" && waiting > 0 ? { count: waiting } : {}) }))}
      />
      <div role="tabpanel" aria-label={MENTORS_TAB_LABELS[tab]}>
        {tab === "find" ? <FindMentors slug={slug} onOffer={() => go("be-a-mentor")} /> : tab === "requests" ? <MentorshipRequests slug={slug} box={box} onBoxChange={(next) => go("requests", next)} /> : <BeAMentor slug={slug} />}
      </div>
    </div>
  );
}

/**
 * For a member who can't use mentorship now, because the institution switched it off or they're a current pupil. Whatever
 * they're already in stays theirs to leave: requests to withdraw, mentorships to end, a listing to stop, as the API allows.
 * With nothing of the kind, it just says Mentors aren't available.
 */
function MentorsWayOut({ slug }: { slug: string }) {
  const { tenant, membership } = useMembership();
  const { box, go } = useMentorsParams();
  const received = useMentorshipList(slug, "received");
  const sent = useMentorshipList(slug, "sent");
  const me = useMyMentorProfile(slug);
  if (received.isLoading || sent.isLoading || me.isLoading) return <Loading />;
  const failed = [received, sent, me].find((q) => q.error && q.data === undefined);
  if (failed)
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <ErrorBox error={failed.error} />
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => void failed.refetch()}>
          Retry loading
        </Button>
      </div>
    );
  const listed = !!me.data?.isActive;
  if (!listed && received.items.length === 0 && sent.items.length === 0) return <MentorsUnavailable />;
  const why = membership.chatEligible ? `${tenant.shortName ?? tenant.name} has switched mentorship off.` : "Mentorship isn't open to your account.";
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Mentors" />
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {why} You can't find mentors or answer requests, but you can still {listed ? "withdraw your requests, end mentorships and stop mentoring" : "withdraw your requests and end mentorships"} here.
      </p>
      {listed && <StopMentoring slug={slug} />}
      <MentorshipRequests slug={slug} box={box} onBoxChange={(next) => go("requests", next)} limited />
    </div>
  );
}

/** Mentors: finding one, the requests both ways, and offering to mentor. The tab is in the URL, as on Groups. */
export function MentorsPage() {
  const { tenant, membership } = useMembership();
  if (mentorshipAvailable(tenant.settings.features, membership.chatEligible)) return <MentorsSection slug={tenant.slug} />;
  return <MentorsWayOut slug={tenant.slug} />;
}
