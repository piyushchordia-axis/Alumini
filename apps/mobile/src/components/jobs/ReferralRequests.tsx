import { CAN_REFER_LABEL, REFERRAL_BOX_LABELS, referralsWayOutText, type ReferralBox } from "@illuminize/shared";
import type { ReactElement } from "react";
import { FlatList, Text, View } from "react-native";
import { IconJobs, IconMail } from "@/components/icons";
import { ReferralsUnavailable } from "@/components/jobs/JobUnavailable";
import { useReferralList, useReferralRows } from "@/components/jobs/ReferralRows";
import { Button, EmptyState, ErrorText, ListEmpty, Spinner, Tabs } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { colors, radius, spacing } from "@/theme";

/** Said above what's left to do while the member can't use referrals, as on the Mentors screen. */
export function WayOutBanner({ text }: { text: string }) {
  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", padding: spacing.md }}>
      <Text style={{ fontSize: 14, color: "#78350f" }}>{text}</Text>
    </View>
  );
}

/**
 * Referrals: the requests about this member's jobs (Received) and the ones they sent (Sent), with each one's note, its job
 * and where it stands. `limited` is for a member who can't use referrals now: only the ways out are offered. `header`
 * scrolls with the list. `onBrowse` goes to the openings that can refer, offered when nothing has been asked yet.
 */
export function ReferralRequests({
  slug,
  box,
  onBoxChange,
  limited,
  header,
  onBrowse,
}: {
  slug: string;
  box: ReferralBox;
  onBoxChange: (box: ReferralBox) => void;
  limited: boolean;
  header?: ReactElement;
  onBrowse?: () => void;
}) {
  const list = useReferralList(slug, box);
  // The count on Received comes from that list, whichever is open, as the Referrals tab's does.
  const waiting = useReferralList(slug, "received").first?.waiting ?? 0;
  const rows = useReferralRows(slug, { limited, showJob: true });
  const empty =
    box === "received" ? (
      <EmptyState
        icon={<IconMail size={32} color={colors.faint} />}
        title="No referral requests yet"
        description={limited ? "Requests about the jobs you post show here." : `When you post a job and tick “${CAN_REFER_LABEL}”, members can ask you for a referral. Their requests wait here for your answer.`}
      />
    ) : (
      <View style={{ gap: spacing.md }}>
        <EmptyState icon={<IconJobs size={32} color={colors.faint} />} title="You haven't asked for a referral yet" description="When you ask a job's poster to refer you, your request and their answer show here." />
        {!limited && onBrowse && <Button title="Find jobs that can refer" onPress={onBrowse} />}
      </View>
    );
  return (
    <>
      <FlatList
        data={list.items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, paddingBottom: 48 }}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {header}
            <Tabs
              tall
              value={box}
              onChange={onBoxChange}
              tabs={[
                { value: "received", label: REFERRAL_BOX_LABELS.received, ...(waiting > 0 ? { count: waiting } : {}) },
                { value: "sent", label: REFERRAL_BOX_LABELS.sent },
              ]}
            />
            {rows.statusAbove(list.items)}
          </View>
        }
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            {empty}
          </ListEmpty>
        }
        renderItem={({ item }) => rows.renderRow(item)}
      />
      {rows.sheets}
    </>
  );
}

/**
 * Referrals for a member who can't use them now, because the institution switched them off or they're a current pupil.
 * Whatever they're already in stays theirs to leave: their own requests to withdraw, and requests about their jobs to
 * decline or report, as the API allows. With nothing there at all, it says Referrals aren't available.
 */
export function ReferralsWayOut({ slug, box, onBoxChange, onBack }: { slug: string; box: ReferralBox; onBoxChange: (box: ReferralBox) => void; onBack: () => void }) {
  const { tenant, membership } = useMembership();
  const received = useReferralList(slug, "received");
  const sent = useReferralList(slug, "sent");
  if (received.isLoading || sent.isLoading) return <Spinner />;
  const failed = [received, sent].find((q) => q.error && q.data === undefined);
  if (failed)
    return (
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <ErrorText error={failed.error} />
        <Button title="Retry loading" variant="outline" onPress={() => void failed.refetch()} />
      </View>
    );
  if (received.items.length === 0 && sent.items.length === 0) return <ReferralsUnavailable onBack={onBack} />;
  return (
    // On the Jobs screen's own page, so the member's background shows through.
    <View style={{ flex: 1 }}>
      <ReferralRequests slug={slug} box={box} onBoxChange={onBoxChange} limited header={<WayOutBanner text={referralsWayOutText(tenant.shortName ?? tenant.name, membership.chatEligible)} />} />
    </View>
  );
}
