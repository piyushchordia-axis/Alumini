import { WELCOME_COPY, welcomeDue, welcomeSections, welcomeStepCount, welcomeSteps, welcomeTitle, type MemberSection, type MembershipDto, type ProfileStrengthItem, type WelcomeStep } from "@illuminize/shared";
import { isTransientError } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsFocused, useNavigation, useRouter, type Href } from "expo-router";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { BackHandler, Platform, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BRAND_COVER_OVERLAP, BrandCover } from "@/components/BrandCover";
import { DismissTo } from "@/components/DismissTo";
import { profileItemHref } from "@/components/profile/ProfileStrengthCard";
import { Button, describedBy, focusOn, headingRole, type Focusable } from "@/components/ui";
import { ExploreScreen, HelloScreen, ProfileScreen, StepDots, StepIcon } from "@/components/welcome/WelcomeScreens";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { homeHref, SECTION_TABS } from "@/lib/sections";
import { colors, elevation, PlainPage, radius, spacing, useTheme } from "@/theme";

/**
 * How long a step ignores taps once it opens, as registration's steps do, so the second tap of a double tap lands on
 * nothing: not on the button that took the first one's place (Next becomes Get started), nor on a row.
 */
const SETTLE_MS = 350;

/**
 * The first-entry walk-through, which the front door (entryHref) opens for a member who is owed it: a hello with the
 * institution's welcome message, what to add to their profile, and the sections they can open, as on the web. A screen of
 * the (app) stack above the tabs, like the admin console, plain as the landing screen is. Opened by a redirect from
 * outside the app it is the stack's only screen; opened cold from a link, the tabs (the stack's anchor) mount under it.
 * Every way out leaves through dismissTo, so there's one set of tabs either way, and ends the walk-through: Skip, Get
 * started, Android's back button on the first screen and every link on it. iOS's swipe back is off, on its own screen
 * (the (app) layout) and, while it's in front, on the screens holding its stack (useNoSwipeOut).
 */
export default function WelcomeScreen() {
  const { tenant, membership } = useMembership();
  /**
   * Whether it was owed when the screen opened. Opened when it isn't (a link to it, or a remount after it ended), it goes
   * straight home. Once it's open, only its ways out move on, each once: ending it changes the membership, and leaving on
   * that as well would be a second navigation.
   */
  const [owed] = useState(() => welcomeDue(membership));
  if (!owed) return <DismissTo href={homeHref(tenant.slug, tenant.settings.features)} />;
  return (
    <PlainPage>
      <Walkthrough />
    </PlainPage>
  );
}

/** What useNoSwipeOut needs of a screen's navigation: the screen holding its stack (getParent), and its options. */
type HeldNavigation = { getParent(): HeldNavigation | undefined; setOptions(options: { gestureEnabled: boolean }): void };

/**
 * Turns iOS's swipe back off on every screen holding this one's stack while it's in front. Its own `gestureEnabled:
 * false` isn't enough: opened from the front door it's alone in the (app) stack, which then can't pop, so the swipe
 * goes to the stack holding it and takes the whole app off, back to the landing screen (or the list of institutions),
 * which would only open the walk-through again at its first screen. Put back as it goes.
 */
function useNoSwipeOut(focused: boolean) {
  const navigation = useNavigation<HeldNavigation>();
  useEffect(() => {
    if (Platform.OS !== "ios" || !focused) return;
    const holders: HeldNavigation[] = [];
    for (let holder = navigation.getParent(); holder; holder = holder.getParent()) holders.push(holder);
    for (const holder of holders) holder.setOptions({ gestureEnabled: false });
    // None of them sets it otherwise, so true is what they had: native stack's default on iOS.
    return () => {
      for (const holder of holders) holder.setOptions({ gestureEnabled: true });
    };
  }, [focused, navigation]);
}

function Walkthrough() {
  const { tenant, membership } = useMembership();
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  useNoSwipeOut(focused);
  const slug = tenant.slug;
  const features = tenant.settings.features;
  const sections = welcomeSections(features, membership.chatEligible);
  const steps = welcomeSteps(sections);
  const [at, setAt] = useState(0);
  const index = Math.min(at, steps.length - 1);
  const step: WelcomeStep = steps[index] ?? "hello";
  const last = index === steps.length - 1;
  // Unsettled on arrival too: the tap that opened it may have a second one coming.
  const [settled, setSettled] = useState(false);
  const scroller = useRef<ScrollViewInstance>(null);
  const headingRef = useRef<Focusable>(null);
  const countId = useId();
  const done = useMutation({
    mutationFn: () => api.membership.finishWelcome(slug),
    onSuccess: (m) => qc.setQueryData(qk.membership(slug), m),
    retry: (failures, err) => failures < 2 && isTransientError(err),
  });

  // Each step starts at the top with its heading focused, so a screen reader says where they are and reads on from there.
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
    focusOn(headingRef.current);
  }, [index]);
  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settled, index]);

  const go = (next: number) => {
    setAt(next);
    setSettled(false);
  };

  /**
   * Ends the walk-through here first, then on the server, and leaves for `href`, as every way out does. If the server
   * never hears, nothing is said: it's owed again only the next time the app starts and they come in at the front door,
   * so a member offline is never held here. Dismissed rather than replaced, so the tabs are never stacked twice.
   */
  const leave = (href: Href, withAnchor = false) => {
    qc.setQueryData<MembershipDto>(qk.membership(slug), (m) => m && { ...m, welcomeDoneAt: m.welcomeDoneAt ?? new Date().toISOString() });
    done.mutate();
    router.dismissTo(href, withAnchor ? { withAnchor } : undefined);
  };
  // Skip and Get started.
  const leaveHome = () => leave(homeHref(slug, features));
  // With the anchors, so Back from there goes to My profile (or the tab's list), then the feed.
  const openItem = (item: ProfileStrengthItem) => leave(profileItemHref(slug, item), true);
  const openSection = (section: MemberSection) => leave(`/t/${slug}/${SECTION_TABS[section].path}`, true);

  // Android's back button steps back, and on the first screen skips, rather than leaving it unended under the tabs.
  // Ignored while a step settles, like a tap. Only while this screen is in front, so it's no one else's.
  const onHardwareBack = useEffectEvent(() => {
    if (settled) {
      if (index > 0) go(index - 1);
      else leaveHome();
    }
    return true;
  });
  useEffect(() => {
    if (Platform.OS !== "android" || !focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => onHardwareBack());
    return () => subscription.remove();
  }, [focused]);

  const title = step === "hello" ? welcomeTitle(membership.fullName) : step === "profile" ? WELCOME_COPY.profile.title : WELCOME_COPY.explore.title;
  const count = welcomeStepCount(index, steps.length);
  const settling = settled ? null : styles.settling;
  return (
    <View style={[styles.screen, { backgroundColor: theme.page.color }]}>
      <BrandCover tenant={tenant} compact={index > 0} />
      {/* Over the cover's foot, as the landing's card is. The cover stays put, so the status bar stays on it. */}
      <ScrollView ref={scroller} style={[styles.scroll, settling]} contentContainerStyle={[styles.content, { paddingLeft: spacing.lg + insets.left, paddingRight: spacing.lg + insets.right }]}>
        <View role="main" style={[styles.card, elevation[2]]}>
          <View style={styles.header}>
            <StepIcon step={step} />
            <View style={styles.heading}>
              <View ref={headingRef} tabIndex={-1} accessible accessibilityHint={count} {...describedBy(countId)} {...headingRole(2)} style={styles.focusTarget}>
                <Text style={styles.title}>{title}</Text>
              </View>
              <View style={styles.countRow}>
                <Text nativeID={countId} style={styles.count}>
                  {count}
                </Text>
                <StepDots index={index} count={steps.length} />
              </View>
            </View>
          </View>
          {step === "hello" ? (
            <HelloScreen welcomeMessage={tenant.welcomeMessage} />
          ) : step === "profile" ? (
            <ProfileScreen tenant={tenant} membership={membership} onOpen={openItem} />
          ) : (
            <ExploreScreen tenant={tenant} sections={sections} onOpen={openSection} />
          )}
        </View>
      </ScrollView>
      {/* Fixed above the bottom edge, so it's always in reach, at any text size. At a large one on a narrow phone the
          buttons wrap, the step's own staying at the end. */}
      <View style={[styles.footer, settling, { paddingBottom: spacing.md + insets.bottom, paddingLeft: spacing.lg + insets.left, paddingRight: spacing.lg + insets.right }]}>
        <Button title={WELCOME_COPY.skip} variant="ghost" onPress={leaveHome} style={{ ...styles.button, marginRight: "auto" }} />
        {/* Left out of the first step rather than disabled: there's nothing before it. */}
        {index > 0 && <Button title={WELCOME_COPY.back} variant="outline" onPress={() => go(index - 1)} style={styles.button} />}
        <Button title={last ? WELCOME_COPY.done : WELCOME_COPY.next} onPress={() => (last ? leaveHome() : go(index + 1))} style={styles.button} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1, marginTop: -BRAND_COVER_OVERLAP },
  content: { paddingBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: radius.lg + 4, padding: spacing.xl, gap: spacing.lg },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  heading: { flex: 1, minWidth: 0, gap: 4 },
  // Focused to be read from, not to be acted on: no ring in the browser build, as on the web. Solid, because the
  // browser's own focus style (auto) ignores the width.
  focusTarget: { outlineStyle: "solid", outlineWidth: 0 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: colors.text },
  countRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  count: { fontSize: 13, color: colors.muted },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
  // Grows with the text rather than holding the button's 46 points.
  button: { height: "auto", minHeight: 46, paddingVertical: spacing.sm },
  settling: { pointerEvents: "none" },
});
