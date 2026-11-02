import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { ProfileForm } from "@/components/ProfileForm";
import { Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { useProfileFields } from "@/hooks/useProfileFields";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditProfileScreen() {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const router = useRouter();
  const fields = useProfileFields(tenant.slug);
  if (fields.isLoading) return <Spinner />;
  return (
    <Screen>
      <ProfileForm
        tenant={tenant}
        initial={membership}
        customFields={fields.data ?? []}
        submitLabel="Save profile"
        onSubmit={async (values) => {
          const updated = await api.membership.updateMe(tenant.slug, values);
          qc.setQueryData(qk.membership(tenant.slug), updated);
          void qc.invalidateQueries({ queryKey: qk.me });
          void qc.invalidateQueries({ queryKey: ["directory", tenant.slug] });
          void qc.invalidateQueries({ queryKey: qk.member(tenant.slug, updated.id) });
          Alert.alert("Profile saved");
          router.back();
        }}
      />
    </Screen>
  );
}
