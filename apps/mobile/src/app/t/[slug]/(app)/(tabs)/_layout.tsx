import { MEMBER_SECTIONS, splitSections, type MemberSection } from "@illuminize/shared";
import { chatBadgeLabel } from "@illuminize/shared/chat";
import { Tabs, useSegments } from "expo-router";
import { PlatformPressable } from "expo-router/react-navigation";
import { type ColorValue, Text } from "react-native";
import { useChatBadge } from "@/hooks/useChat";
import { useMembership } from "@/hooks/useMembership";
import { SECTION_TABS } from "@/lib/sections";
import { colors, useTheme } from "@/theme";

const LABEL_STYLE = { fontSize: 11, fontWeight: "600" } as const;

/**
 * The tab under a screen opened straight from a link or a push, such as a thread above the tabs, so going back lands
 * somewhere real. Without it, it would be the first folder by name. A feed that's switched off sends the member on home.
 */
export const unstable_settings = { anchor: "feed" };

/**
 * A screen stays reachable with no button of its own. Not `href: null`: expo-router treats that as a hidden screen and
 * redirects away from it. Never both on one screen, because `href` and `tabBarButton` together throw.
 */
const NO_BUTTON = { tabBarButton: () => null, tabBarItemStyle: { display: "none" } } as const;

const BADGE_STYLE = { backgroundColor: colors.danger, color: "#fff", fontSize: 10, fontWeight: "700" } as const;

function TabIcon({ icon, active, color }: { icon: string; active: boolean; color?: ColorValue }) {
  return <Text style={{ fontSize: 20, opacity: active ? 1 : 0.6, color }}>{icon}</Text>;
}

/** The member tabs: four sections, then More. Each tab's stack draws its own header (see AppHeader). */
export default function TabsLayout() {
  const { tenant, membership } = useMembership();
  const theme = useTheme();
  const segments: string[] = useSegments();
  const { bar, overflow } = splitSections(tenant.settings.features, membership.chatEligible);
  const chatBadge = chatBadgeLabel(useChatBadge(tenant.slug, tenant.settings.features.messaging && membership.chatEligible).data);
  // On the icon, so the label below keeps its room. The tab's name carries the count for screen readers.
  const badgeFor = (section: MemberSection) =>
    section === "messages" && chatBadge.count > 0 ? { tabBarAccessibilityLabel: chatBadge.label, tabBarBadge: chatBadge.count > 99 ? "99+" : chatBadge.count, tabBarBadgeStyle: BADGE_STYLE } : {};
  // A focused tab with no button highlights nothing, so More stands in for the screens reached through it.
  const tab = segments[segments.indexOf("(tabs)") + 1];
  const moreActive = tab === "profile" || overflow.some((s) => SECTION_TABS[s].path === tab);
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: LABEL_STYLE,
      }}
    >
      {/* Every route folder needs a screen here: without one, opening it redirects to the first tab. */}
      {MEMBER_SECTIONS.map((section) => {
        const { path, label, icon } = SECTION_TABS[section];
        const visibility = bar.includes(section) ? {} : overflow.includes(section) ? NO_BUTTON : { href: null };
        return <Tabs.Screen key={section} name={path} options={{ title: label, tabBarIcon: ({ focused }) => <TabIcon icon={icon} active={focused} />, ...badgeFor(section), ...visibility }} />;
      })}
      {/* Reached from the header (avatar and bell) and from More. Declared before More because a link to a section that is
          off redirects to the first screen that isn't hidden, and with every section off that must be this one, their home. */}
      <Tabs.Screen name="profile" options={{ title: "Profile", ...NO_BUTTON }} />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ focused, color }) => <TabIcon icon="☰" active={focused || moreActive} color={moreActive ? theme.primary : color} />,
          tabBarLabelStyle: moreActive ? { ...LABEL_STYLE, color: theme.primary } : LABEL_STYLE,
          tabBarButton: (props) => <PlatformPressable {...props} aria-selected={moreActive || props["aria-selected"]} />,
        }}
      />
    </Tabs>
  );
}
