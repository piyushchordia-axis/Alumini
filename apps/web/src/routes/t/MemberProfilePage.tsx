import { formatPhone } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { MessageMemberButton, ProfileBlockButton } from "@/components/chat/MemberChatActions";
import { BackLink } from "@/components/common/BackLink";
import { PageLoad } from "@/components/common/PageLoad";
import { ProfileDetails, ProfileSummary } from "@/components/profile/ProfileDetails";
import { ProfileDetailsOutline } from "@/components/profile/ProfileDetailsOutline";
import { Badge, Card } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { usePageQuery } from "@/hooks/usePageQuery";
import { api } from "@/lib/api";
import { useCachedDirectoryCard } from "@/lib/directory";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";

export function MemberProfilePage() {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const { membershipId = "" } = useParams();
  const profile = useQuery({ queryKey: qk.member(slug, membershipId), queryFn: () => api.directory.profile(slug, membershipId) });
  const page = usePageQuery(profile);
  // Opened from a card the directory listed: the header from that card until the profile's first answer, offline too.
  const card = useCachedDirectoryCard(slug, membershipId, profile);
  const back = <BackLink to={`/t/${slug}/app/directory`}>Directory</BackLink>;
  // The same elements in the same places as the loaded page, the way back, the card and its header, so React keeps them
  // (focus on the link, a photo already shown) and only the outline under the header is swapped for the details.
  if (card)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <Card className="p-6">
          <ProfileSummary profile={card} nameExtras={card.role === "TENANT_ADMIN" && <Badge tone="primary">Admin</Badge>} />
          <ProfileDetailsOutline className="mt-6 border-t border-slate-100 pt-5" />
        </Card>
      </div>
    );
  // Only with nothing to show: a refetch failing in the background keeps the profile on screen.
  if (!profile.data)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <PageLoad page={page} shape="profile" />
      </div>
    );
  const m = profile.data;
  const isSelf = m.id === membership.id;
  // Blocking doesn't depend on messages being on: an institution may switch them off in the middle of an incident.
  const canBlock = !isSelf && membership.chatEligible;
  const chatOn = canBlock && tenant.settings.features.messaging;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {back}
      <Card className="p-6">
        <ProfileSummary profile={m} nameExtras={m.role === "TENANT_ADMIN" && <Badge tone="primary">Admin</Badge>}>
          {isSelf && (
            <Link to={`/t/${slug}/app/profile`} className="mt-2 inline-block text-sm text-primary-ink underline">
              Edit my profile
            </Link>
          )}
          {chatOn && m.canMessage && (
            <div className="mt-3">
              <MessageMemberButton slug={slug} member={m} />
            </div>
          )}
        </ProfileSummary>
        <ProfileDetails profile={m} tenant={tenant} className="mt-6 border-t border-slate-100 pt-5" />
        <dl className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
          {m.phone && (
            <div>
              <dt className="text-slate-500">Phone</dt>
              <dd>
                <a href={`tel:${m.phone}`} className="text-primary-ink">
                  {formatPhone(m.phone)}
                </a>{" "}
                <a href={`https://wa.me/${m.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-tone-success-ink">
                  WhatsApp
                </a>
              </dd>
            </div>
          )}
          {m.fields.map((f) => (
            <div key={f.key}>
              <dt className="text-slate-500">{f.label}</dt>
              <dd className="whitespace-pre-line">{f.display}</dd>
            </div>
          ))}
          <div>
            <dt className="text-slate-500">Registered</dt>
            <dd>{formatDate(m.memberSince)}</dd>
          </div>
        </dl>
        {canBlock && (
          <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
            <ProfileBlockButton slug={slug} member={m} />
          </div>
        )}
      </Card>
    </div>
  );
}
