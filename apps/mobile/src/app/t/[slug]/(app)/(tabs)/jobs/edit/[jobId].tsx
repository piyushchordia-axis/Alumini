import { jobSavedText } from "@illuminize/shared";
import { fatalQueryError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { JobForm } from "@/components/forms/JobForm";
import { JobUnavailable } from "@/components/jobs/JobUnavailable";
import { Screen, Spinner } from "@/components/ui";
import { useJob } from "@/hooks/useJob";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { leaveGroupNotice } from "@/lib/groups";
import { qk } from "@/lib/queryKeys";
import { refreshReferrals, useReferralsAvailable } from "@/lib/referrals";

export default function EditJobScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { jobId = "" } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const offerReferrals = useReferralsAvailable();
  const job = useJob(slug, jobId);
  // Only an answer, or nothing at all to show: a refetch failing in the background keeps the form and what was typed.
  const error = fatalQueryError(job);
  if (error) return <JobUnavailable error={error} onRetry={() => void job.refetch()} />;
  if (!job.data) return <Spinner />;
  return (
    <Screen title="Edit job">
      <JobForm
        initial={job.data}
        submitLabel="Save changes"
        offerReferrals={offerReferrals}
        waitingReferrals={job.data.pendingReferralCount ?? 0}
        onSubmit={async (input) => {
          const updated = await api.jobs.update(slug, jobId, input);
          qc.setQueryData(qk.job(slug, jobId), updated);
          void qc.invalidateQueries({ queryKey: ["jobs", slug] });
          // Unticking "I can refer" closes the requests waiting on it.
          void refreshReferrals(qc, slug);
          // Said on the job's page, which is under this form: Alert.alert would show nothing on the web build.
          leaveGroupNotice(`job:${jobId}`, jobSavedText(true, updated.moderationStatus === "PENDING"));
          router.back();
        }}
      />
    </Screen>
  );
}
