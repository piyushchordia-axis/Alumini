import { COUNTRY_NAME_BY_CODE, PROFESSION_TYPE_LABELS } from "@illuminize/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert, Pressable, Text, View } from "react-native";
import { Avatar, Badge, Button, Card, Muted, Row, Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useTenantStore } from "@/stores/tenantStore";
import { colors, useTheme } from "@/theme";

export default function MyProfileScreen() {
  const { tenant, membership, isTenantAdmin } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const clear = useAuthStore((s) => s.clear);
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  const slug = tenant.slug;
  const signOut = async () => {
    await api.auth.logout();
    clear();
    qc.clear();
    router.replace(`/t/${slug}`);
  };
  return (
    <Screen>
      <Card>
        <Row gap={12}>
          <Avatar name={membership.fullName} src={membership.avatarUrl} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{membership.fullName}</Text>
            <Muted size={13}>
              {membership.designation ?? PROFESSION_TYPE_LABELS[membership.professionType]}
              {membership.companyName ? ` at ${membership.companyName}` : ""}
            </Muted>
            <Muted>
              Batch of {membership.batchYear}
              {membership.city ? ` · ${membership.city}` : ""}
              {membership.country ? `, ${COUNTRY_NAME_BY_CODE[membership.country] ?? membership.country}` : ""}
            </Muted>
          </View>
        </Row>
        {membership.bio && <Text style={{ color: "#334155", lineHeight: 20 }}>{membership.bio}</Text>}
        <Row>
          {membership.role === "TENANT_ADMIN" && <Badge label="Admin" tone="primary" />}
          <Muted>{user?.phone}</Muted>
        </Row>
        <Button title="Edit profile" variant="outline" onPress={() => router.push(`/t/${slug}/profile/edit`)} />
      </Card>
      <Card>
        <Pressable onPress={() => router.push(`/t/${slug}/profile/my-content`)}>
          <Text style={{ color: theme.primary, fontWeight: "600" }}>🗂️ My posts & listings</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/t/${slug}/profile/notifications`)}>
          <Text style={{ color: theme.primary, fontWeight: "600" }}>🔔 Notifications</Text>
        </Pressable>
        {isTenantAdmin && <Muted>Admin tools (approvals, moderation, settings) are available on the web console.</Muted>}
      </Card>
      <Card>
        <Text style={{ fontWeight: "700", color: colors.text }}>Your institutions</Text>
        {memberships.map((m) => (
          <Row key={m.id} style={{ justifyContent: "space-between" }}>
            <Row gap={8}>
              <Avatar name={m.tenant.shortName ?? m.tenant.name} src={m.tenant.logoUrl} size={28} />
              <Text style={{ color: colors.text }}>
                {m.tenant.name} <Muted>· {m.status.toLowerCase()}</Muted>
              </Text>
            </Row>
            {m.tenant.slug !== slug && (
              <Pressable
                onPress={() => {
                  setLast(m.tenant.slug);
                  router.replace(`/t/${m.tenant.slug}`);
                }}
              >
                <Text style={{ color: theme.primary }}>Switch</Text>
              </Pressable>
            )}
          </Row>
        ))}
        <Pressable
          onPress={() => {
            setLast(null);
            router.replace("/");
          }}
        >
          <Text style={{ color: theme.primary }}>+ Join another institution</Text>
        </Pressable>
      </Card>
      <Button title="Sign out" variant="outline" onPress={() => void signOut()} />
      <Button
        title="Delete my account"
        variant="ghost"
        onPress={() =>
          Alert.alert("Delete account?", "This removes your Illuminize account and all memberships. It cannot be undone.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: async () => {
                await api.me.deleteAccount();
                clear();
                qc.clear();
                router.replace("/");
              },
            },
          ])
        }
      />
    </Screen>
  );
}
