import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { ProfileForm } from "@/components/ProfileForm";
import { Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export default function EditProfileScreen() {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const router = useRouter();
  return (
    <Screen>
      <ProfileForm
        tenant={tenant}
        initial={membership}
        submitLabel="Save profile"
        onSubmit={async (values) => {
          const updated = await api.membership.updateMe(tenant.slug, values);
          qc.setQueryData(qk.membership(tenant.slug), updated);
          void qc.invalidateQueries({ queryKey: qk.me });
          Alert.alert("Profile saved");
          router.back();
        }}
      />
    </Screen>
  );
}
