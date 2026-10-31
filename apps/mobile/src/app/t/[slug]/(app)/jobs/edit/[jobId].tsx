import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { JobForm } from "@/components/forms/JobForm";
import { LoadError, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditJobScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { jobId = "" } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const job = useQuery({ queryKey: qk.job(slug, jobId), queryFn: () => api.jobs.get(slug, jobId) });
  if (job.isLoading) return <Spinner />;
  if (job.error || !job.data) return <LoadError error={job.error ?? "Not found"} onRetry={() => void job.refetch()} onBack={() => router.back()} backLabel="Back" />;
  return (
    <Screen>
      <JobForm
        initial={job.data}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          const updated = await api.jobs.update(slug, jobId, input);
          qc.setQueryData(qk.job(slug, jobId), updated);
          void qc.invalidateQueries({ queryKey: ["jobs", slug] });
          if (updated.moderationStatus === "PENDING") Alert.alert("Saved — awaiting admin approval");
          router.back();
        }}
      />
    </Screen>
  );
}
