import { INDUSTRY_LABELS, OPEN_TO, OPEN_TO_LABELS, PROFESSION_TYPES, PROFESSION_TYPE_LABELS, type Industry, type OpenTo, type ProfessionType, countryName } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MemberCard } from "@/components/directory/MemberCard";
import { IconDirectory } from "@/components/icons";
import { Button, EmptyState, ErrorBox, Input, LoadMore, Loading, PageHeader, Select } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function DirectoryPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [q, setQ] = useState("");
  const [year, setYear] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [professionType, setProfessionType] = useState<ProfessionType | "">("");
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState<Industry | "">("");
  const [skill, setSkill] = useState("");
  const [fieldOfStudy, setFieldOfStudy] = useState("");
  const [openTo, setOpenTo] = useState<OpenTo | "">("");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const field = Object.entries(custom)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`);
  const filters = {
    q: q || undefined,
    year: year ? Number(year) : undefined,
    city: city || undefined,
    country: country || undefined,
    professionType: professionType || undefined,
    company: company || undefined,
    industry: industry || undefined,
    skill: skill || undefined,
    fieldOfStudy: fieldOfStudy || undefined,
    openTo: openTo || undefined,
    field: field.length ? field : undefined,
  };
  const facets = useQuery({ queryKey: qk.directoryFilters(slug), queryFn: () => api.directory.filters(slug), staleTime: 5 * 60_000 });
  const list = useInfiniteList(qk.directory(slug, filters), (cursor) => api.directory.search(slug, { ...filters, cursor, limit: 24 }));
  const reset = () => {
    setQ("");
    setYear("");
    setCity("");
    setCountry("");
    setProfessionType("");
    setCompany("");
    setIndustry("");
    setSkill("");
    setFieldOfStudy("");
    setOpenTo("");
    setCustom({});
  };
  const hasFilters = Object.values(filters).some((v) => v !== undefined);
  const advancedActive = !!(city || country || professionType || company || industry || skill || fieldOfStudy || openTo || field.length);
  // Industry, skill and field of study list only what members here have, so each is left out until someone has one.
  // A filter already chosen keeps its option, so it can't vanish from under its own select.
  const withChosen = <T extends string>(options: readonly T[] | undefined, chosen: T | "") => (chosen && !options?.includes(chosen) ? [...(options ?? []), chosen] : (options ?? []));
  const industries = withChosen(facets.data?.industries, industry);
  const skills = withChosen(facets.data?.skills, skill);
  const fieldsOfStudy = withChosen(facets.data?.fieldsOfStudy, fieldOfStudy);
  // The years run only as far as approved members' do, so a chosen year keeps its option too, in its place (newest first).
  const chosenYear = year ? Number(year) : undefined;
  const years = chosenYear !== undefined && !facets.data?.years.includes(chosenYear) ? [...(facets.data?.years ?? []), chosenYear].sort((a, b) => b - a) : (facets.data?.years ?? []);

  return (
    <div className="space-y-4">
      <PageHeader title="Directory" subtitle="Find batchmates by year, city, company, skill or profession" />
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[var(--shadow-1)]">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <Input aria-label="Search members" placeholder="Name, company, role or skill" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Were there in" value={year} onChange={(e) => setYear(e.target.value)} className="sm:w-48">
            <option value="">Any year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {`Were there in ${y}`}
              </option>
            ))}
          </Select>
          <Button type="button" variant="ghost" size="sm" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
            {advanced ? "Hide filters" : advancedActive ? "More filters · on" : "More filters"}
          </Button>
        </div>
        {advanced && (
          <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select aria-label="City" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">Any city</option>
              {facets.data?.cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">Any country</option>
              {facets.data?.countries.map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
            </Select>
            <Select aria-label="Profession" value={professionType} onChange={(e) => setProfessionType(e.target.value as ProfessionType | "")}>
              <option value="">Any profession</option>
              {PROFESSION_TYPES.map((p) => (
                <option key={p} value={p}>
                  {PROFESSION_TYPE_LABELS[p]}
                </option>
              ))}
            </Select>
            <Select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} className="sm:col-span-2">
              <option value="">Any company</option>
              {facets.data?.companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {industries.length > 0 && (
              <Select aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value as Industry | "")}>
                <option value="">Any industry</option>
                {industries.map((i) => (
                  <option key={i} value={i}>
                    {INDUSTRY_LABELS[i]}
                  </option>
                ))}
              </Select>
            )}
            {skills.length > 0 && (
              <Select aria-label="Skill" value={skill} onChange={(e) => setSkill(e.target.value)}>
                <option value="">Any skill</option>
                {skills.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
            {fieldsOfStudy.length > 0 && (
              <Select aria-label="Field of study" value={fieldOfStudy} onChange={(e) => setFieldOfStudy(e.target.value)}>
                <option value="">Any field of study</option>
                {fieldsOfStudy.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
            <Select aria-label="Open to" value={openTo} onChange={(e) => setOpenTo(e.target.value as OpenTo | "")}>
              <option value="">Open to: any</option>
              {OPEN_TO.map((o) => (
                <option key={o} value={o}>
                  {`Open to ${OPEN_TO_LABELS[o].toLowerCase()}`}
                </option>
              ))}
            </Select>
            {facets.data?.fields.map((f) => (
              <Select key={f.key} aria-label={f.label} value={custom[f.key] ?? ""} onChange={(e) => setCustom((c) => ({ ...c, [f.key]: e.target.value }))}>
                <option value="">{`Any ${f.label.toLowerCase()}`}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ))}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={reset} className="justify-self-start">
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      <div className="grid gap-3 md:grid-cols-2">
        {list.items.map((m) => (
          <MemberCard key={m.id} slug={slug} member={m} />
        ))}
      </div>
      {!list.isLoading && list.items.length === 0 && <EmptyState icon={<IconDirectory size={32} className="text-slate-400" />} title="No members match" description="Try removing a filter." />}
      <LoadMore hasNextPage={!!list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </div>
  );
}
