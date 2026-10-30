import { PROFESSION_TYPES, PROFESSION_TYPE_LABELS, type ProfessionType } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MemberCard } from "@/components/directory/MemberCard";
import { Button, EmptyState, ErrorBox, Input, LoadMore, Loading, PageHeader, Select } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function DirectoryPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [q, setQ] = useState("");
  const [batchYear, setBatchYear] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [professionType, setProfessionType] = useState<ProfessionType | "">("");
  const [company, setCompany] = useState("");
  const filters = { q: q || undefined, batchYear: batchYear ? Number(batchYear) : undefined, city: city || undefined, country: country || undefined, professionType: professionType || undefined, company: company || undefined };
  const facets = useQuery({ queryKey: qk.directoryFilters(slug), queryFn: () => api.directory.filters(slug), staleTime: 5 * 60_000 });
  const list = useInfiniteList(qk.directory(slug, filters), (cursor) => api.directory.search(slug, { ...filters, cursor, limit: 24 }));
  const reset = () => {
    setQ("");
    setBatchYear("");
    setCity("");
    setCountry("");
    setProfessionType("");
    setCompany("");
  };
  const hasFilters = Object.values(filters).some((v) => v !== undefined);

  return (
    <div className="space-y-4">
      <PageHeader title="Directory" subtitle="Find batchmates by year, city, company or profession" />
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Input placeholder="Name, company, role" value={q} onChange={(e) => setQ(e.target.value)} className="sm:col-span-2" />
        <Select value={batchYear} onChange={(e) => setBatchYear(e.target.value)}>
          <option value="">Any batch</option>
          {facets.data?.batchYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <Select value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">Any city</option>
          {facets.data?.cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Any country</option>
          {facets.data?.countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={professionType} onChange={(e) => setProfessionType(e.target.value as ProfessionType | "")}>
          <option value="">Any profession</option>
          {PROFESSION_TYPES.map((p) => (
            <option key={p} value={p}>
              {PROFESSION_TYPE_LABELS[p]}
            </option>
          ))}
        </Select>
        <Select value={company} onChange={(e) => setCompany(e.target.value)} className="sm:col-span-2">
          <option value="">Any company</option>
          {facets.data?.companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={reset} className="justify-self-start">
            Clear filters
          </Button>
        )}
      </div>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      <div className="grid gap-3 md:grid-cols-2">
        {list.items.map((m) => (
          <MemberCard key={m.id} slug={slug} member={m} />
        ))}
      </div>
      {!list.isLoading && list.items.length === 0 && <EmptyState icon="🎓" title="No members match" description="Try removing a filter." />}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
