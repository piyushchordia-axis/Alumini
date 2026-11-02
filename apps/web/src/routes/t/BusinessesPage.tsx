import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS, type BusinessCategory } from "@illuminize/shared";
import { useState } from "react";
import { BusinessCard } from "@/components/businesses/BusinessCard";
import { EmptyState, ErrorBox, Input, LinkButton, LoadMore, Loading, PageHeader, Select } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function BusinessesPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState<BusinessCategory | "">("");
  const search = useDebounced(q.trim());
  const place = useDebounced(city.trim());
  const filters = { q: search || undefined, city: place || undefined, category: category || undefined };
  const list = useInfiniteList(qk.businesses(slug, filters), (cursor) => api.businesses.list(slug, { ...filters, cursor, limit: 20 }));
  return (
    <div className="space-y-4">
      <PageHeader title="Businesses" subtitle="Companies and services run by alumni" actions={<LinkButton to={`/t/${slug}/app/businesses/new`}>Add a business</LinkButton>} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Input aria-label="Search businesses" placeholder="Search name or description" value={q} onChange={(e) => setQ(e.target.value)} />
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
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      <div className="grid gap-3 md:grid-cols-2">
        {list.items.map((b) => (
          <BusinessCard key={b.id} slug={slug} item={b} />
        ))}
      </div>
      {!list.isLoading && !list.error && list.items.length === 0 && <EmptyState icon="🏪" title={filters.q || filters.city || filters.category ? "No businesses match" : "No businesses listed yet"} description="Run a business? Add it for your batchmates." />}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
