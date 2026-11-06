import { adminConsoleLabel, adminWaitingCount, MORE_HUB_ROWS, MORE_HUB_YOU_TITLE, moreHubGroups, sectionDescription } from "@illuminize/shared";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { HubRow } from "@/components/HubRow";
import { Card, SectionScreen, headingRole } from "@/components/ui";
import { useAdminDashboard } from "@/hooks/useAdminDashboard";
import { useMemberSections } from "@/hooks/useMemberSections";
import { useMembership } from "@/hooks/useMembership";
import { adminHomeHref } from "@/lib/admin";
import { useSignOut } from "@/lib/session";
import { useTenantStore } from "@/stores/tenantStore";
import { spacing, useTheme } from "@/theme";

/**
 * Everything that doesn't fit on the tab bar, grouped and described: the same groups and lines as the web's More sheet,
 * the admin console included. It scrolls, so Sign out stays in reach on a small phone at a large text size.
 */
export default function MoreScreen() {
  const { tenant, isTenantAdmin } = useMembership();
  const router = useRouter();
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  const signOut = useSignOut();
  const slug = tenant.slug;
  const { overflow, toLink, badgeFor, mentorsWayOut } = useMemberSections();
  const admin = useAdminDashboard(slug, { enabled: isTenantAdmin });
  const waiting = admin.data ? adminWaitingCount(admin.data) : 0;
  return (
    <SectionScreen>
      <ScrollView contentContainerStyle={styles.content}>
        {moreHubGroups(overflow).map((group) => (
          <HubGroup key={group.key} title={group.title}>
            {group.sections.map((section) => {
              const { label, icon, href } = toLink(section);
              const badge = badgeFor(section);
              return <HubRow key={section} icon={icon} label={label} description={sectionDescription(section, { mentorsWayOut })} count={badge?.count} countLabel={badge?.label} onPress={() => router.push(href)} />;
            })}
          </HubGroup>
        ))}
        <HubGroup title={MORE_HUB_YOU_TITLE}>
          {/* withAnchor, or a profile stack that isn't mounted yet would hold this one screen, with no back button. */}
          <HubRow icon="posts" {...MORE_HUB_ROWS.myPosts} onPress={() => router.push(`/t/${slug}/profile/my-content`, { withAnchor: true })} />
          <HubRow icon="profile" {...MORE_HUB_ROWS.myProfile} onPress={() => router.push(`/t/${slug}/profile`)} />
          {isTenantAdmin && <HubRow icon="dashboard" {...MORE_HUB_ROWS.adminConsole} count={waiting} countTone="warning" countLabel={adminConsoleLabel(waiting)} onPress={() => router.push(adminHomeHref(slug))} />}
        </HubGroup>
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
      </ScrollView>
    </SectionScreen>
  );
}

/** A titled card of rows. The title sits on the page, so it takes the page's grey. */
function HubGroup({ title, children }: { title: string; children: ReactNode }) {
  const { pageMuted } = useTheme();
  return (
    <View style={styles.group}>
      <Text {...headingRole(2)} style={[styles.heading, { color: pageMuted }]}>
        {title}
      </Text>
      <Card>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  group: { gap: spacing.sm },
  heading: { fontSize: 13, fontWeight: "700", paddingHorizontal: spacing.xs },
});
