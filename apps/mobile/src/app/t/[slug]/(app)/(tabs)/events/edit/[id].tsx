import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { EventForm } from "@/components/forms/EventForm";
import { loadingScreen } from "@/components/LoadingScreen";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { usePageQuery } from "@/hooks/usePageQuery";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditEventScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: qk.event(slug, id), queryFn: () => api.events.get(slug, id) });
  const page = usePageQuery(ev);
  // Only with nothing to show: a refetch failing in the background keeps the form and what was typed.
  if (!ev.data) return loadingScreen({ title: "Edit event", shape: "form", page });
  return (
    <Screen title="Edit event">
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
