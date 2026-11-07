import { ATTENDEES_TITLE, attendeesEmpty, attendeeTabs, EVENT_KIND_LABELS, GREYS, memberYearsLabel, RSVP_GROUP_LABEL, rsvpChoices, rsvpClosedText, rsvpsOpen, STATUS_TONES, type AttendeeList, type RsvpStatus } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { IconCheck, IconEvents, IconMapPin } from "@/components/icons";
import { MemberRow } from "@/components/MemberRow";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { ReportButton } from "@/components/ReportButton";
import { RichText } from "@/components/RichText";
import { Avatar, Badge, Button, Card, EmptyState, headingRole, ListEmpty, LoadError, Muted, Row, Screen, Spinner, Tabs, toggleState } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

export default function EventDetailScreen() {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: qk.event(slug, id), queryFn: () => api.events.get(slug, id) });
  const [openedAt] = useState(() => Date.now());
  const [who, setWho] = useState<AttendeeList>("YES");
  // Under the event's key, so an RSVP refreshes both lists.
  const attendees = useInfiniteList([...qk.attendees(slug, id), who], (cursor) => api.events.attendees(slug, id, { status: who, cursor, limit: 30 }), !!ev.data);
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
  const disabled = !rsvpsOpen(e, openedAt) || rsvp.isPending;
  const closedText = rsvpClosedText(e, openedAt);
  const noOne = attendeesEmpty(who, e, openedAt);
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View aria-hidden>
              <IconMapPin size={16} color={colors.faint} />
            </View>
            <Text style={{ flex: 1, color: colors.muted, fontSize: 14 }}>
              {e.city}
              {e.venueName ? ` · ${e.venueName}` : ""}
            </Text>
          </View>
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
          <View role="group" aria-label={RSVP_GROUP_LABEL} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {rsvpChoices(e).map((o) => {
              // As the web draws them: a chosen answer is its tone's fill, edge and ink (STATUS_TONES), and the others are white,
              // with the web's slate-300 edge (borderStrong) and slate-700 label (GREYS.body).
              const tone = STATUS_TONES[o.tone];
              const off = disabled || o.full;
              return (
                <Pressable
                  key={o.value}
                  disabled={off}
                  onPress={() => rsvp.mutate(o.chosen ? null : o.value)}
                  accessibilityRole="button"
                  {...toggleState(o.chosen)}
                  aria-disabled={off}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, minHeight: 44, borderRadius: 10, borderWidth: 1, backgroundColor: o.chosen ? tone.fill : colors.card, borderColor: o.chosen ? tone.edge : colors.borderStrong, opacity: off ? 0.5 : 1 }}
                >
                  {o.chosen && (
                    <View aria-hidden>
                      <IconCheck size={16} strokeWidth={2.5} color={tone.ink} />
                    </View>
                  )}
                  <Text style={{ fontSize: 14, color: o.chosen ? tone.ink : GREYS.body, fontWeight: o.chosen ? "600" : "500" }}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {closedText && <Muted>{closedText}</Muted>}
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
        <Text {...headingRole(2)} style={{ fontWeight: "700", color: colors.text }}>
          {ATTENDEES_TITLE}
        </Text>
        <Tabs tall value={who} onChange={setWho} tabs={attendeeTabs(e)} />
        {attendees.items.length === 0 && (
          <ListEmpty loading={attendees.isLoading} error={attendees.error} onRetry={() => void attendees.refetch()}>
            <EmptyState inline icon={<IconEvents />} title={noOne.title} description={noOne.description} />
          </ListEmpty>
        )}
        {attendees.items.map((m) => (
          <Pressable key={m.id} onPress={() => router.push(`/t/${slug}/directory/${m.id}`)} accessibilityRole="link">
            <Row gap={8}>
              <Avatar name={m.fullName} src={m.avatarUrl} size={28} toneKey={m.id} />
              <Text style={{ color: colors.text }}>
                {m.fullName} <Muted>· {memberYearsLabel(m)}</Muted>
              </Text>
            </Row>
          </Pressable>
        ))}
        {attendees.hasNextPage && <Button title="Show more" variant="ghost" onPress={attendees.loadMore} loading={attendees.isFetchingNextPage} />}
      </Card>
    </Screen>
  );
}
