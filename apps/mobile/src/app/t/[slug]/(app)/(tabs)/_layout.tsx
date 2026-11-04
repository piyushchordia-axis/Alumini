import { chatAvailable, MEMBER_SECTIONS, splitSections, type MemberSection } from "@illuminize/shared";
import type { ChatBadgeLabel } from "@illuminize/shared/chat";
import { Tabs, useIsFocused, useSegments } from "expo-router";
import { PlatformPressable } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import type { ColorValue, ViewStyle } from "react-native";
import { Platform, View } from "react-native";
import { NavIcon, type NavIconName } from "@/components/icons";
import { useChatBadge } from "@/hooks/useChat";
import { useMembership } from "@/hooks/useMembership";
import { useMentorsWayOut } from "@/lib/mentors";
import { SECTION_TABS, sectionBadges } from "@/lib/sections";
import { colors, useTheme } from "@/theme";

const LABEL_STYLE = { fontSize: 11, fontWeight: "600" } as const;

/**
 * On web, inactive tab scenes stay in the DOM with only z-index; nested search bars can still paint over the focused
 * tab. Hide unfocused scenes completely there. Native uses react-native-screens detachment instead.
 */
function TabScene({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  if (Platform.OS !== "web") return <>{children}</>;
  const style: ViewStyle = { flex: 1, display: focused ? "flex" : "none" };
  return <View style={style}>{children}</View>;
}

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

function TabIcon({ name, active, color }: { name: NavIconName; active: boolean; color?: ColorValue }) {
  return <NavIcon name={name} size={22} color={active ? color : colors.muted} />;
}

/** On the icon, so the label below keeps its room. The tab's name carries the count for screen readers. */
const tabBadge = (badge: ChatBadgeLabel | undefined) =>
  badge && badge.count > 0 ? { tabBarAccessibilityLabel: badge.label, tabBarBadge: badge.count > 99 ? "99+" : badge.count, tabBarBadgeStyle: BADGE_STYLE } : {};

/** The member tabs: four sections, then More. Each tab's stack draws its own header (see AppHeader). */
export default function TabsLayout() {
  const { tenant, membership } = useMembership();
  const theme = useTheme();
  const segments: string[] = useSegments();
  // Mentors stays behind More while this member can't use mentorship but still has something there to leave.
  const { bar, overflow } = splitSections(tenant.settings.features, membership.chatEligible, { mentorsWayOut: useMentorsWayOut() });
  const badgeData = useChatBadge(tenant.slug, chatAvailable(tenant.settings.features, membership.chatEligible)).data;
  const badges = sectionBadges(badgeData);
  // A section behind More has its badge in the More hub, so More says there's something inside, and what.
  const moreBadges = overflow.map((s) => badges[s]).filter((b): b is ChatBadgeLabel => !!b && b.count > 0);
  const moreBadge: ChatBadgeLabel = { count: moreBadges.reduce((sum, b) => sum + b.count, 0), label: `More, ${moreBadges.map((b) => b.label).join(", ")}` };
  const badgeFor = (section: MemberSection) => tabBadge(bar.includes(section) ? badges[section] : undefined);
  // Mentors stays reachable while it's off for this member, with no button, so a link to it (a push, say) still opens the
  // screen that says so (see the Mentors screen). Declared after the profile, so a link to a section that's off never
  // redirects to it. With something there to leave, it's in More instead, above.
  const mentorsOff = !bar.includes("mentors") && !overflow.includes("mentors");
  // A focused tab with no button highlights nothing, so More stands in for the screens reached through it.
  const tab = segments[segments.indexOf("(tabs)") + 1];
  const moreActive = tab === "profile" || overflow.some((s) => SECTION_TABS[s].path === tab) || (mentorsOff && tab === SECTION_TABS.mentors.path);
  return (
    <Tabs
      backBehavior="history"
      detachInactiveScreens
      screenLayout={({ children }) => <TabScene>{children}</TabScene>}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: LABEL_STYLE,
        tabBarStyle: { backgroundColor: "rgba(255,255,255,0.96)", borderTopColor: colors.border },
      }}
    >
      {/* Every route folder needs a screen here: without one, opening it redirects to the first tab. */}
      {MEMBER_SECTIONS.map((section) => {
        if (section === "mentors" && mentorsOff) return null;
        const { path, label, icon } = SECTION_TABS[section];
        const visibility = bar.includes(section) ? {} : overflow.includes(section) ? NO_BUTTON : { href: null };
        return (
          <Tabs.Screen
            key={section}
            name={path}
            options={{
              title: label,
              tabBarIcon: ({ focused, color }) => <TabIcon name={icon} active={focused} color={color} />,
              ...badgeFor(section),
              ...visibility,
            }}
          />
        );
      })}
      {/* Reached from the header (avatar and bell) and from More. Declared before More because a link to a section that is
          off redirects to the first screen that isn't hidden, and with every section off that must be this one, their home. */}
      <Tabs.Screen name="profile" options={{ title: "Profile", ...NO_BUTTON }} />
      {mentorsOff && <Tabs.Screen key="mentors" name={SECTION_TABS.mentors.path} options={{ title: SECTION_TABS.mentors.label, ...NO_BUTTON }} />}
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          ...tabBadge(moreBadge),
          tabBarIcon: ({ focused, color }) => <TabIcon name="more" active={focused || moreActive} color={moreActive ? theme.primary : color} />,
          tabBarLabelStyle: moreActive ? { ...LABEL_STYLE, color: theme.primary } : LABEL_STYLE,
          tabBarButton: (props) => <PlatformPressable {...props} aria-selected={moreActive || props["aria-selected"]} />,
        }}
      />
    </Tabs>
  );
}
