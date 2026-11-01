import { countryName, PROFESSION_TYPE_LABELS } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useFocusEffect, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Avatar, Badge, Button, Card, Muted, Row, Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { qk } from "@/lib/queryKeys";
import { useDeleteAccount, useSignOut } from "@/lib/session";
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
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  const slug = tenant.slug;
  const signOut = useSignOut();
  const deleteAccount = useDeleteAccount();
  const [deleting, setDeleting] = useState(false);
  // The institution list can change elsewhere (approved, joined on the web), so refresh it whenever this screen shows.
  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: qk.me });
    }, [qc]),
  );
  const confirmDelete = () =>
    Alert.alert("Delete account?", "This removes your Illuminize account and all memberships. It cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteAccount();
          } catch (err) {
            Alert.alert("Could not delete your account", errorMessage(err));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
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
              {membership.country ? `, ${countryName(membership.country)}` : ""}
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
        <Pressable onPress={() => router.push(`/t/${slug}/profile/my-content`)} accessibilityRole="link" hitSlop={6}>
          <Text style={{ color: theme.primary, fontWeight: "600" }}>🗂️ My posts & listings</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/t/${slug}/profile/notifications`)} accessibilityRole="link" hitSlop={6}>
          <Text style={{ color: theme.primary, fontWeight: "600" }}>🔔 Notifications</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/t/${slug}/profile/account`)} accessibilityRole="link" hitSlop={6}>
          <Text style={{ color: theme.primary, fontWeight: "600" }}>✉️ Email & account</Text>
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
                  if (m.status === "APPROVED") setLast(m.tenant.slug);
                  router.replace(`/t/${m.tenant.slug}`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${m.tenant.name}`}
                hitSlop={8}
              >
                <Text style={{ color: theme.primary }}>{m.status === "APPROVED" ? "Switch" : "Open"}</Text>
              </Pressable>
            )}
          </Row>
        ))}
        <Pressable
          onPress={() => {
            setLast(null);
            router.replace("/");
          }}
          accessibilityRole="button"
          hitSlop={6}
        >
          <Text style={{ color: theme.primary }}>+ Join another institution</Text>
        </Pressable>
      </Card>
      <Button title="Sign out" variant="outline" onPress={() => void signOut(`/t/${slug}`)} />
      <Button title="Delete my account" variant="ghost" loading={deleting} onPress={confirmDelete} />
    </Screen>
  );
}
