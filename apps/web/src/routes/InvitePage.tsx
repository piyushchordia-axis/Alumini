import { errorMessage } from "@illuminize/shared/client";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Avatar, Card, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { useIsAuthenticated } from "@/stores/authStore";

/**
 * Opened from an invitation message (/i/:token). Shows who invited you, then sends you to sign in with the invited
 * number and on to registration, where the invitation is applied (matched by the verified phone, not this token).
 */
export function InvitePage() {
  const { token = "" } = useParams();
  const authed = useIsAuthenticated();
  const invite = useQuery({ queryKey: ["invite", token], queryFn: () => api.tenants.invite(token), retry: false });
  if (invite.isLoading) return <Loading />;
  if (invite.error || !invite.data) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <Card className="w-full max-w-md p-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Invitation not available</h1>
          <p className="mt-2 text-sm text-slate-600">{errorMessage(invite.error ?? "This invitation link is no longer valid.")} Ask your alumni office for a new one.</p>
          <Link to="/" className="mt-4 inline-block text-primary underline">
            Find your institution
          </Link>
        </Card>
      </div>
    );
  }
  const { tenant, firstName, maskedPhone } = invite.data;
  const register = `/t/${tenant.slug}/register`;
  const next = authed ? register : `/t/${tenant.slug}/login?next=${encodeURIComponent(register)}`;
  return (
    <div className="flex min-h-full items-center justify-center p-6" style={{ background: `linear-gradient(160deg, ${tenant.primaryColor}14, transparent 60%)` }}>
      <Card className="w-full max-w-md p-6 text-center">
        <div className="flex justify-center">
          <Avatar name={tenant.shortName ?? tenant.name} src={tenant.logoUrl} size="xl" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">
          {firstName ? `${firstName}, you're invited` : "You're invited"} to join {tenant.name}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Reconnect with your batchmates, find jobs and events. Sign in with <span className="font-mono font-medium">{maskedPhone}</span>, the number this invitation was sent to.
        </p>
        <Link to={next} className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white" style={{ background: tenant.primaryColor }}>
          Accept invitation
        </Link>
      </Card>
    </div>
  );
}
