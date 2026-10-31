import { COUNTRY_NAME_BY_CODE, PROFESSION_TYPE_LABELS } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Text, View } from "react-native";
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
  if (profile.error || !profile.data) return <LoadError error={profile.error ?? "Not found"} onRetry={() => void profile.refetch()} onBack={() => router.back()} backLabel="Back" />;
  const m = profile.data;
  return (
    <Screen>
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
        {m.bio && <Text style={{ color: "#1e293b", lineHeight: 21 }}>{m.bio}</Text>}
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
        {Object.entries(m.extra).map(([k, v]) => (
          <Muted key={k}>
            {k}: {String(v)}
          </Muted>
        ))}
        <Muted>Member since {formatDate(m.memberSince)}</Muted>
      </Card>
    </Screen>
  );
}
