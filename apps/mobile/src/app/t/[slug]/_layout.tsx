import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ErrorText, Spinner } from "@/components/ui";
import { useTenant } from "@/hooks/useTenant";
import { useTenantStore } from "@/stores/tenantStore";
import { ThemeProvider } from "@/theme";

/** Loads the tenant once and applies its colours to everything below. */
export default function TenantLayout() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const tenant = useTenant(slug);
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  useEffect(() => {
    if (tenant.data) setLast(tenant.data.slug);
  }, [tenant.data, setLast]);
  if (tenant.isLoading) return <Spinner label="Loading institution…" />;
  if (tenant.error || !tenant.data) return <ErrorText error={tenant.error ?? "Institution not found"} />;
  return (
    <ThemeProvider tenant={tenant.data}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
