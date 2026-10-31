import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { JobForm } from "@/components/forms/JobForm";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";

export default function NewJobScreen() {
  const { tenant } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Screen>
      <JobForm
        submitLabel="Post job"
        onSubmit={async (input) => {
          const job = await api.jobs.create(tenant.slug, input);
          void qc.invalidateQueries({ queryKey: ["jobs", tenant.slug] });
          Alert.alert(job.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : "Job published");
          router.replace(`/t/${tenant.slug}/jobs/${job.id}`);
        }}
      />
    </Screen>
  );
}
