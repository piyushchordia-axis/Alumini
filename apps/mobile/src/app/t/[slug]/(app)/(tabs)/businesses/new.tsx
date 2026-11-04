import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { BusinessForm } from "@/components/forms/BusinessForm";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";

export default function NewBusinessScreen() {
  const { tenant } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Screen title="Add a business">
      <BusinessForm
        slug={tenant.slug}
        submitLabel="Publish listing"
        onSubmit={async (input) => {
          const item = await api.businesses.create(tenant.slug, input);
          void qc.invalidateQueries({ queryKey: ["businesses", tenant.slug] });
          // The listing's page shows when it is awaiting approval.
          router.replace(`/t/${tenant.slug}/businesses/${item.id}`);
        }}
      />
    </Screen>
  );
}
