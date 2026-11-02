import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { EventForm } from "@/components/forms/EventForm";
import { LoadError, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditEventScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: qk.event(slug, id), queryFn: () => api.events.get(slug, id) });
  if (ev.isLoading) return <Spinner />;
  if (ev.error || !ev.data) return <LoadError error={ev.error ?? "Not found"} onRetry={() => void ev.refetch()} onBack={() => router.back()} backLabel="Back" />;
  return (
    <Screen>
      <EventForm
        slug={slug}
        initial={ev.data}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          const updated = await api.events.update(slug, id, input);
          qc.setQueryData(qk.event(slug, id), updated);
          void qc.invalidateQueries({ queryKey: ["events", slug] });
          if (updated.moderationStatus === "PENDING") Alert.alert("Saved — awaiting admin approval");
          router.back();
        }}
      />
    </Screen>
  );
}
