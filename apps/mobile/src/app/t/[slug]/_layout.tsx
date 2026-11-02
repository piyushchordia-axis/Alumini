import { fatalQueryError } from "@illuminize/shared/client";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { LoadError, Spinner } from "@/components/ui";
import { useTenant } from "@/hooks/useTenant";
import { useTenantStore } from "@/stores/tenantStore";
import { ThemeProvider } from "@/theme";

/** Loads the tenant once and applies its colours to everything below. No anchor here: it would mount the (app) guard under login and register. */
export default function TenantLayout() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const tenant = useTenant(slug);
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  const tenantError = fatalQueryError(tenant);
  if (tenant.isLoading) return <Spinner label="Loading institution…" />;
  if (tenantError || !tenant.data)
    return (
      <LoadError
        error={tenantError ?? "Institution not found"}
        onRetry={() => void tenant.refetch()}
        onBack={() => {
          // Forget it as the start page so the picker does not bounce straight back here.
          setLast(null);
          router.replace("/");
        }}
      />
    );
  return (
    <ThemeProvider tenant={tenant.data}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
