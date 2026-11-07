import { GREYS, WELCOME_COPY, profileStrength, sectionDescription, welcomeProfile, type MemberSection, type MembershipDto, type ProfileStrengthItem, type TenantPublicDto, type WelcomeStep } from "@illuminize/shared";
import { useId, type ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { HubRow } from "@/components/HubRow";
import { IconProfile, IconSearch, IconSpark } from "@/components/icons";
import { ProfileItemLinks, ProfileStrengthMeter } from "@/components/profile/ProfileStrengthCard";
import { SECTION_TABS } from "@/lib/sections";
import { colors, radius, spacing, useTheme } from "@/theme";

const STEP_ICONS: Record<WelcomeStep, (color: string) => ReactElement> = {
  hello: (color) => <IconSpark size={20} color={color} />,
  profile: (color) => <IconProfile size={20} color={color} />,
  explore: (color) => <IconSearch size={20} color={color} />,
};

/** The step's icon, in the ink on the wash, beside its title, as on the web. */
export function StepIcon({ step }: { step: WelcomeStep }) {
  const theme = useTheme();
  return (
    <View aria-hidden style={[styles.icon, { backgroundColor: theme.primaryWash }]}>
      {STEP_ICONS[step](theme.primaryInk)}
    </View>
  );
}

/** Where they are, as dots beside the "1 of 3" line, which says the same to a screen reader: the current one in the ink. */
export function StepDots({ index, count }: { index: number; count: number }) {
  const theme = useTheme();
  return (
    <View aria-hidden style={styles.dots}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, i === index ? { width: 20, backgroundColor: theme.primaryInk } : null]} />
      ))}
    </View>
  );
}

/** The institution's own welcome message, as its landing screen shows it (plain text, line breaks kept), then the lead. */
export function HelloScreen({ welcomeMessage }: { welcomeMessage: string | null }) {
  return (
    <View style={styles.stack}>
      {welcomeMessage ? <Text style={styles.body}>{welcomeMessage}</Text> : null}
      <Text style={styles.body}>{WELCOME_COPY.hello.lead}</Text>
    </View>
  );
}

/**
 * How the profile stands, and the heaviest things missing as links into the parts of Edit profile they're added in.
 * Following one ends the walk-through on the way (`onOpen`), which the line under them says.
 */
export function ProfileScreen({ tenant, membership, onOpen }: { tenant: TenantPublicDto; membership: MembershipDto; onOpen: (item: ProfileStrengthItem) => void }) {
  const hintId = useId();
  const strength = profileStrength(membership, tenant);
  const { items, body } = welcomeProfile(strength);
  const hint = WELCOME_COPY.profile.linksHint(items.length);
  return (
    <View style={styles.stack}>
      <Text style={styles.body}>{body}</Text>
      <ProfileStrengthMeter score={strength.score} />
      {items.length > 0 && (
        <View style={styles.links}>
          <ProfileItemLinks items={items} slug={tenant.slug} onOpen={onOpen} hint={{ id: hintId, text: hint }} />
        </View>
      )}
      <View style={{ gap: 2 }}>
        {items.length > 0 && (
          <Text nativeID={hintId} style={styles.note}>
            {hint}
          </Text>
        )}
        <Text style={styles.note}>{WELCOME_COPY.profile.later}</Text>
      </View>
    </View>
  );
}

/**
 * The sections this member can open, as More's described rows. A list, not navigation, so it's never taken for the
 * app's own. Following one ends the walk-through on the way (`onOpen`).
 */
export function ExploreScreen({ tenant, sections, onOpen }: { tenant: TenantPublicDto; sections: readonly MemberSection[]; onOpen: (section: MemberSection) => void }) {
  return (
    <View style={styles.stack}>
      <Text style={styles.body}>{WELCOME_COPY.explore.body(tenant.shortName ?? tenant.name)}</Text>
      <View role="list">
        {sections.map((section) => {
          const { icon, label } = SECTION_TABS[section];
          return (
            <View key={section} role="listitem">
              <HubRow icon={icon} label={label} description={sectionDescription(section)} onPress={() => onOpen(section)} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Slate-300, as the web's other dots.
  dot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.borderStrong },
  stack: { gap: spacing.md },
  body: { fontSize: 15, lineHeight: 22, color: GREYS.body },
  links: { borderTopWidth: 1, borderTopColor: colors.border },
  note: { fontSize: 13, lineHeight: 18, color: colors.muted },
});
