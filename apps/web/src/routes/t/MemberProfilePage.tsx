import { COUNTRY_NAME_BY_CODE, PROFESSION_TYPE_LABELS } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Avatar, Badge, Card, ErrorBox, Loading } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";

export function MemberProfilePage() {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const { membershipId = "" } = useParams();
  const profile = useQuery({ queryKey: qk.member(slug, membershipId), queryFn: () => api.directory.profile(slug, membershipId) });
  if (profile.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorBox error={profile.error ?? "Not found"} />;
  const m = profile.data;
  const isSelf = m.id === membership.id;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={`/t/${slug}/app/directory`} className="text-sm text-slate-500 hover:text-slate-800">
        ← Directory
      </Link>
      <Card className="p-6">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <Avatar name={m.fullName} src={m.avatarUrl} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h1 className="text-2xl font-semibold text-slate-900">{m.fullName}</h1>
              {m.role === "TENANT_ADMIN" && <Badge tone="primary">Admin</Badge>}
              {m.isOpenToWork && <Badge tone="success">Open to work</Badge>}
            </div>
            <p className="text-slate-600">
              {m.designation ? `${m.designation}` : PROFESSION_TYPE_LABELS[m.professionType]}
              {m.companyName ? ` at ${m.companyName}` : ""}
            </p>
            <p className="text-sm text-slate-500">
              Batch of {m.batchYear}
              {m.city ? ` · ${m.city}` : ""}
              {m.country ? `, ${COUNTRY_NAME_BY_CODE[m.country] ?? m.country}` : ""}
            </p>
            {isSelf && (
              <Link to={`/t/${slug}/app/profile`} className="mt-2 inline-block text-sm text-primary underline">
                Edit my profile
              </Link>
            )}
          </div>
        </div>
        {m.bio && <p className="mt-5 whitespace-pre-line text-[15px] text-slate-800">{m.bio}</p>}
        {m.interests.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {m.interests.map((i) => (
              <Badge key={i}>{i}</Badge>
            ))}
          </div>
        )}
        <dl className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
          {m.phone && (
            <div>
              <dt className="text-slate-500">Phone</dt>
              <dd>
                <a href={`tel:${m.phone}`} className="text-primary">
                  {m.phone}
                </a>{" "}
                <a href={`https://wa.me/${m.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-emerald-600">
                  WhatsApp
                </a>
              </dd>
            </div>
          )}
          {m.linkedinUrl && (
            <div>
              <dt className="text-slate-500">LinkedIn</dt>
              <dd>
                <a href={m.linkedinUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                  View profile ↗
                </a>
              </dd>
            </div>
          )}
          {Object.entries(m.extra).map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500">{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
          <div>
            <dt className="text-slate-500">Member since</dt>
            <dd>{formatDate(m.memberSince)}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
