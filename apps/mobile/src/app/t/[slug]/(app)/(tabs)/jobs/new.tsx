import { jobSavedText } from "@illuminize/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { JobForm } from "@/components/forms/JobForm";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { leaveGroupNotice } from "@/lib/groups";
import { jobHref, useReferralsAvailable } from "@/lib/referrals";

export default function NewJobScreen() {
  const { tenant } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  const offerReferrals = useReferralsAvailable();
  return (
    <Screen title="Post a job">
      <JobForm
        submitLabel="Post job"
        offerReferrals={offerReferrals}
        onSubmit={async (input) => {
          const job = await api.jobs.create(tenant.slug, input);
          void qc.invalidateQueries({ queryKey: ["jobs", tenant.slug] });
          // Said on the job's page, which replaces this form: Alert.alert would show nothing on the web build.
          leaveGroupNotice(`job:${job.id}`, jobSavedText(false, job.moderationStatus === "PENDING"));
          router.replace(jobHref(tenant.slug, job.id));
        }}
      />
    </Screen>
  );
}
