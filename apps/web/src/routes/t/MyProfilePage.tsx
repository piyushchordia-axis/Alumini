import { PROFILE_SECTIONS, type ProfileSection } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { EmailSettings } from "@/components/profile/EmailSettings";
import { ProfileDetails, ProfileSummary } from "@/components/profile/ProfileDetails";
import { PROFILE_SECTION_TITLES, ProfileForm } from "@/components/profile/ProfileForm";
import { Avatar, Badge, Button, Card, Loading, PageHeader } from "@/components/ui";
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
  const { hash } = useLocation();
  // Mentor and Open to work aren't on the membership: they come with the profile other members open, fetched afresh
  // each visit, so offering to mentor or looking for work elsewhere shows on return.
  const asOthersSeeIt = useQuery({
    queryKey: qk.member(tenant.slug, membership.id),
    queryFn: () => api.directory.profile(tenant.slug, membership.id),
    enabled: tenant.settings.features.directory,
    staleTime: 0,
  });
  const summary = { ...membership, isMentor: asOthersSeeIt.data?.isMentor, isOpenToWork: asOthersSeeIt.data?.isOpenToWork };
  const formReady = !fields.isLoading;
  // A link to a section (#work, from the profile checklist) lands on it once the form is there to scroll to.
  useEffect(() => {
    const section = hash.slice(1);
    if (formReady && (PROFILE_SECTIONS as readonly string[]).includes(section)) document.getElementById(section)?.scrollIntoView({ block: "start" });
  }, [formReady, hash]);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="My profile" subtitle={`Signed in as ${user?.phone ?? ""}`} />
      {/* What's saved, laid out as on the member's own page. A current pupil sees their links here; nobody else does. */}
      <Card className="p-5">
        <ProfileSummary profile={summary} nameAs="h2" nameExtras={membership.role === "TENANT_ADMIN" && <Badge tone="primary">Admin</Badge>} />
        <ProfileDetails profile={membership} tenant={tenant} headingLevel={3} className="mt-5 border-t border-slate-100 pt-5" />
      </Card>
      <nav aria-label="Profile sections" className="flex flex-wrap items-center gap-2 pt-2 text-sm">
        <span className="text-slate-500">Edit</span>
        {PROFILE_SECTIONS.map((s: ProfileSection) => (
          <a
            key={s}
            href={`#${s}`}
            aria-label={`Edit ${PROFILE_SECTION_TITLES[s]}`}
            className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-4 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {PROFILE_SECTION_TITLES[s]}
          </a>
        ))}
      </nav>
      {/* The form starts once the institution's questions are in, so nothing typed or uploaded is lost to a remount. */}
      {formReady ? (
        <ProfileForm
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
              return updated;
            } catch (err) {
              toast.error(errorMessage(err));
              throw err;
            }
          }}
        />
      ) : (
        <Card className="p-5">
          <Loading />
        </Card>
      )}
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
