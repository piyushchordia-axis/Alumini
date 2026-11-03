import { errorMessage } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { EmailSettings } from "@/components/profile/EmailSettings";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { Avatar, Button, Card, PageHeader } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { useProfileFields } from "@/hooks/useProfileFields";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "@/stores/uiStore";

export function MyProfilePage() {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const others = memberships.filter((m) => m.tenant.slug !== tenant.slug);
  const fields = useProfileFields(tenant.slug);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="My profile" subtitle={`Signed in as ${user?.phone ?? ""}`} />
      <Card className="p-5">
        <ProfileForm
          key={fields.data ? "with-fields" : "loading"}
          tenant={tenant}
          initial={membership}
          customFields={fields.data ?? []}
          submitLabel="Save profile"
          onSubmit={async (values) => {
            try {
              const updated = await api.membership.updateMe(tenant.slug, values);
              qc.setQueryData(qk.membership(tenant.slug), updated);
              void qc.invalidateQueries({ queryKey: qk.me });
              void qc.invalidateQueries({ queryKey: ["directory", tenant.slug] });
              void qc.invalidateQueries({ queryKey: qk.member(tenant.slug, updated.id) });
              toast.success("Profile saved");
            } catch (err) {
              toast.error(errorMessage(err));
              throw err;
            }
          }}
        />
      </Card>
      <Card className="p-5">
        <EmailSettings />
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold text-slate-900">Your institutions</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {memberships.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <Avatar name={m.tenant.shortName ?? m.tenant.name} src={m.tenant.logoUrl} size="sm" />
              <span className="flex-1 text-sm">
                {m.tenant.name} <span className="text-slate-400">· {m.status.toLowerCase()}</span>
              </span>
              {m.tenant.slug !== tenant.slug && (
                <Link to={`/t/${m.tenant.slug}/app`} className="text-sm text-primary underline">
                  Switch
                </Link>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/?switch=1" className="text-sm text-primary underline">
            Join another institution
          </Link>
          {others.length === 0 && <span className="text-xs text-slate-400">You're a member of one institution.</span>}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold text-slate-900">Account</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await api.auth.logout(refreshToken);
              qc.clear();
              navigate(`/t/${tenant.slug}`);
            }}
          >
            Sign out
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm("Delete your Illuminize account and all your memberships? Messages you sent stay in other people's chats and groups, shown as from a Deleted member, and groups you own pass to the member who has been in them longest. This cannot be undone.")) return;
              await api.me.deleteAccount();
              qc.clear();
              navigate("/");
            }}
          >
            Delete account
          </Button>
        </div>
      </Card>
    </div>
  );
}
