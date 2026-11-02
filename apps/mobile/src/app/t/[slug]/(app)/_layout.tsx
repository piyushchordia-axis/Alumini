import { fatalQueryError, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { LoadError, Spinner } from "@/components/ui";
import { MembershipContext, useMembershipQuery } from "@/hooks/useMembership";
import { usePushRegistration } from "@/hooks/usePushRegistration";
import { useTenant } from "@/hooks/useTenant";
import { useAuthStore } from "@/stores/authStore";
import { useTenantStore } from "@/stores/tenantStore";

export const unstable_settings = { anchor: "(tabs)" };

/** Membership guard for everything a member sees. A stack, so a later screen can sit above the tabs and still have them to go back to. */
export default function AppLayout() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const authed = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const lastSlug = useTenantStore((s) => s.lastTenantSlug);
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  const tenant = useTenant(slug);
  const membership = useMembershipQuery(slug);
  const membershipError = fatalQueryError(membership);
  const approved = membership.data?.status === "APPROVED";
  const answeredNotApproved = authed && !approved && (!!membership.data || (!!membership.error && !isTransientError(membership.error)));
  usePushRegistration(authed && approved);

  // Remember only institutions the member can open, so the start screen never bounces them back into a waiting or
  // error screen. A network failure or a 5xx is no reason to forget one.
  useEffect(() => {
    if (approved && slug) setLast(slug);
  }, [approved, slug, setLast]);
  // Separate, because re-running the one above when this changes would undo Switch institution, which forgets it while this screen is still mounted.
  useEffect(() => {
    if (answeredNotApproved && lastSlug === slug) setLast(null);
  }, [answeredNotApproved, lastSlug, slug, setLast]);

  // The picker redirects to a remembered institution, so without this the way out of an error screen leads straight back to it.
  const chooseAnother = () => {
    setLast(null);
    router.replace("/");
  };

  if (!hydrated) return <Spinner />;
  if (!authed) return <Redirect href={`/t/${slug}/login`} />;
  if (tenant.isLoading || membership.isLoading) return <Spinner />;
  if (!tenant.data) return <LoadError error={tenant.error ?? "Institution not found"} onRetry={() => void tenant.refetch()} onBack={chooseAnother} />;
  if (membershipError) {
    const notMember = isApiClientError(membershipError) && (membershipError.status === 404 || membershipError.code === "NOT_A_MEMBER");
    if (notMember) return <Redirect href={`/t/${slug}/register`} />;
    return <LoadError error={membershipError} onRetry={() => void membership.refetch()} onBack={chooseAnother} />;
  }
  if (!membership.data) return <Spinner />;
  if (!approved) return <Redirect href={`/t/${slug}/pending`} />;

  const isTenantAdmin = membership.data.role === "TENANT_ADMIN" || !!user?.isPlatformAdmin;
  return (
    <MembershipContext.Provider value={{ tenant: tenant.data, membership: membership.data, isTenantAdmin }}>
      <Stack screenOptions={{ headerShown: false }} />
    </MembershipContext.Provider>
  );
}
