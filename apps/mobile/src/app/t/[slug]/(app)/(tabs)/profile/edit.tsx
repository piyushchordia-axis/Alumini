import { PROFILE_SECTIONS, PROFILE_SECTION_TITLES, type MembershipDto, type ProfileFieldDto, type ProfileSection, type TenantPublicDto } from "@illuminize/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, type ComponentRef, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, Text, View, type ScrollViewInstance } from "react-native";
import { ProfileAboutSection, ProfileBasicsSection, ProfileWorkSection } from "@/components/profile/ProfileSections";
import { useProfileDraft } from "@/components/profile/useProfileDraft";
import type { SkillsInputHandle } from "@/components/SkillsInput";
import { Button, Card, ErrorText, Muted, Screen, Spinner, headingRole } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { useProfileFields } from "@/hooks/useProfileFields";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

const DESCRIPTIONS: Record<ProfileSection, string> = {
  basics: "Your photo, name, batch and where you live.",
  work: "What you do now, what you did before, and your skills.",
  about: "Your story, studies, links and what you're open to.",
};

const sectionFrom = (value: unknown): ProfileSection | null => PROFILE_SECTIONS.find((s) => s === value) ?? null;

export default function EditProfileScreen() {
  const { tenant, membership } = useMembership();
  const fields = useProfileFields(tenant.slug);
  // The form starts once the institution's questions are in, so nothing typed or uploaded is lost to a remount.
  if (fields.isLoading)
    return (
      <Screen title="Edit profile">
        <Spinner />
      </Screen>
    );
  return <ProfileEditor tenant={tenant} membership={membership} customFields={fields.data ?? []} />;
}

/**
 * The profile's three sections as headed cards on one page, saved together: from the bar's Save, always in reach, or the
 * button at the end. `?section=work` opens it at that section, as the profile checklist's links do.
 */
function ProfileEditor({ tenant, membership, customFields }: { tenant: TenantPublicDto; membership: MembershipDto; customFields: ProfileFieldDto[] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const theme = useTheme();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scroller = useRef<ScrollViewInstance>(null);
  const skillsRef = useRef<SkillsInputHandle>(null);
  // Each section's card once it's laid out, and the section to show as soon as its card is.
  const cards = useRef(new Map<ProfileSection, ComponentRef<typeof View>>());
  const pending = useRef<ProfileSection | null>(sectionFrom(section));

  /**
   * Scrolls to a section's card, measured where it is now rather than where it was first laid out: a card moves when one
   * above it grows (a past role added), and the web build only reports a change of size. Measured once what's just
   * changed (errors marked, rows opened) has been drawn.
   */
  const show = useCallback((s: ProfileSection, animated = true) => {
    const card = cards.current.get(s);
    if (!card) {
      pending.current = s;
      return;
    }
    pending.current = null;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const content = scroller.current?.getInnerViewRef();
        if (content) card.measureLayout(content, (_x, y) => scroller.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated }));
      }),
    );
  }, []);

  const f = useProfileDraft({
    tenant,
    initial: membership,
    customFields,
    skillsRef,
    onSubmit: async (values) => {
      const updated = await api.membership.updateMe(tenant.slug, values);
      qc.setQueryData(qk.membership(tenant.slug), updated);
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: ["directory", tenant.slug] });
      void qc.invalidateQueries({ queryKey: qk.member(tenant.slug, updated.id) });
      // No dialog to dismiss: My profile (or the feed's card) shows what was saved. A screen reader hears it.
      if (Platform.OS !== "web") AccessibilityInfo.announceForAccessibility("Profile saved");
      router.back();
    },
    // A problem with no input of its own is said beside the button at the end, once it's drawn there.
    onRefused: (s) => (s ? show(s) : requestAnimationFrame(() => requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true })))),
  });

  // A link to another section while the screen is open (the param changes, the screen stays). The first one waits for
  // its card's first layout instead (pending), and goes there without animating.
  useEffect(() => {
    const s = sectionFrom(section);
    if (s && s !== pending.current) show(s);
  }, [section, show]);

  const card = (id: ProfileSection, body: ReactNode) => (
    <View
      key={id}
      ref={(node) => {
        if (node) cards.current.set(id, node);
        else cards.current.delete(id);
      }}
      onLayout={() => {
        if (pending.current === id) show(id, false);
      }}
    >
      <Card style={{ gap: spacing.md }}>
        <View style={{ gap: 2 }}>
          <Text {...headingRole(2)} style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
            {PROFILE_SECTION_TITLES[id]}
          </Text>
          <Muted size={13}>{DESCRIPTIONS[id]}</Muted>
        </View>
        {body}
      </Card>
    </View>
  );

  const save = () => void f.submit();
  return (
    <Screen
      title="Edit profile"
      scrollRef={scroller}
      actions={
        <Pressable
          onPress={save}
          disabled={f.photoBusy || f.busy}
          accessibilityRole="button"
          accessibilityLabel="Save profile"
          accessibilityHint="Saves all three sections at once."
          aria-disabled={f.photoBusy || f.busy}
          aria-busy={f.busy}
          style={({ pressed }) => ({ minWidth: 64, minHeight: 44, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: pressed ? colors.bg : "transparent", opacity: f.photoBusy ? 0.5 : 1 })}
        >
          {f.busy ? <ActivityIndicator color={theme.primary} /> : <Text style={{ fontSize: 16, fontWeight: "700", color: theme.primary }}>Save</Text>}
        </Pressable>
      }
    >
      {card("basics", <ProfileBasicsSection form={f} />)}
      {card("work", <ProfileWorkSection form={f} skillsRef={skillsRef} />)}
      {card("about", <ProfileAboutSection form={f} />)}
      <ErrorText error={f.serverError} />
      <Muted size={13}>{f.photoBusy ? "Wait for the photo to finish uploading." : "Saves all three sections at once."}</Muted>
      <Button title="Save profile" onPress={save} loading={f.busy} disabled={f.photoBusy} />
    </Screen>
  );
}
