import { PROFESSION_TYPES, PROFESSION_TYPE_LABELS, type MemberCardDto, type ProfessionType } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { Avatar, Badge, Card, ChipSelect, EmptyState, Input, Muted, Row, Spinner } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

function MemberCard({ slug, member }: { slug: string; member: MemberCardDto }) {
  const router = useRouter();
  return (
    <Card onPress={() => router.push(`/t/${slug}/directory/${member.id}`)}>
      <Row gap={12} style={{ flexWrap: "nowrap" }}>
        <Avatar name={member.fullName} src={member.avatarUrl} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row>
            <Text style={{ fontWeight: "700", color: colors.text }} numberOfLines={1}>
              {member.fullName}
            </Text>
            {member.role === "TENANT_ADMIN" && <Badge label="Admin" tone="primary" />}
            {member.isOpenToWork && <Badge label="Open to work" tone="success" />}
          </Row>
          <Muted size={13}>
            {member.designation ?? PROFESSION_TYPE_LABELS[member.professionType]}
            {member.companyName ? ` at ${member.companyName}` : ""}
          </Muted>
          <Muted>
            Batch of {member.batchYear}
            {member.city ? ` · ${member.city}` : ""}
            {member.country && member.country !== "IN" ? `, ${member.country}` : ""}
          </Muted>
        </View>
      </Row>
    </Card>
  );
}

export default function DirectoryScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const [q, setQ] = useState("");
  const [batchYear, setBatchYear] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [professionType, setProfessionType] = useState<ProfessionType | "">("");
  const facets = useQuery({ queryKey: qk.directoryFilters(slug), queryFn: () => api.directory.filters(slug), staleTime: 5 * 60_000 });
  const filters = { q: q || undefined, batchYear: batchYear ? Number(batchYear) : undefined, city: city || undefined, professionType: professionType || undefined };
  const list = useInfiniteList(qk.directory(slug, filters), (cursor) => api.directory.search(slug, { ...filters, cursor, limit: 24 }));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Input placeholder="Name, company, role" value={q} onChangeText={setQ} />
        <ChipSelect options={(facets.data?.batchYears ?? []).map((y) => ({ value: String(y), label: `Batch ${y}` }))} value={batchYear} onChange={setBatchYear} allowEmpty />
        <ChipSelect options={(facets.data?.cities ?? []).map((c) => ({ value: c, label: c }))} value={city} onChange={setCity} allowEmpty />
        <ChipSelect options={PROFESSION_TYPES.map((p) => ({ value: p, label: PROFESSION_TYPE_LABELS[p] }))} value={professionType} onChange={setProfessionType} allowEmpty />
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 48 }}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={list.isLoading ? <Spinner /> : <EmptyState icon="🎓" title="No members match" description="Try removing a filter." />}
        renderItem={({ item }) => <MemberCard slug={slug} member={item} />}
      />
    </View>
  );
}
