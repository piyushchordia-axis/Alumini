import { planChannelsSentence } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { IconChevronRight, IconPalette } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { Button, Card, ErrorText, Muted, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

type Said = { text: string; tone: "info" | "warning" };

const BRANDING_SUMMARY = "Name, colours, logo and cover";

/**
 * The console's settings: what the plan includes, the way to Branding (the web's other tab), then approvals and the
 * feature switches (the web's "Approvals & features" tab). A save refetches the institution too, so the app's sections follow at once: More drops a section
 * switched off, while a screen of it that's open stays until it's next in front (FeatureGate redirects on focus), so the
 * admin isn't pulled out of the console.
 */
export default function AdminSettingsScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: qk.admin.settings(slug), queryFn: () => api.admin.settings.get(slug) });
  // What became of Save. Here rather than in the form, which starts again when the saved settings come back.
  const [said, setSaid] = useStatus<Said>();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.admin.settings(slug) }),
      qc.invalidateQueries({ queryKey: qk.tenant(slug) }),
      qc.invalidateQueries({ queryKey: ["tenants"] }),
      // The console home's approval sentence.
      qc.invalidateQueries({ queryKey: qk.admin.dashboard(slug) }),
    ]);

  if (!q.data) {
    return (
      <AdminScreen title="Settings">
        {/* Only until the first answer: a refetch keeps the form, and what's typed in it. */}
        {q.isLoading && !q.isFetched ? (
          <Spinner label="Loading settings" />
        ) : (
          <>
            <ErrorText error={q.error ?? "Couldn't load the settings"} />
            <Button title="Try again" variant="outline" onPress={() => void q.refetch()} />
          </>
        )}
      </AdminScreen>
    );
  }

  const plan = planChannelsSentence(q.data.outboundChannels);
  return (
    <AdminScreen title="Settings">
      <Card>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>
          {plan.sentence.map((part, i) => (
            <Text key={i} style={part.strong ? { fontWeight: "700", color: colors.text } : undefined}>
              {part.text}
            </Text>
          ))}
        </Text>
        <Muted size={13}>{plan.note}</Muted>
      </Card>
      {/* Its own screen on the phone; the web console's Settings has it as a tab. */}
      <Card>
        <Pressable
          onPress={() => router.push(`/t/${slug}/admin/settings/branding`)}
          accessibilityRole="link"
          accessibilityLabel="Branding"
          accessibilityHint={BRANDING_SUMMARY}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44, opacity: pressed ? 0.6 : 1 })}
        >
          <IconPalette size={18} color={colors.text} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>Branding</Text>
            <Muted size={13}>{BRANDING_SUMMARY}</Muted>
          </View>
          <IconChevronRight size={16} color={colors.faint} />
        </Pressable>
      </Card>
      <SettingsForm
        key={q.data.settings.updatedAt}
        initial={q.data.settings}
        tenantType={tenant.type}
        onInvalid={(text) => setSaid({ text, tone: "warning" })}
        onSubmit={async (input) => {
          // Cleared first, so the same words said again are read out again.
          setSaid(null);
          try {
            await api.admin.settings.update(slug, input);
            setSaid({ text: "Settings saved", tone: "info" });
          } catch (err) {
            setSaid({ text: `Couldn't save: ${errorMessage(err)}`, tone: "warning" });
            // For the form, to mark the switch or box it's about.
            throw err;
          } finally {
            // Refused too: the screen may be stale (Messaging switched off by another admin, say), and the form starts
            // again from what's stored once it changes.
            await refresh();
          }
        }}
      />
      {/* Out here, under Save, rather than in the form: the form starts again after a save, or after a refusal another
          admin's change explains, and this line has to stay (and be read out once). */}
      <StatusLine flush text={said?.text ?? null} tone={said?.tone} />
    </AdminScreen>
  );
}
