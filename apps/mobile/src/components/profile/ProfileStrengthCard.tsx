import { PROFILE_NUDGE_SNOOZE_DAYS, missingProfileItems, profileStrength, showProfileNudge, type ProfileStrength, type ProfileStrengthItem } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IconChevronDown, IconProfile } from "@/components/icons";
import { Button, Card, ErrorText, focusOn, headingRole, type Focusable } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, radius, spacing, useTheme } from "@/theme";

/** The profile's score as a bar, read out as "Profile strength, 55% complete". */
export function ProfileStrengthMeter({ score }: { score: number }) {
  const theme = useTheme();
  return (
    <View style={styles.meterRow}>
      <View
        accessible
        accessibilityRole="progressbar"
        aria-label="Profile strength"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-valuetext={`${score}% complete`}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${score}%`, backgroundColor: theme.primary }]} />
      </View>
      <Text aria-hidden style={styles.score}>
        {score}%
      </Text>
    </View>
  );
}

/**
 * Missing items as rows that open the part of the edit screen where each is added. With `withAnchor`: from the feed, the
 * profile stack may not be mounted yet, and would otherwise hold only the edit screen, which Back and Save leave behind.
 */
function ItemLinks({ items, slug }: { items: ProfileStrengthItem[]; slug: string }) {
  const router = useRouter();
  return (
    <View role="list">
      {items.map((item, i) => (
        <View key={item.key} role="listitem" style={i ? styles.divider : null}>
          <Pressable
            onPress={() => router.push(`/t/${slug}/profile/edit?section=${item.section}`, { withAnchor: true })}
            role="link"
            style={({ pressed }) => [styles.item, pressed ? { backgroundColor: colors.bg } : null]}
          >
            <Text style={styles.itemText}>{item.label}</Text>
            <View aria-hidden style={styles.chevron}>
              <IconChevronDown size={16} color={colors.faint} />
            </View>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/**
 * The feed's nudge to fill in the profile: the score and the heaviest few items missing, each opening the edit screen at
 * its section. Gone at PROFILE_STRENGTH_HIDE_AT, and for PROFILE_NUDGE_SNOOZE_DAYS after "Not now" on any device. No text
 * box and no post's role: the feed's first ones are the composer's and the posts'.
 */
export function ProfileStrengthCard() {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const theme = useTheme();
  const statusRef = useRef<Focusable>(null);
  // Hidden as soon as "Not now" is pressed, and back, saying why, if the server refuses.
  const [hidden, setHidden] = useState(false);
  // Says where it went, in its place, as the web app's note does, and takes focus there: "Not now" goes with the card.
  const [status, setStatus] = useStatus();
  useEffect(() => {
    if (status) focusOn(statusRef.current);
  }, [status]);
  const dismiss = useMutation({
    mutationFn: () => api.membership.dismissProfileNudge(tenant.slug),
    onSuccess: (m) => qc.setQueryData(qk.membership(tenant.slug), m),
    onError: () => {
      setHidden(false);
      setStatus(null);
    },
  });
  const strength = profileStrength(membership, tenant);
  if (hidden || !showProfileNudge(strength.score, membership.profileNudgeDismissedAt))
    return status ? (
      <View ref={statusRef} accessible tabIndex={-1} style={styles.status}>
        <Text style={styles.statusText}>{status}</Text>
      </View>
    ) : null;
  return (
    <View role="region" aria-label="Complete your profile">
      <Card style={{ gap: spacing.md }}>
        <View style={styles.header}>
          <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}>
            <IconProfile size={20} color={theme.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text {...headingRole(2)} style={styles.title}>
              Complete your profile
            </Text>
            <Text style={styles.sub}>A fuller profile helps batchmates find you and know what you do.</Text>
          </View>
          <Button
            title="Not now"
            variant="ghost"
            style={styles.notNow}
            onPress={() => {
              setHidden(true);
              setStatus(`Hidden for ${PROFILE_NUDGE_SNOOZE_DAYS} days. My profile always shows what's left to add.`);
              dismiss.mutate();
            }}
          />
        </View>
        <ProfileStrengthMeter score={strength.score} />
        <ErrorText error={dismiss.isError ? `Couldn't hide this: ${errorMessage(dismiss.error)}` : null} />
        <View style={styles.items}>
          <ItemLinks items={missingProfileItems(strength)} slug={tenant.slug} />
        </View>
      </Card>
    </View>
  );
}

/** My profile's meter, always shown: the score and everything still missing, each opening its section of the edit screen. */
export function ProfileStrengthPanel({ strength, slug }: { strength: ProfileStrength; slug: string }) {
  const missing = strength.items.filter((i) => !i.done);
  return (
    <Card style={{ gap: spacing.md }}>
      <Text {...headingRole(2)} style={styles.panelTitle}>
        Profile strength
      </Text>
      <ProfileStrengthMeter score={strength.score} />
      {missing.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <Text style={styles.overline}>Still to add</Text>
          <ItemLinks items={missing} slug={slug} />
        </View>
      ) : (
        <Text style={styles.sub}>Your profile is complete. Members see everything they need to know you.</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  meterRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  track: { flex: 1, height: 8, borderRadius: radius.full, backgroundColor: "#e2e8f0", overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.full },
  score: { minWidth: 40, textAlign: "right", fontSize: 14, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  panelTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  sub: { fontSize: 14, lineHeight: 20, color: colors.muted },
  // A full 44-point target, tucked into the card's corner.
  notNow: { height: 44, paddingHorizontal: spacing.md, marginTop: -spacing.sm, marginRight: -spacing.sm },
  items: { borderTopWidth: 1, borderTopColor: colors.border },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44, paddingVertical: spacing.sm, borderRadius: radius.sm },
  itemText: { flex: 1, fontSize: 15, fontWeight: "500", color: "#1e293b" },
  chevron: { transform: [{ rotate: "-90deg" }] },
  overline: { fontSize: 12, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", color: colors.muted },
  status: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  statusText: { fontSize: 13, color: "#334155" },
});
