import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS, plainExcerpt, type BusinessCardDto, type BusinessCategory } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { IconBusinesses } from "@/components/icons";
import { ModerationBadge } from "@/components/ModerationBadge";
import { Avatar, Badge, Button, Card, ChipSelect, EmptyState, Input, ListEmpty, Muted, Row, SectionScreen } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

function BusinessCard({ slug, item }: { slug: string; item: BusinessCardDto }) {
  const router = useRouter();
  return (
    <Card onPress={() => router.push(`/t/${slug}/businesses/${item.id}`)}>
      <Row style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <Avatar name={item.name} src={item.logoUrl} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", color: colors.text }} numberOfLines={1}>
            {item.name}
          </Text>
          {item.city && <Muted size={13}>{item.city}</Muted>}
        </View>
        <Badge label={BUSINESS_CATEGORY_LABELS[item.category]} tone="info" />
        <ModerationBadge status={item.moderationStatus} />
      </Row>
      <Text numberOfLines={2} style={{ color: "#475569" }}>
        {plainExcerpt(item.description, 200)}
      </Text>
      <Muted>
        {item.author.fullName} · {timeAgo(item.createdAt)}
      </Muted>
    </Card>
  );
}

export default function BusinessesScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState<BusinessCategory | "">("");
  const search = useDebounced(q.trim());
  const place = useDebounced(city.trim());
  const filters = { q: search || undefined, city: place || undefined, category: category || undefined };
  const list = useInfiniteList(qk.businesses(slug, filters), (cursor) => api.businesses.list(slug, { ...filters, cursor, limit: 20 }));
  return (
    <SectionScreen>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Button title="Add a business" onPress={() => router.push(`/t/${slug}/businesses/new`)} />
        <Input accessibilityLabel="Search businesses" placeholder="Search name or description" value={q} onChangeText={setQ} autoCorrect={false} />
        <Input accessibilityLabel="City" placeholder="City" value={city} onChangeText={setCity} autoCorrect={false} />
        <ChipSelect label="Category" options={BUSINESS_CATEGORIES.map((c) => ({ value: c, label: BUSINESS_CATEGORY_LABELS[c] }))} value={category} onChange={setCategory} allowEmpty />
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 48 }}
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <ListEmpty loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()}>
            <EmptyState icon={<IconBusinesses size={32} color={colors.faint} />} title={filters.q || filters.city || filters.category ? "No businesses match" : "No businesses listed yet"} description="Run a business? Add it for your batchmates." />
          </ListEmpty>
        }
        renderItem={({ item }) => <BusinessCard slug={slug} item={item} />}
      />
    </SectionScreen>
  );
}
