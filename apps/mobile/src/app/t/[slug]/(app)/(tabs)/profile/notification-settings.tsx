import { NOTIFICATION_CATEGORY_INFO, visibleNotificationCategories, type NotificationLevel, type NotificationPrefsDto, type NotificationPrefsUpdate } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { Card, LoadError, Muted, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, useTheme } from "@/theme";

const LEVEL_LABELS: Record<NotificationLevel, string> = { OFF: "Off", IN_APP: "In app", IN_APP_PUSH: "In app + push" };
const RANK: Record<NotificationLevel, number> = { OFF: 0, IN_APP: 1, IN_APP_PUSH: 2 };

function LevelPicker({ label, value, min, onChange }: { label: string; value: NotificationLevel; min: NotificationLevel; onChange: (v: NotificationLevel) => void }) {
  const theme = useTheme();
  const options = (["OFF", "IN_APP", "IN_APP_PUSH"] as const).filter((l) => RANK[l] >= RANK[min]);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 2, alignSelf: "flex-start" }}>
      {options.map((l) => {
        const on = value === l;
        return (
          <Pressable
            key={l}
            accessibilityRole="radio"
            // aria-checked rather than accessibilityState: React Native maps it on devices, and react-native-web only
            // emits the ARIA form.
            aria-checked={on}
            onPress={() => onChange(l)}
            style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: on ? theme.primary : "transparent" }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: on ? "#fff" : colors.muted }}>{LEVEL_LABELS[l]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const { tenant, membership, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const theme = useTheme();
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: qk.notificationPrefs(slug), queryFn: () => api.notifications.prefs(slug) });
  const save = useMutation({
    mutationFn: (input: NotificationPrefsUpdate) => api.notifications.updatePrefs(slug, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: qk.notificationPrefs(slug) });
      const previous = qc.getQueryData<NotificationPrefsDto>(qk.notificationPrefs(slug));
      if (previous) qc.setQueryData(qk.notificationPrefs(slug), { ...previous, ...input, categories: { ...previous.categories, ...input.categories } });
      return { previous };
    },
    onError: (e, _v, c) => {
      if (c?.previous) qc.setQueryData(qk.notificationPrefs(slug), c.previous);
      Alert.alert("Could not save", errorMessage(e));
    },
    onSuccess: (data) => qc.setQueryData(qk.notificationPrefs(slug), data),
  });
  if (prefs.isLoading) return <Spinner />;
  if (prefs.error || !prefs.data) return <LoadError error={prefs.error ?? "Not found"} onRetry={() => void prefs.refetch()} onBack={() => router.back()} backLabel="Back" />;
  const p = prefs.data;
  const categories = visibleNotificationCategories({ features: tenant.settings.features, chatEligible: membership.chatEligible, isTenantAdmin });
  return (
    <Screen title="Notification settings">
      <Muted size={13}>For {tenant.name}. Account notices (approvals, moderation decisions) always reach you.</Muted>
      {categories.map((c) => {
        const info = NOTIFICATION_CATEGORY_INFO[c];
        return (
          <Card key={c}>
            <Text style={{ fontWeight: "700", color: colors.text }}>{info.label}</Text>
            <Muted size={13}>{info.description}</Muted>
            <LevelPicker label={info.label} value={p.categories[c]} min={info.minLevel} onChange={(level) => save.mutate({ categories: { [c]: level } })} />
          </Card>
        );
      })}
      <Card>
        <Text style={{ fontWeight: "700", color: colors.text }}>Email and messages</Text>
        {!p.hasEmail && (
          <Pressable accessibilityRole="link" onPress={() => router.push(`/t/${slug}/profile/account`)}>
            <Text style={{ color: "#92400e" }}>
              Add and confirm an email under <Text style={{ textDecorationLine: "underline", color: theme.primary }}>Email & account</Text> to get these by email.
            </Text>
          </Pressable>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, opacity: p.hasEmail ? 1 : 0.6 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "600" }}>Weekly digest</Text>
            <Muted size={13}>Top posts, new jobs and upcoming events, every Monday morning.</Muted>
          </View>
          <Switch accessibilityLabel="Weekly digest" value={p.digestEmail} disabled={!p.hasEmail} onValueChange={(v) => save.mutate({ digestEmail: v })} trackColor={{ true: theme.primary }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "600" }}>Announcements by email or WhatsApp</Text>
            <Muted size={13}>When admins also send an announcement outside the app.</Muted>
          </View>
          <Switch accessibilityLabel="Announcements by email or WhatsApp" value={p.announcementMessages} onValueChange={(v) => save.mutate({ announcementMessages: v })} trackColor={{ true: theme.primary }} />
        </View>
      </Card>
    </Screen>
  );
}
