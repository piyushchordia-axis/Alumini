import { adminConsoleLabel, adminWaitingCount, chatAvailable, splitSections } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { HubRow } from "@/components/HubRow";
import { Card, SectionScreen } from "@/components/ui";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { useChatBadge } from "@/hooks/useChat";
import { useMembership } from "@/hooks/useMembership";
import { adminHomeHref } from "@/lib/admin";
import { useMentorsWayOut } from "@/lib/mentors";
import { SECTION_TABS, sectionBadges } from "@/lib/sections";
import { useSignOut } from "@/lib/session";
import { useTenantStore } from "@/stores/tenantStore";
import { spacing } from "@/theme";

/** Everything that doesn't fit on the tab bar: the same items as the web's More sheet, the admin console included. */
export default function MoreScreen() {
  const { tenant, membership, isTenantAdmin } = useMembership();
  const router = useRouter();
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  const signOut = useSignOut();
  const slug = tenant.slug;
  const { overflow } = splitSections(tenant.settings.features, membership.chatEligible, { mentorsWayOut: useMentorsWayOut() });
  const badges = sectionBadges(useChatBadge(slug, chatAvailable(tenant.settings.features, membership.chatEligible)).data);
  const admin = useAdminDashboard(slug, { enabled: isTenantAdmin });
  const waiting = admin.data ? adminWaitingCount(admin.data) : 0;
  return (
    <SectionScreen>
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Card>
          {overflow.map((section) => {
            const { path, label, icon } = SECTION_TABS[section];
            const badge = badges[section];
            return <HubRow key={section} icon={icon} label={label} count={badge?.count} countLabel={badge?.label} onPress={() => router.push(`/t/${slug}/${path}`)} />;
          })}
          {/* withAnchor, or a profile stack that isn't mounted yet would hold this one screen, with no back button. */}
          <HubRow icon="posts" label="My posts" onPress={() => router.push(`/t/${slug}/profile/my-content`, { withAnchor: true })} />
          <HubRow icon="profile" label="My profile" onPress={() => router.push(`/t/${slug}/profile`)} />
          {isTenantAdmin && <HubRow icon="dashboard" label="Admin console" count={waiting} countTone="warning" countLabel={adminConsoleLabel(waiting)} onPress={() => router.push(adminHomeHref(slug))} />}
        </Card>
        <Card>
          <HubRow
            icon="switch"
            label="Switch institution"
            onPress={() => {
              setLast(null);
              router.replace("/");
            }}
          />
          <HubRow icon="signOut" label="Sign out" danger onPress={() => void signOut(`/t/${slug}`)} />
        </Card>
      </View>
    </SectionScreen>
  );
}
