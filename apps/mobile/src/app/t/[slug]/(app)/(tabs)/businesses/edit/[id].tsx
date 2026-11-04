import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BusinessForm } from "@/components/forms/BusinessForm";
import { LoadError, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditBusinessScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const item = useQuery({ queryKey: qk.business(slug, id), queryFn: () => api.businesses.get(slug, id) });
  // Back to the listing: the screen below when opened from it, otherwise in place of this one. A form opened from a link or
  // a reload has only the list behind it, the stack's anchor.
  const leave = () => router.dismissTo(`/t/${slug}/businesses/${id}`);
  if (item.isLoading) return <Spinner />;
  // Only with nothing cached: a failed background refetch must not replace the form and lose what was typed.
  if (!item.data) return <LoadError error={item.error ?? "Not found"} onRetry={() => void item.refetch()} onBack={leave} backLabel="Back" />;
  return (
    <Screen title="Edit listing">
      <BusinessForm
        slug={slug}
        initial={item.data}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          const updated = await api.businesses.update(slug, id, input);
          qc.setQueryData(qk.business(slug, id), updated);
          void qc.invalidateQueries({ queryKey: ["businesses", slug] });
          leave();
        }}
      />
    </Screen>
  );
}
