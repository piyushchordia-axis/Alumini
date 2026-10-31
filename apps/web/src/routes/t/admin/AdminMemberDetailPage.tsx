import { MARITAL_STATUS_LABELS, PROFESSION_TYPE_LABELS } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { AuditTable } from "@/components/admin/AuditTable";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { Avatar, Button, Card, ErrorBox, Loading } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { MemberActionButtons, useMemberActions } from "./AdminMembersPage";

export function AdminMemberDetailPage() {
  const { tenant, me } = useAdminTenant();
  const slug = tenant.slug;
  const { membershipId = "" } = useParams();
  const q = useQuery({ queryKey: qk.admin.member(slug, membershipId), queryFn: () => api.admin.members.get(slug, membershipId) });
  const actions = useMemberActions(slug);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? "Not found"} />;
  const m = q.data;
  const isSelf = m.id === me?.id;
  const fields: Array<[string, string | number | null | undefined]> = [
    ["Phone", m.phone],
    ["Batch", m.batchYear],
    ["Profession", PROFESSION_TYPE_LABELS[m.professionType]],
    ["Company", m.companyName],
    ["Designation", m.designation],
    ["City", [m.city, m.country].filter(Boolean).join(", ")],
    ["Date of birth", m.dateOfBirth ? formatDate(m.dateOfBirth) : null],
    ["Marital status", m.maritalStatus ? MARITAL_STATUS_LABELS[m.maritalStatus] : null],
    ["Kids", m.kidsCount],
    ["LinkedIn", m.linkedinUrl],
    ["Interests", m.interests.join(", ")],
    ["Member since", formatDate(m.createdAt)],
    ["Last active", m.lastActiveAt ? formatDateTime(m.lastActiveAt) : "never"],
    ["Last login", m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "never"],
  ];
  return (
    <div className="space-y-4">
      <Link to={`/t/${slug}/admin/members`} className="text-sm text-slate-500 hover:text-slate-800">
        ← Members
      </Link>
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={m.fullName} src={m.avatarUrl} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{m.fullName}</h1>
              <MemberStatusBadge status={m.status} />
              {m.role === "TENANT_ADMIN" && <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">Admin</span>}
            </div>
            {m.statusReason && <p className="text-sm text-slate-500">Reason: {m.statusReason}</p>}
            {m.bio && <p className="mt-2 text-sm text-slate-700">{m.bio}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {!isSelf && <MemberActionButtons member={m} actions={actions} />}
              {!isSelf && m.status === "APPROVED" && (
                <Button variant="ghost" onClick={() => actions.setRole.mutate({ id: m.id, role: m.role === "TENANT_ADMIN" ? "MEMBER" : "TENANT_ADMIN" })} loading={actions.setRole.isPending}>
                  {m.role === "TENANT_ADMIN" ? "Remove admin role" : "Make admin"}
                </Button>
              )}
              {isSelf && <span className="text-sm text-slate-400">This is you.</span>}
            </div>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-900">{v === null || v === undefined || v === "" ? "—" : String(v)}</dd>
            </div>
          ))}
          {Object.entries(m.extra).map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-900">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent activity</h2>
        <AuditTable rows={m.audit} />
      </section>
    </div>
  );
}
