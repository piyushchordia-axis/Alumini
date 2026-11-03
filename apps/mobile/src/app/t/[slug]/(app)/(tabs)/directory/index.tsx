import { countryName, PROFESSION_TYPES, PROFESSION_TYPE_LABELS, type DirectoryCardDto, type ProfessionType } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Avatar, Badge, Card, ChipSelect, EmptyState, Input, ListEmpty, Muted, Row } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

function MemberCard({ slug, member }: { slug: string; member: DirectoryCardDto }) {
  const router = useRouter();
  // The card's name stands in for what's inside it, so it says the badges too.
  const badges = [member.role === "TENANT_ADMIN" && "Admin", member.isOpenToWork && "Open to work", member.isMentor && "Mentor"].filter(Boolean);
  return (
    <Card onPress={() => router.push(`/t/${slug}/directory/${member.id}`)} accessibilityLabel={[member.fullName, ...badges, `batch of ${member.batchYear}`].join(", ")}>
      <Row gap={12} style={{ flexWrap: "nowrap" }}>
        <Avatar name={member.fullName} src={member.avatarUrl} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row>
            <Text style={{ fontWeight: "700", color: colors.text }} numberOfLines={1}>
              {member.fullName}
            </Text>
            {member.role === "TENANT_ADMIN" && <Badge label="Admin" tone="primary" />}
            {member.isOpenToWork && <Badge label="Open to work" tone="success" />}
            {member.isMentor && <Badge label="Mentor" tone="info" />}
          </Row>
          <Muted size={13}>
            {member.designation ?? PROFESSION_TYPE_LABELS[member.professionType]}
            {member.companyName ? ` at ${member.companyName}` : ""}
          </Muted>
          <Muted>
            Batch of {member.batchYear}
            {member.city ? ` · ${member.city}` : ""}
            {member.country && member.country !== "IN" ? `, ${countryName(member.country)}` : ""}
          </Muted>
        </View>
      </Row>
    </Card>
  );
}

export default function DirectoryScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const theme = useTheme();
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const [batchYear, setBatchYear] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [company, setCompany] = useState<string>("");
  const [professionType, setProfessionType] = useState<ProfessionType | "">("");
  const [showFilters, setShowFilters] = useState(false);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const field = Object.entries(custom)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`);
  const facets = useQuery({ queryKey: qk.directoryFilters(slug), queryFn: () => api.directory.filters(slug), staleTime: 5 * 60_000 });
  const filters = {
    q: search || undefined,
    batchYear: batchYear ? Number(batchYear) : undefined,
    city: city || undefined,
    country: country || undefined,
    company: company || undefined,
    professionType: professionType || undefined,
    field: field.length ? field : undefined,
  };
  const active = [batchYear, city, country, company, professionType].filter(Boolean).length + field.length;
  const clear = () => {
    setBatchYear("");
    setCity("");
    setCountry("");
    setCompany("");
    setProfessionType("");
    setCustom({});
  };
  const list = useInfiniteList(qk.directory(slug, filters), (cursor) => api.directory.search(slug, { ...filters, cursor, limit: 24 }));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Input accessibilityLabel="Search members" placeholder="Name, company, role" value={q} onChangeText={setQ} autoCorrect={false} />
        <Row style={{ justifyContent: "space-between" }}>
          <Pressable onPress={() => setShowFilters((v) => !v)} accessibilityRole="button" aria-expanded={showFilters} hitSlop={8}>
            <Text style={{ color: theme.primary, fontWeight: "600" }}>
              {showFilters ? "Hide filters" : "Filters"}
              {active ? ` (${active})` : ""}
            </Text>
          </Pressable>
          {active > 0 && (
            <Pressable onPress={clear} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: colors.muted }}>Clear filters</Text>
            </Pressable>
          )}
        </Row>
        {showFilters && (
          <View style={{ gap: spacing.sm }}>
            <ChipSelect label="Batch" options={(facets.data?.batchYears ?? []).map((y) => ({ value: String(y), label: String(y) }))} value={batchYear} onChange={setBatchYear} allowEmpty />
            <ChipSelect label="City" options={(facets.data?.cities ?? []).map((c) => ({ value: c, label: c }))} value={city} onChange={setCity} allowEmpty />
            <ChipSelect label="Country" options={(facets.data?.countries ?? []).map((c) => ({ value: c, label: countryName(c) }))} value={country} onChange={setCountry} allowEmpty />
            <ChipSelect label="Company" options={(facets.data?.companies ?? []).map((c) => ({ value: c, label: c }))} value={company} onChange={setCompany} allowEmpty />
            <ChipSelect label="Profession" options={PROFESSION_TYPES.map((p) => ({ value: p, label: PROFESSION_TYPE_LABELS[p] }))} value={professionType} onChange={setProfessionType} allowEmpty />
            {facets.data?.fields.map((f) => (
              <ChipSelect key={f.key} label={f.label} options={f.options} value={custom[f.key] ?? ""} onChange={(v) => setCustom((c) => ({ ...c, [f.key]: v }))} allowEmpty />
            ))}
          </View>
        )}
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 48 }}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon="🎓" title="No members match" description="Try removing a filter." />
          </ListEmpty>
        }
        renderItem={({ item }) => <MemberCard slug={slug} member={item} />}
      />
    </View>
  );
}
