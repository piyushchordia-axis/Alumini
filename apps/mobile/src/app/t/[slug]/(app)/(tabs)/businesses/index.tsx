import { BUSINESS_CATEGORIES, BUSINESS_CATEGORY_LABELS, businessesEmpty, nameWithYears, plainExcerpt, type BusinessCardDto, type BusinessCategory } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { IconBusinesses, IconSearch } from "@/components/icons";
import { ModerationBadge } from "@/components/ModerationBadge";
import { Avatar, Badge, Button, Card, ChipSelect, EmptyState, Input, ListEmpty, Muted, Row, SectionScreen } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { moveFocus } from "@/lib/focus";
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
        {nameWithYears(item.author)} · {timeAgo(item.createdAt)}
      </Muted>
    </Card>
  );
}

export default function BusinessesScreen() {
  const member = useMembership();
  const { tenant } = member;
  const slug = tenant.slug;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState<BusinessCategory | "">("");
  const search = useDebounced(q.trim());
  const place = useDebounced(city.trim());
  const filters = { q: search || undefined, city: place || undefined, category: category || undefined };
  const list = useInfiniteList(qk.businesses(slug, filters), (cursor) => api.businesses.list(slug, { ...filters, cursor, limit: 20 }));
  const empty = businessesEmpty(member, !!(filters.q || filters.city || filters.category));
  const searchBox = useRef<ComponentRef<typeof TextInput>>(null);
  const showAll = () => {
    setQ("");
    setCity("");
    setCategory("");
    moveFocus(searchBox.current);
  };
  return (
    <SectionScreen>
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Button title="Add a business" onPress={() => router.push(`/t/${slug}/businesses/new`)} />
        <Input ref={searchBox} accessibilityLabel="Search businesses" placeholder="Search name or description" value={q} onChangeText={setQ} autoCorrect={false} />
        <Input accessibilityLabel="City" placeholder="City" value={city} onChangeText={setCity} autoCorrect={false} />
        <ChipSelect label="Category" options={BUSINESS_CATEGORIES.map((c) => ({ value: c, label: BUSINESS_CATEGORY_LABELS[c] }))} value={category} onChange={setCategory} allowEmpty />
      </View>
      <FlatList
        data={list.items}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: 48 }}
        // The keyboard is often still up after a search: one tap reaches Show all businesses, or a listing.
        keyboardShouldPersistTaps="handled"
        onEndReached={list.loadMore}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={
          <ListEmpty view={list.view} skeleton="listing" error={list.error} onRetry={list.retry} retrying={list.retrying}>
            <EmptyState
              icon={empty.live ? <IconSearch /> : <IconBusinesses />}
              title={empty.title}
              description={empty.description}
              live={empty.live}
              action={
                empty.action &&
                (empty.action.kind === "showAll" ? (
                  <Button title={empty.action.label} variant={empty.action.variant} onPress={showAll} />
                ) : (
                  <Button title={empty.action.label} variant={empty.action.variant} accessibilityRole="link" onPress={() => router.push(`/t/${slug}/businesses/new`)} />
                ))
              }
            />
          </ListEmpty>
        }
        renderItem={({ item }) => <BusinessCard slug={slug} item={item} />}
      />
    </SectionScreen>
  );
}
