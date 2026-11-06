import {
  countryName,
  memberYearsLabel,
  memberYearsLine,
  INDUSTRY_LABELS,
  OPEN_TO,
  OPEN_TO_LABELS,
  PROFESSION_TYPES,
  PROFESSION_TYPE_LABELS,
  type DirectoryCardDto,
  type Industry,
  type OpenTo,
  type ProfessionType,
} from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { IconDirectory } from "@/components/icons";
import { OptionPicker } from "@/components/OptionPicker";
import { ProfileBadges, profileBadgeWords, profileTagline } from "@/components/profile/ProfileDetails";
import { Avatar, Badge, Card, ChipSelect, EmptyState, Input, ListEmpty, Muted, Row, SectionScreen } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

function MemberCard({ slug, member }: { slug: string; member: DirectoryCardDto }) {
  const router = useRouter();
  const tagline = profileTagline(member);
  // The card's name stands in for what's inside it, so it says the badges in full too.
  const badges = [...(member.role === "TENANT_ADMIN" ? ["Admin"] : []), ...profileBadgeWords(member)];
  const place = [member.city, member.country && member.country !== "IN" ? countryName(member.country) : null].filter(Boolean).join(", ");
  return (
    <Card onPress={() => router.push(`/t/${slug}/directory/${member.id}`)} accessibilityLabel={[member.fullName, ...badges, tagline, memberYearsLabel(member)].join(", ")}>
      <Row gap={12} style={{ flexWrap: "nowrap" }}>
        <Avatar name={member.fullName} src={member.avatarUrl} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={6}>
            <Text style={{ fontWeight: "700", color: colors.text }} numberOfLines={1}>
              {member.fullName}
            </Text>
            {member.role === "TENANT_ADMIN" && <Badge label="Admin" tone="primary" />}
            <ProfileBadges profile={member} short />
          </Row>
          {/* One line however long the headline: the whole of it is on their profile. */}
          <Text style={{ fontSize: 13, color: colors.muted }} numberOfLines={1}>
            {tagline}
          </Text>
          <Muted>{memberYearsLine(member, place)}</Muted>
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
  const [year, setYear] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [company, setCompany] = useState<string>("");
  const [professionType, setProfessionType] = useState<ProfessionType | "">("");
  const [industry, setIndustry] = useState<Industry | "">("");
  const [skill, setSkill] = useState("");
  const [fieldOfStudy, setFieldOfStudy] = useState("");
  const [openTo, setOpenTo] = useState<OpenTo | "">("");
  const [showFilters, setShowFilters] = useState(false);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const { height } = useWindowDimensions();
  const field = Object.entries(custom)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`);
  const facets = useQuery({ queryKey: qk.directoryFilters(slug), queryFn: () => api.directory.filters(slug), staleTime: 5 * 60_000 });
  const filters = {
    q: search || undefined,
    year: year ? Number(year) : undefined,
    city: city || undefined,
    country: country || undefined,
    company: company || undefined,
    professionType: professionType || undefined,
    industry: industry || undefined,
    skill: skill || undefined,
    fieldOfStudy: fieldOfStudy || undefined,
    openTo: openTo || undefined,
    field: field.length ? field : undefined,
  };
  const active = [year, city, country, company, professionType, industry, skill, fieldOfStudy, openTo].filter(Boolean).length + field.length;
  const clear = () => {
    setYear("");
    setCity("");
    setCountry("");
    setCompany("");
    setProfessionType("");
    setIndustry("");
    setSkill("");
    setFieldOfStudy("");
    setOpenTo("");
    setCustom({});
  };
  // Industry, skill and field of study list only what members here have, so each is left out until someone has one.
  // A filter already chosen keeps its chip, so it can't vanish while it's on.
  const withChosen = <T extends string>(options: readonly T[] | undefined, chosen: T | "") => (chosen && !options?.includes(chosen) ? [...(options ?? []), chosen] : (options ?? []));
  const industries = withChosen(facets.data?.industries, industry);
  const skills = withChosen(facets.data?.skills, skill);
  const fieldsOfStudy = withChosen(facets.data?.fieldsOfStudy, fieldOfStudy);
  // The years run only as far as approved members' do, so a chosen year keeps its row too, in its place (newest first).
  const chosenYear = year ? Number(year) : undefined;
  const years = chosenYear !== undefined && !facets.data?.years.includes(chosenYear) ? [...(facets.data?.years ?? []), chosenYear].sort((a, b) => b - a) : (facets.data?.years ?? []);
  const list = useInfiniteList(qk.directory(slug, filters), (cursor) => api.directory.search(slug, { ...filters, cursor, limit: 24 }));
  return (
    <SectionScreen>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Input accessibilityLabel="Search members" placeholder="Name, company, role or skill" value={q} onChangeText={setQ} autoCorrect={false} />
        <Row style={{ justifyContent: "space-between" }}>
          <Pressable onPress={() => setShowFilters((v) => !v)} accessibilityRole="button" aria-expanded={showFilters} hitSlop={8}>
            <Text style={{ color: theme.pageInk, fontWeight: "600" }}>
              {showFilters ? "Hide filters" : "Filters"}
              {active ? ` (${active})` : ""}
            </Text>
          </Pressable>
          {active > 0 && (
            <Pressable onPress={clear} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: theme.pageMuted }}>Clear filters</Text>
            </Pressable>
          )}
        </Row>
        {showFilters && (
          // Scrolls on its own past half the screen, so the results below stay in sight.
          <ScrollView style={{ maxHeight: Math.round(height * 0.45) }} nestedScrollEnabled keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
            {/* Too many years for a row of chips, which would hide the chosen one off to the side: a list, as for an industry. */}
            <OptionPicker label="Were there in" value={year || null} options={years.map((y) => ({ value: String(y), label: String(y) }))} onChange={(y) => setYear(y ?? "")} placeholder="Any year" clearLabel="Any year" />
            <ChipSelect label="City" options={(facets.data?.cities ?? []).map((c) => ({ value: c, label: c }))} value={city} onChange={setCity} allowEmpty tall />
            <ChipSelect label="Country" options={(facets.data?.countries ?? []).map((c) => ({ value: c, label: countryName(c) }))} value={country} onChange={setCountry} allowEmpty tall />
            <ChipSelect label="Company" options={(facets.data?.companies ?? []).map((c) => ({ value: c, label: c }))} value={company} onChange={setCompany} allowEmpty tall />
            <ChipSelect label="Profession" options={PROFESSION_TYPES.map((p) => ({ value: p, label: PROFESSION_TYPE_LABELS[p] }))} value={professionType} onChange={setProfessionType} allowEmpty tall />
            {industries.length > 0 && <ChipSelect label="Industry" options={industries.map((i) => ({ value: i, label: INDUSTRY_LABELS[i] }))} value={industry} onChange={setIndustry} allowEmpty tall />}
            {skills.length > 0 && <ChipSelect label="Skill" options={skills.map((s) => ({ value: s, label: s }))} value={skill} onChange={setSkill} allowEmpty tall />}
            {fieldsOfStudy.length > 0 && <ChipSelect label="Field of study" options={fieldsOfStudy.map((s) => ({ value: s, label: s }))} value={fieldOfStudy} onChange={setFieldOfStudy} allowEmpty tall />}
            <ChipSelect label="Open to" options={OPEN_TO.map((o) => ({ value: o, label: OPEN_TO_LABELS[o] }))} value={openTo} onChange={setOpenTo} allowEmpty tall />
            {facets.data?.fields.map((f) => (
              <ChipSelect key={f.key} label={f.label} options={f.options} value={custom[f.key] ?? ""} onChange={(v) => setCustom((c) => ({ ...c, [f.key]: v }))} allowEmpty tall />
            ))}
          </ScrollView>
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
            <EmptyState icon={<IconDirectory size={32} color={colors.faint} />} title="No members match" description="Try removing a filter." />
          </ListEmpty>
        }
        renderItem={({ item }) => <MemberCard slug={slug} member={item} />}
      />
    </SectionScreen>
  );
}
