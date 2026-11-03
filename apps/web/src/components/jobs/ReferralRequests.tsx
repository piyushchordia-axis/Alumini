import { CAN_REFER_LABEL, REFERRAL_BOX_LABELS, referralsWayOutText, type ReferralBox } from "@illuminize/shared";
import { ReferralsUnavailable } from "@/components/jobs/JobUnavailable";
import { ReferralList, useReferralList } from "@/components/jobs/ReferralList";
import { Button, EmptyState, ErrorBox, Loading, Tabs } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";

/**
 * Referrals: the requests about this member's jobs (Received) and the ones they sent (Sent), with each one's note, its job
 * and where it stands. `limited` is for a member who can't use referrals now: only the ways out are offered.
 */
export function ReferralRequests({ slug, box, onBoxChange, limited, onBrowse }: { slug: string; box: ReferralBox; onBoxChange: (box: ReferralBox) => void; limited: boolean; onBrowse?: () => void }) {
  const list = useReferralList(slug, box);
  // The count on Received comes from that list, whichever is open, as the Referrals tab's does.
  const waiting = useReferralList(slug, "received").first?.waiting ?? 0;
  const empty =
    box === "received" ? (
      <EmptyState
        icon="📨"
        title="No referral requests yet"
        description={limited ? "Requests about the jobs you post show here." : `When you post a job and tick “${CAN_REFER_LABEL}”, members can ask you for a referral. Their requests wait here for your answer.`}
      />
    ) : (
      <EmptyState
        icon="💼"
        title="You haven't asked for a referral yet"
        description="When you ask a job's poster to refer you, your request and their answer show here."
        action={
          limited || !onBrowse ? undefined : (
            <Button className="min-h-11" onClick={onBrowse}>
              Find jobs that can refer
            </Button>
          )
        }
      />
    );
  return (
    <div className="space-y-3">
      <Tabs
        className="w-full [&>button]:min-h-11 [&>button]:flex-1"
        value={box}
        onChange={onBoxChange}
        tabs={[
          { value: "received", label: REFERRAL_BOX_LABELS.received, ...(waiting > 0 ? { count: waiting } : {}) },
          { value: "sent", label: REFERRAL_BOX_LABELS.sent },
        ]}
      />
      <div role="tabpanel" aria-label={REFERRAL_BOX_LABELS[box]}>
        <ReferralList slug={slug} list={list} empty={empty} limited={limited} showJob />
      </div>
    </div>
  );
}

/**
 * Referrals for a member who can't use them now, because the institution switched them off or they're a current pupil.
 * Whatever they're already in stays theirs to leave: their own requests to withdraw, and requests about their jobs to
 * decline or report, as the API allows. With nothing there at all, it says Referrals aren't available.
 */
export function ReferralsWayOut({ slug, box, onBoxChange }: { slug: string; box: ReferralBox; onBoxChange: (box: ReferralBox) => void }) {
  const { tenant, membership } = useMembership();
  const received = useReferralList(slug, "received");
  const sent = useReferralList(slug, "sent");
  if (received.isLoading || sent.isLoading) return <Loading />;
  const failed = [received, sent].find((q) => q.error && q.data === undefined);
  if (failed)
    return (
      <div className="space-y-3">
        <ErrorBox error={failed.error} />
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => void failed.refetch()}>
          Retry loading
        </Button>
      </div>
    );
  if (received.items.length === 0 && sent.items.length === 0) return <ReferralsUnavailable />;
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{referralsWayOutText(tenant.shortName ?? tenant.name, membership.chatEligible)}</p>
      <ReferralRequests slug={slug} box={box} onBoxChange={onBoxChange} limited />
    </div>
  );
}
