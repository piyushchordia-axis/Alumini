import { countryName } from "@illuminize/shared";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconSpark } from "@/components/icons";
import { Avatar, EmptyState, ErrorText, Input, Spinner } from "@/components/ui";
import { useTenantList } from "@/hooks/useTenant";
import { useAuthStore } from "@/stores/authStore";
import { useTenantStore } from "@/stores/tenantStore";
import { colors, spacing } from "@/theme";

/** First screen: pick your university / college / school. */
export default function TenantPickerScreen() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const tenants = useTenantList(q.trim() || undefined);
  const hydrated = useAuthStore((s) => s.hydrated);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const last = useTenantStore((s) => s.lastTenantSlug);

  if (!hydrated) return <Spinner />;
  if (authed && last) return <Redirect href={`/t/${last}`} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.xl, gap: 6, backgroundColor: "#1d4ed8" }}>
        <View aria-hidden>
          <IconSpark size={32} color="#fff" />
        </View>
        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "700" }}>Illuminize</Text>
        <Text style={{ color: "rgba(255,255,255,0.85)" }}>Your alumni network. Which institution are you from?</Text>
      </View>
      <View style={{ padding: spacing.lg }}>
        <Input placeholder="Search by name or city…" value={q} onChangeText={setQ} autoFocus />
      </View>
      {tenants.isLoading && <Spinner />}
      {tenants.error && (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <ErrorText error={tenants.error} />
        </View>
      )}
      <FlatList
        data={tenants.data ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl }}
        ListEmptyComponent={!tenants.isLoading ? <EmptyState title="No institutions found" description="Ask your alumni office to join Illuminize." /> : undefined}
        renderItem={({ item: t }) => (
          <Pressable onPress={() => router.push(`/t/${t.slug}`)} accessibilityRole="button" accessibilityLabel={t.name} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
            <Avatar name={t.shortName ?? t.name} src={t.logoUrl} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "600", color: colors.text }}>{t.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{[t.city, countryName(t.country)].filter(Boolean).join(", ")}</Text>
            </View>
            <Text style={{ color: colors.faint }}>›</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
