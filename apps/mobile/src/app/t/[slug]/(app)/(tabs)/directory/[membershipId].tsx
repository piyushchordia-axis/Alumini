import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Text, View } from "react-native";
import { MessageMemberButton, ProfileBlockButton } from "@/components/chat/MemberChatActions";
import { ProfileDetails, ProfileSummary } from "@/components/profile/ProfileDetails";
import { Badge, Button, Card, LoadError, Muted, Row, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

export default function MemberProfileScreen() {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const { membershipId = "" } = useLocalSearchParams<{ membershipId: string }>();
  const router = useRouter();
  const profile = useQuery({ queryKey: qk.member(slug, membershipId), queryFn: () => api.directory.profile(slug, membershipId) });
  if (profile.isLoading) return <Spinner />;
  // Only with nothing to show: a refetch failing in the background keeps the profile on screen.
  if (!profile.data) return <LoadError error={profile.error ?? "Not found"} onRetry={() => void profile.refetch()} onBack={() => router.back()} backLabel="Back" />;
  const m = profile.data;
  // Blocking doesn't depend on messages being on: an institution may switch them off in the middle of an incident.
  const canBlock = m.id !== membership.id && membership.chatEligible;
  const chatOn = canBlock && tenant.settings.features.messaging;
  const divider = { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.lg, marginTop: spacing.xs };
  return (
    <Screen title="Member">
      <Card style={{ gap: spacing.md }}>
        <ProfileSummary profile={m} nameExtras={m.role === "TENANT_ADMIN" && <Badge label="Admin" tone="primary" />} />
        {m.id === membership.id && <Button title="Edit my profile" variant="outline" onPress={() => router.push(`/t/${slug}/profile/edit`, { withAnchor: true })} />}
        {chatOn && m.canMessage && <MessageMemberButton slug={slug} member={m} />}
        <ProfileDetails profile={m} tenant={tenant} style={divider} />
        {/* The phone, the institution's questions and since when, in the order the web app lists them. */}
        <View style={[{ gap: spacing.sm }, divider]}>
          {m.phone && (
            <Row>
              <Button title={`Call ${m.phone}`} variant="outline" onPress={() => void Linking.openURL(`tel:${m.phone}`)} style={{ flex: 1 }} />
              <Button title="WhatsApp" onPress={() => void Linking.openURL(`https://wa.me/${m.phone!.replace(/\D/g, "")}`)} />
            </Row>
          )}
          {m.fields.map((f) => (
            <Text key={f.key} style={{ color: "#334155" }}>
              <Text style={{ color: "#64748b" }}>{f.label}: </Text>
              {f.display}
            </Text>
          ))}
          <Muted>Member since {formatDate(m.memberSince)}</Muted>
        </View>
        {canBlock && (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
            <ProfileBlockButton slug={slug} member={m} />
          </View>
        )}
      </Card>
    </Screen>
  );
}
