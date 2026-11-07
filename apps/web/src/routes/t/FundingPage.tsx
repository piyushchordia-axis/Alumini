import { fundingEmpty } from "@illuminize/shared";
import { useState } from "react";
import { ListError } from "@/components/common/ListBody";
import { FundingCard } from "@/components/funding/FundingCard";
import { IconFunding } from "@/components/icons";
import { EmptyState, LinkButton, ListSkeleton, LoadMore, PageHeader, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function FundingPage() {
  const member = useMembership();
  const { tenant } = member;
  const slug = tenant.slug;
  const [kind, setKind] = useState<"SEEKING" | "OFFERING">("SEEKING");
  const list = useInfiniteList(qk.funding(slug, { kind }), (cursor) => api.funding.list(slug, { kind, cursor, limit: 20 }));
  const empty = fundingEmpty(member, kind);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding"
        subtitle="Alumni raising capital and alumni investing in them"
        actions={
          <>
            <LinkButton to={`/t/${slug}/app/funding/new?kind=SEEKING`} variant="outline">
              I'm raising
            </LinkButton>
            <LinkButton to={`/t/${slug}/app/funding/new?kind=OFFERING`}>I'm investing</LinkButton>
          </>
        }
      />
      <Tabs value={kind} onChange={setKind} tabs={[{ value: "SEEKING", label: "Seeking funding" }, { value: "OFFERING", label: "Investors" }]} className="w-fit" />
      {list.view === "loading" && <ListSkeleton shape="listing" columns={2} />}
      {list.view === "error" && <ListError error={list.error} onRetry={list.retry} retrying={list.retrying} />}
      <div className="grid gap-3 md:grid-cols-2">
        {list.items.map((f) => (
          <FundingCard key={f.id} slug={slug} item={f} />
        ))}
      </div>
      {list.view === "empty" && (
        <EmptyState icon={<IconFunding />} title={empty.title} description={empty.description} action={empty.action && <LinkButton to={`/t/${slug}/app/funding/new?kind=${kind}`} variant={empty.action.variant}>{empty.action.label}</LinkButton>} />
      )}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} error={list.nextPageError} />
    </div>
  );
}
