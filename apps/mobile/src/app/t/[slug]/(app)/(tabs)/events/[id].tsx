import { EVENT_KIND_LABELS, type RsvpStatus } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { ReportButton } from "@/components/ReportButton";
import { RichText } from "@/components/RichText";
import { Avatar, Badge, Button, Card, LoadError, Muted, Row, Screen, Spinner, toggleState } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors } from "@/theme";

export default function EventDetailScreen() {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: qk.event(slug, id), queryFn: () => api.events.get(slug, id) });
  const [openedAt] = useState(() => Date.now());
  const attendees = useInfiniteList(qk.attendees(slug, id), (cursor) => api.events.attendees(slug, id, { status: "YES", cursor, limit: 30 }), !!ev.data);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["events", slug] });
    void qc.invalidateQueries({ queryKey: qk.event(slug, id) });
    void qc.invalidateQueries({ queryKey: qk.attendees(slug, id) });
  };
  const rsvp = useMutation({
    mutationFn: (status: RsvpStatus | null) => (status ? api.events.rsvp(slug, id, status) : api.events.clearRsvp(slug, id)),
    onSuccess: invalidate,
    onError: (e) => Alert.alert("Could not RSVP", errorMessage(e)),
  });
  const cancel = useMutation({ mutationFn: () => api.events.cancel(slug, id, null), onSuccess: invalidate, onError: (e) => Alert.alert("Failed", errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.events.remove(slug, id), onSuccess: () => { invalidate(); router.back(); }, onError: (e) => Alert.alert("Failed", errorMessage(e)) });
  if (ev.isLoading) return <Spinner />;
  if (ev.error || !ev.data) return <LoadError error={ev.error ?? "Not found"} onRetry={() => void ev.refetch()} onBack={() => router.back()} backLabel="Back" />;
  const e = ev.data;
  const full = !!e.maxAttendees && e.yesCount >= e.maxAttendees && e.myRsvp !== "YES";
  const started = new Date(e.startAt).getTime() <= openedAt;
  const disabled = e.isCancelled || started || e.moderationStatus !== "APPROVED" || rsvp.isPending;
  const options: { value: RsvpStatus; label: string; color: string }[] = [
    { value: "YES", label: full ? "Full" : "I'm going", color: colors.success },
    { value: "MAYBE", label: "Maybe", color: colors.warning },
    { value: "NO", label: "Can't make it", color: "#475569" },
  ];
  return (
    <Screen title="Event">
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {e.coverImageUrl && <Image source={{ uri: e.coverImageUrl }} style={{ width: "100%", height: 180 }} />}
        <View style={{ padding: 16, gap: 8 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{e.title}</Text>
          <Muted size={14}>
            {formatDateTime(e.startAt, e.timezone)}
            {e.endAt ? ` – ${formatDateTime(e.endAt, e.timezone)}` : ""} ({e.timezone})
          </Muted>
          <Muted size={14}>
            📍 {e.city}
            {e.venueName ? ` · ${e.venueName}` : ""}
          </Muted>
          {e.address && <Muted>{e.address}</Muted>}
          <Row>
            <Badge label={EVENT_KIND_LABELS[e.kind]} tone="info" />
            {e.isCancelled && <Badge label="Cancelled" tone="danger" />}
            <ModerationBadge status={e.moderationStatus} />
          </Row>
          <ModerationNote status={e.moderationStatus} note={e.moderationNote} />
          <RichText text={e.description} />
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            <Text style={{ fontWeight: "700", color: colors.text }}>{e.yesCount}</Text> going{e.maybeCount ? ` · ${e.maybeCount} maybe` : ""}
            {e.maxAttendees ? ` · ${Math.max(e.maxAttendees - e.yesCount, 0)} spots left` : ""}
          </Text>
          <Row>
            {options.map((o) => {
              const active = e.myRsvp === o.value;
              return (
                <Pressable
                  key={o.value}
                  disabled={disabled || (o.value === "YES" && full)}
                  onPress={() => rsvp.mutate(active ? null : o.value)}
                  accessibilityRole="button"
                  {...toggleState(active)}
                  aria-disabled={disabled || (o.value === "YES" && full)}
                  style={{ paddingHorizontal: 14, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: active ? o.color : "#fff", borderWidth: 1, borderColor: active ? o.color : colors.border, opacity: disabled ? 0.5 : 1 }}>
                  <Text style={{ color: active ? "#fff" : colors.text, fontWeight: "600" }}>
                    {active ? "✓ " : ""}
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
          {started && !e.isCancelled && <Muted>RSVPs are closed: this event has started.</Muted>}
          <Row style={{ justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
            <MemberRow slug={slug} member={e.author} meta="Organiser" />
            {!e.isMine && <ReportButton slug={slug} contentType="EVENT" contentId={e.id} />}
          </Row>
          {(e.isMine || isTenantAdmin) && (
            <Row>
              {e.isMine && <Button title="Edit" variant="outline" onPress={() => router.push(`/t/${slug}/events/edit/${e.id}`)} />}
              {!e.isCancelled && <Button title="Cancel event" variant="outline" onPress={() => Alert.alert("Cancel this event?", "Attendees will be notified.", [{ text: "Keep", style: "cancel" }, { text: "Cancel event", style: "destructive", onPress: () => cancel.mutate() }])} loading={cancel.isPending} />}
              {e.isMine && <Button title="Delete" variant="ghost" onPress={() => Alert.alert("Delete this event?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate() }])} />}
            </Row>
          )}
        </View>
      </Card>
      <Card>
        <Text style={{ fontWeight: "700", color: colors.text }}>Who&apos;s going</Text>
        {attendees.items.length === 0 && !attendees.isLoading && <Muted>No RSVPs yet — be the first!</Muted>}
        {attendees.items.map((m) => (
          <Pressable key={m.id} onPress={() => router.push(`/t/${slug}/directory/${m.id}`)} accessibilityRole="link">
            <Row gap={8}>
              <Avatar name={m.fullName} src={m.avatarUrl} size={28} />
              <Text style={{ color: colors.text }}>
                {m.fullName} <Muted>· {m.batchYear}</Muted>
              </Text>
            </Row>
          </Pressable>
        ))}
        {attendees.hasNextPage && <Button title="Show more" variant="ghost" onPress={attendees.loadMore} loading={attendees.isFetchingNextPage} />}
      </Card>
    </Screen>
  );
}
