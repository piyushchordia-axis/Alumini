import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS, businessesEmpty, type BusinessCategory } from "@illuminize/shared";
import { useRef, useState } from "react";
import { BusinessCard } from "@/components/businesses/BusinessCard";
import { ListError } from "@/components/common/ListBody";
import { IconBusinesses, IconSearch } from "@/components/icons";
import { Button, EmptyState, Input, LinkButton, ListSkeleton, LoadMore, PageHeader, Select } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function BusinessesPage() {
  const member = useMembership();
  const { tenant } = member;
  const slug = tenant.slug;
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState<BusinessCategory | "">("");
  const search = useDebounced(q.trim());
  const place = useDebounced(city.trim());
  const filters = { q: search || undefined, city: place || undefined, category: category || undefined };
  const list = useInfiniteList(qk.businesses(slug, filters), (cursor) => api.businesses.list(slug, { ...filters, cursor, limit: 20 }));
  const empty = businessesEmpty(member, !!(filters.q || filters.city || filters.category));
  const searchBox = useRef<HTMLInputElement>(null);
  const showAll = () => {
    setQ("");
    setCity("");
    setCategory("");
    searchBox.current?.focus();
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Businesses" subtitle="Companies and services run by alumni" actions={<LinkButton to={`/t/${slug}/app/businesses/new`}>Add a business</LinkButton>} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Input ref={searchBox} aria-label="Search businesses" placeholder="Search name or description" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as BusinessCategory | "")}>
          <option value="">All categories</option>
          {BUSINESS_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {BUSINESS_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Input aria-label="City" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
      </div>
      {list.view === "loading" && <ListSkeleton shape="listing" columns={2} />}
      {list.view === "error" && <ListError error={list.error} onRetry={list.retry} retrying={list.retrying} />}
      <div className="grid gap-3 md:grid-cols-2">
        {list.items.map((b) => (
          <BusinessCard key={b.id} slug={slug} item={b} />
        ))}
      </div>
      {list.view === "empty" && (
        <EmptyState
          icon={empty.live ? <IconSearch /> : <IconBusinesses />}
          title={empty.title}
          description={empty.description}
          live={empty.live}
          action={
            empty.action &&
            (empty.action.kind === "showAll" ? <Button variant={empty.action.variant} onClick={showAll}>{empty.action.label}</Button> : <LinkButton to={`/t/${slug}/app/businesses/new`} variant={empty.action.variant}>{empty.action.label}</LinkButton>)
          }
        />
      )}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} error={list.nextPageError} />
    </div>
  );
}
