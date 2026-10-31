import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { EventForm } from "@/components/forms/EventForm";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";

export default function NewEventScreen() {
  const { tenant, membership } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Screen>
      <EventForm
        slug={tenant.slug}
        defaultCity={membership.city ?? tenant.city}
        submitLabel="Publish event"
        onSubmit={async (input) => {
          const ev = await api.events.create(tenant.slug, input);
          void qc.invalidateQueries({ queryKey: ["events", tenant.slug] });
          Alert.alert(ev.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : "Event published");
          router.replace(`/t/${tenant.slug}/events/${ev.id}`);
        }}
      />
    </Screen>
  );
}
