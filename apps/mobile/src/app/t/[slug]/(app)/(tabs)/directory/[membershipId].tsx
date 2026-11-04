import { COUNTRY_NAME_BY_CODE, PROFESSION_TYPE_LABELS } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Text, View } from "react-native";
import { MessageMemberButton, ProfileBlockButton } from "@/components/chat/MemberChatActions";
import { RichText } from "@/components/RichText";
import { Avatar, Badge, Button, Card, LoadError, Muted, Row, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors } from "@/theme";

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
  return (
    <Screen title="Member">
      <Card>
        <View style={{ alignItems: "center", gap: 8 }}>
          <Avatar name={m.fullName} src={m.avatarUrl} size={88} />
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.text, textAlign: "center" }}>{m.fullName}</Text>
          <Row style={{ justifyContent: "center" }}>
            {m.role === "TENANT_ADMIN" && <Badge label="Admin" tone="primary" />}
            {m.isOpenToWork && <Badge label="Open to work" tone="success" />}
          </Row>
          <Muted size={14}>
            {m.designation ?? PROFESSION_TYPE_LABELS[m.professionType]}
            {m.companyName ? ` at ${m.companyName}` : ""}
          </Muted>
          <Muted>
            Batch of {m.batchYear}
            {m.city ? ` · ${m.city}` : ""}
            {m.country ? `, ${COUNTRY_NAME_BY_CODE[m.country] ?? m.country}` : ""}
          </Muted>
        </View>
        {m.id === membership.id && <Button title="Edit my profile" variant="outline" onPress={() => router.push(`/t/${slug}/profile/edit`)} />}
        {chatOn && m.canMessage && <MessageMemberButton slug={slug} member={m} />}
        <RichText text={m.bio} style={{ fontSize: 14, lineHeight: 21, color: "#1e293b" }} />
        {m.interests.length > 0 && (
          <Row>
            {m.interests.map((i) => (
              <Badge key={i} label={i} />
            ))}
          </Row>
        )}
        {m.phone && (
          <Row>
            <Button title={`📞 ${m.phone}`} variant="outline" onPress={() => void Linking.openURL(`tel:${m.phone}`)} style={{ flex: 1 }} />
            <Button title="WhatsApp" onPress={() => void Linking.openURL(`https://wa.me/${m.phone!.replace(/\D/g, "")}`)} />
          </Row>
        )}
        {m.linkedinUrl && <Button title="LinkedIn ↗" variant="outline" onPress={() => void Linking.openURL(m.linkedinUrl!)} />}
        {m.fields.map((f) => (
          <Text key={f.key} style={{ color: "#334155" }}>
            <Text style={{ color: "#64748b" }}>{f.label}: </Text>
            {f.display}
          </Text>
        ))}
        <Muted>Member since {formatDate(m.memberSince)}</Muted>
        {canBlock && (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
            <ProfileBlockButton slug={slug} member={m} />
          </View>
        )}
      </Card>
    </Screen>
  );
}
