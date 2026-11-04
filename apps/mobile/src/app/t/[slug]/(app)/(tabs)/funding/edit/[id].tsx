import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { FundingForm } from "@/components/forms/FundingForm";
import { LoadError, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditFundingScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const item = useQuery({ queryKey: qk.fundingItem(slug, id), queryFn: () => api.funding.get(slug, id) });
  if (item.isLoading) return <Spinner />;
  if (item.error || !item.data) return <LoadError error={item.error ?? "Not found"} onRetry={() => void item.refetch()} onBack={() => router.back()} backLabel="Back" />;
  return (
    <Screen title="Edit listing">
      <FundingForm
        kind={item.data.kind}
        initial={item.data}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          // `kind` is fixed once a listing exists.
          const { kind: _kind, ...changes } = input;
          const updated = await api.funding.update(slug, id, changes);
          qc.setQueryData(qk.fundingItem(slug, id), updated);
          void qc.invalidateQueries({ queryKey: ["funding", slug] });
          if (updated.moderationStatus === "PENDING") Alert.alert("Saved — awaiting admin approval");
          router.back();
        }}
      />
    </Screen>
  );
}
