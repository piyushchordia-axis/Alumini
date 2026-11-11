import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { FundingForm } from "@/components/forms/FundingForm";
import { loadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { usePageQuery } from "@/hooks/usePageQuery";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditFundingScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const item = useQuery({ queryKey: qk.fundingItem(slug, id), queryFn: () => api.funding.get(slug, id) });
  const page = usePageQuery(item);
  // Only with nothing to show: a refetch failing in the background keeps the form and what was typed.
  if (!item.data) return loadingScreen({ title: "Edit listing", shape: "form", page });
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
