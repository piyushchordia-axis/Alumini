import { splitSections } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { Pressable, Text } from "react-native";
import { Card, Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { SECTION_TABS } from "@/lib/sections";
import { useSignOut } from "@/lib/session";
import { useTenantStore } from "@/stores/tenantStore";
import { colors, spacing } from "@/theme";

function HubRow({ icon, label, danger, onPress }: { icon: string; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={label} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontSize: 20 }}>{icon}</Text>
      <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: danger ? colors.danger : colors.text }}>{label}</Text>
      {!danger && <Text style={{ color: colors.faint }}>›</Text>}
    </Pressable>
  );
}

/** Everything that doesn't fit on the tab bar: the same items as the web's More sheet, minus the web-only admin console. */
export default function MoreScreen() {
  const { tenant, membership } = useMembership();
  const router = useRouter();
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  const signOut = useSignOut();
  const slug = tenant.slug;
  const { overflow } = splitSections(tenant.settings.features, membership.chatEligible);
  return (
    <Screen>
      <Card>
        {overflow.map((section) => {
          const { path, label, icon } = SECTION_TABS[section];
          return <HubRow key={section} icon={icon} label={label} onPress={() => router.push(`/t/${slug}/${path}`)} />;
        })}
        {/* withAnchor, or a profile stack that isn't mounted yet would hold this one screen, with no back button. */}
        <HubRow icon="🗂️" label="My posts" onPress={() => router.push(`/t/${slug}/profile/my-content`, { withAnchor: true })} />
        <HubRow icon="👤" label="My profile" onPress={() => router.push(`/t/${slug}/profile`)} />
      </Card>
      <Card>
        <HubRow
          icon="🔁"
          label="Switch institution"
          onPress={() => {
            setLast(null);
            router.replace("/");
          }}
        />
        <HubRow icon="🚪" label="Sign out" danger onPress={() => void signOut(`/t/${slug}`)} />
      </Card>
    </Screen>
  );
}
