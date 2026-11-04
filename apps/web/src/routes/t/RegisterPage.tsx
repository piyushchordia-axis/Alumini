import { fatalQueryError, isApiClientError } from "@illuminize/shared/client";
import type { MembershipDto } from "@illuminize/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { IconSpark } from "@/components/icons";
import { AuthShell } from "@/components/layout/AuthShell";
import { RegistrationSteps } from "@/components/profile/RegistrationSteps";
import { ErrorBox, Loading } from "@/components/ui";
import { useMe } from "@/hooks/useMe";
import { useMembershipQuery } from "@/hooks/useMembership";
import { useProfileFields } from "@/hooks/useProfileFields";
import { useTenant } from "@/hooks/useTenant";
import { useTenantSlug } from "@/hooks/useTenantSlug";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { applyTenantTheme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "@/stores/uiStore";

/**
 * Waiting for the first answer of a query the form can do without. Once one has come, even an error, a refetch never
 * brings the spinner back: a query with no data goes back to loading when it refetches, which would swap the form, and
 * everything typed in it, for the spinner and start it again empty.
 */
const loadingFirstTime = (q: { isLoading: boolean; isFetched: boolean }) => q.isLoading && !q.isFetched;

export function RegisterPage() {
  const slug = useTenantSlug();
  const tenant = useTenant(slug);
  // Nothing here refetches behind the form: with no membership cached, a refetch shows the spinner and loses what they've typed.
  const membership = useMembershipQuery(slug, { refetchOnWindowFocus: false, refetchOnReconnect: false });
  const fields = useProfileFields(slug);
  // An invitation for my (verified) phone: prefill, and allowed in even when registration is closed.
  const invitation = useQuery({ queryKey: qk.myInvitation(slug), queryFn: () => api.membership.invitation(slug), staleTime: 60_000 });
  // Their profile at another institution, for "Use details from …". Without it the form simply doesn't offer that.
  const copy = useQuery({ queryKey: qk.profileCopy(slug), queryFn: () => api.me.profileCopy(slug), staleTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  // Fetched afresh: the name given when joining another institution this session isn't in the stored session yet.
  const me = useMe();
  const storedName = useAuthStore((s) => s.user?.displayName ?? null);
  const displayName = me.data?.user.displayName ?? storedName;
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    if (tenant.data) applyTenantTheme(tenant.data);
  }, [tenant.data]);

  // Without the institution or the membership's answer there's no form yet (and the membership never refetches here).
  if (tenant.isLoading || membership.isLoading || [fields, invitation, copy, me].some(loadingFirstTime)) return <Loading />;
  const tenantError = fatalQueryError(tenant);
  if (tenantError || !tenant.data) return <ErrorBox error={tenantError ?? "Not found"} className="m-6" />;
  const membershipError = fatalQueryError(membership);
  const notMember = isApiClientError(membershipError) && membershipError.status === 404;
  const existing = membership.data;
  if (existing && existing.status !== "REJECTED") return <Navigate to={existing.status === "APPROVED" ? `/t/${slug}/app` : `/t/${slug}/pending`} replace />;
  if (membershipError && !notMember) return <ErrorBox error={membershipError} className="m-6" />;

  const t = tenant.data;
  const reapplying = existing?.status === "REJECTED";
  const inv = invitation.data ?? null;
  // An invitation names them; otherwise the name they gave another institution (or an earlier sign-up) starts them off.
  const prefill: Partial<MembershipDto> | undefined = existing
    ? existing
    : inv
      ? // The form reads only each answer's key and value.
        ({ fullName: inv.fullName ?? displayName ?? undefined, batchYear: inv.batchYear ?? undefined, fields: Object.entries(inv.fields).map(([key, value]) => ({ key, value })) } as Partial<MembershipDto>)
      : displayName
        ? { fullName: displayName }
        : undefined;
  // As the server decides: an invitation the institution lets straight in, or an institution that lets everyone in.
  const autoApprove = (inv?.autoApprove ?? false) || t.settings.memberApprovalMode === "AUTO_APPROVE";
  return (
    <AuthShell tenant={t} title={reapplying ? "Re-apply to join" : "Create your profile"} subtitle={reapplying ? "Update your profile, then send it again" : "Tell your batchmates who you are"} wide>
      {!t.settings.allowSelfRegistration && !inv ? (
        <ErrorBox error="This institution is not accepting new registrations right now. Contact your alumni office." />
      ) : (
        <RegistrationSteps
          tenant={t}
          initial={prefill}
          customFields={fields.data ?? []}
          submitLabel={autoApprove ? "Join the network" : "Submit for approval"}
          needsApproval={!autoApprove}
          reapplying={reapplying}
          copy={copy.data ?? null}
          notice={
            reapplying ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
                <p className="font-semibold">Your last application wasn't approved</p>
                <p className="mt-0.5">{existing?.statusReason ? `Reason: ${existing.statusReason}` : "No reason was given."}</p>
              </div>
            ) : undefined
          }
          intro={
            inv ? (
              <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
                <IconSpark size={18} className="mt-0.5" />
                <span>
                  You were invited to {t.name}. {autoApprove ? "You'll be in as soon as you finish your profile." : "Finish your profile and an admin will approve it."}
                </span>
              </p>
            ) : undefined
          }
          onSubmit={async (values) => {
            const m = await api.membership.register(slug, values);
            qc.setQueryData(qk.membership(slug), m);
            await qc.invalidateQueries({ queryKey: qk.me });
            toast.success(m.status === "APPROVED" ? `Welcome to ${t.name}!` : "Submitted for approval");
            navigate(m.status === "APPROVED" ? `/t/${slug}/app` : `/t/${slug}/pending`, { replace: true });
          }}
        />
      )}
    </AuthShell>
  );
}
