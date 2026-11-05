import { useState } from "react";
import { FundingCard } from "@/components/funding/FundingCard";
import { IconFunding } from "@/components/icons";
import { EmptyState, ErrorBox, LinkButton, LoadMore, Loading, PageHeader, Tabs } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function FundingPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [kind, setKind] = useState<"SEEKING" | "OFFERING">("SEEKING");
  const list = useInfiniteList(qk.funding(slug, { kind }), (cursor) => api.funding.list(slug, { kind, cursor, limit: 20 }));
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
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      <div className="grid gap-3 md:grid-cols-2">
        {list.items.map((f) => (
          <FundingCard key={f.id} slug={slug} item={f} />
        ))}
      </div>
      {!list.isLoading && list.items.length === 0 && <EmptyState icon={<IconFunding size={32} className="text-slate-400" />} title={kind === "SEEKING" ? "No one is raising right now" : "No investors listed yet"} />}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
