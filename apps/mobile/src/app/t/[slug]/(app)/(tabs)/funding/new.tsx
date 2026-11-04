import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { FundingForm } from "@/components/forms/FundingForm";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";

export default function NewFundingScreen() {
  const { tenant } = useMembership();
  const { kind: kindParam } = useLocalSearchParams<{ kind?: string }>();
  const kind = kindParam === "OFFERING" ? "OFFERING" : "SEEKING";
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Screen title="New listing">
      <FundingForm
        kind={kind}
        submitLabel="Publish listing"
        onSubmit={async (input) => {
          const item = await api.funding.create(tenant.slug, input);
          void qc.invalidateQueries({ queryKey: ["funding", tenant.slug] });
          Alert.alert(item.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : "Listing published");
          router.replace(`/t/${tenant.slug}/funding/${item.id}`);
        }}
      />
    </Screen>
  );
}
