import { REFERRAL_CONFIRM, jobReferralsIntro, jobReferralsWayOutText, myReferralText, referralAskRefusalText, referralAskText, takesReferralRequests, type JobDetailDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { IconMail } from "@/components/icons";
import { ReferralList, useJobReferralList } from "@/components/jobs/ReferralList";
import { Badge, Button, EmptyState, LinkButton } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { useRowFocus } from "@/hooks/useRowFocus";
import { api } from "@/lib/api";
import { jobsPath, refreshReferrals, referralRequestPath, useReferralsAvailable } from "@/lib/referrals";
import { toast } from "@/stores/uiStore";

/** `id` makes it a place focus can be moved to, for when the control that had it goes. */
function Section({ id, title, aside, children }: { id?: string; title: string; aside?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section id={id} tabIndex={id ? -1 : undefined} aria-labelledby={headingId} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * On someone else's job: Ask for a referral, for a member who can and has no request waiting or answered about it, or where
 * their own request stands, with Withdraw request while it waits and Open chat once accepted. Something of their own that
 * would refuse a request (they've asked as many times as they can, or blocked the poster) is said in place of Ask, before
 * any note is written. Nothing at all on a job that takes no requests and that they never asked about.
 */
export function MyReferral({ slug, job }: { slug: string; job: JobDetailDto }) {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const available = useReferralsAvailable();
  const [now] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const sectionId = useId();
  // Withdraw request goes once the page has refetched, so focus moves to the section rather than to the top of the page.
  const focus = useRowFocus(confirming);
  const withdraw = useMutation({
    mutationFn: (id: string) => api.jobs.referrals.withdraw(slug, id),
    onSuccess: () => {
      focus.afterDialog(sectionId);
      setConfirming(false);
      void refreshReferrals(qc, slug);
      toast.success("Request withdrawn");
    },
    // It may have been answered meanwhile, or the job closed: the page refetches to say where it stands now.
    onError: (err) => {
      focus.afterDialog(sectionId);
      setConfirming(false);
      toast.error(errorMessage(err));
      void refreshReferrals(qc, slug);
    },
  });
  const mine = job.myReferral;
  const poster = job.author.fullName;
  // Asking again is allowed once an earlier request was withdrawn or closed with the job, as many times as the API allows.
  const askable = available && takesReferralRequests(job, now) && (!mine || mine.status === "WITHDRAWN" || mine.status === "CLOSED");
  const refusal = askable && job.referralAskRefusal ? referralAskRefusalText(job.referralAskRefusal, poster) : null;
  const canAsk = askable && !refusal;
  if (!mine && !askable) return null;
  const chatOn = tenant.settings.features.messaging && membership.chatEligible;
  return (
    <Section id={sectionId} title="Referral">
      {(mine || !refusal) && <p className="mt-1 text-sm text-slate-600 [overflow-wrap:anywhere]">{mine ? myReferralText(mine.status, poster) : referralAskText(poster)}</p>}
      {refusal && <p className="mt-1 text-sm text-slate-600 [overflow-wrap:anywhere]">{refusal.body}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {canAsk && (
          <LinkButton to={referralRequestPath(slug, job.id)} className="min-h-11">
            Ask for a referral
          </LinkButton>
        )}
        {mine?.status === "ACCEPTED" && mine.conversationId && chatOn && (
          <LinkButton to={`/t/${slug}/app/messages/${mine.conversationId}`} className="min-h-11">
            Open chat
          </LinkButton>
        )}
        {mine?.status === "REQUESTED" && (
          <Button variant="outline" className="min-h-11" onClick={() => setConfirming(true)}>
            Withdraw request
          </Button>
        )}
        {mine && (
          <LinkButton to={jobsPath(slug, "referrals", "sent")} variant="ghost" className="min-h-11">
            See your requests
          </LinkButton>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title={REFERRAL_CONFIRM.withdraw.title}
        body={REFERRAL_CONFIRM.withdraw.body(poster)}
        confirmLabel={REFERRAL_CONFIRM.withdraw.confirm}
        destructive
        busy={withdraw.isPending}
        onConfirm={() => mine && withdraw.mutate(mine.id)}
        onCancel={() => setConfirming(false)}
      />
    </Section>
  );
}

/**
 * On the poster's own job: its referral requests, each with the note, who sent it, where it stands and when, and Accept,
 * Decline and Report while it waits, or Open chat once accepted. Shown while the job offers referrals, and afterwards while
 * any request about it is left to see. While referrals are off for the poster, only Decline and Report are offered.
 */
export function JobReferrals({ slug, job }: { slug: string; job: JobDetailDto }) {
  const { tenant, membership } = useMembership();
  const available = useReferralsAvailable();
  const [now] = useState(() => Date.now());
  const list = useJobReferralList(slug, job.id);
  if (!job.canRefer && list.items.length === 0) return null;
  const waiting = list.first?.waiting ?? job.pendingReferralCount ?? 0;
  return (
    <Section title="Referral requests" aside={waiting > 0 ? <Badge tone="warning">{waiting} waiting</Badge> : undefined}>
      {available ? (
        <p className="mt-1 text-sm text-slate-600">{jobReferralsIntro(job, now)}</p>
      ) : (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{jobReferralsWayOutText(tenant.shortName ?? tenant.name, membership.chatEligible)}</p>
      )}
      <div className="mt-4">
        <ReferralList
          slug={slug}
          list={list}
          limited={!available}
          showJob={false}
          empty={<EmptyState icon={<IconMail size={32} className="text-slate-400" />} title="No referral requests yet" description="When members ask you to refer them for this job, their requests wait here for your answer." />}
        />
      </div>
    </Section>
  );
}
