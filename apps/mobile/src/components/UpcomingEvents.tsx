import { rsvpBadge, UPCOMING_EVENTS_SEE_ALL, UPCOMING_EVENTS_STRIP, UPCOMING_EVENTS_TITLE, upcomingEventName } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { EventDateTile } from "@/components/events/EventDateTile";
import { IconEvents } from "@/components/icons";
import { Badge, Card, headingRole } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors, radius, spacing, useTheme } from "@/theme";

// The strip's own text grows with the phone's text size up to twice its size, Android's largest. Past that (iOS's
// accessibility sizes) the event's page, a tap away, has it all; the answer's Badge isn't capped.
const TEXT_MAX_SCALE = 2;
const CHIP_WIDTH = 240;
const CHIP_PADDING = 10;
const TITLE_LINE = 19;
const TITLE_GAP = 2;
const PLACE_LINE = 16;
const ANSWER_GAP = 6;
// The Badge's padding and border around its text, and that text's line (12pt, at most about 16).
const BADGE_BOX = 6;
const BADGE_LINE = 16;
// Room to spare, so a line a little taller on one phone than this sum says doesn't grow the chip past its placeholder.
const SLACK = 8;
const HEADER_HEIGHT = 28;
const HEADING_LINE = 18;

type StripLayout = { width: number; minHeight: number; lines: number; header: number };

/**
 * The strip's sizes at the phone's text size, which the placeholder takes too, so the strip and the room it holds while
 * loading are one height at every size. A chip is as tall as the most its text can take: its padding, a title and a
 * date and place of `lines` lines each, and an answer (128 at the standard size). Larger text wraps onto more lines of
 * a wider chip rather than being cut short after two. Smaller text keeps the standard size.
 */
function stripLayout(fontScale: number, screenWidth: number): StripLayout {
  const text = Math.min(Math.max(fontScale, 1), TEXT_MAX_SCALE);
  const badge = Math.max(fontScale, 1);
  const lines = text > 1.6 ? 4 : text > 1.25 ? 3 : 2;
  const width = Math.round(Math.max(CHIP_WIDTH, Math.min(CHIP_WIDTH * text, screenWidth * 0.8)));
  const minHeight = Math.ceil(2 * CHIP_PADDING + TITLE_GAP + ANSWER_GAP + BADGE_BOX + lines * (TITLE_LINE + PLACE_LINE) * text + BADGE_LINE * badge) + SLACK;
  return { width, minHeight, lines, header: Math.max(HEADER_HEIGHT, Math.ceil(HEADING_LINE * text)) };
}

/**
 * The feed's next few events while Events is on (Events on the bar included, as at a school), each a link to its page
 * with its day, title, when and where, and the member's answer, then See all. Nothing when nothing is coming, or when
 * they can't be fetched; a placeholder of its height while they load, so the posts under it don't jump. Keyed under
 * ["events", slug], so an RSVP or any other change to an event refreshes it, and the feed's pull to refresh does too.
 * The web's phone feed has the same strip.
 */
export function UpcomingEvents({ slug }: { slug: string }) {
  const router = useRouter();
  const theme = useTheme();
  const { tenant } = useMembership();
  const { fontScale, width: screenWidth } = useWindowDimensions();
  const layout = stripLayout(fontScale, screenWidth);
  const on = tenant.settings.features.events;
  const upcoming = useQuery({ queryKey: qk.events(slug, UPCOMING_EVENTS_STRIP), queryFn: () => api.events.list(slug, UPCOMING_EVENTS_STRIP), enabled: on, staleTime: 60_000 });
  // Switched off while the app was open, a cached answer would still be there.
  if (!on) return null;
  if (!upcoming.data) return upcoming.isLoading ? <UpcomingEventsPlaceholder layout={layout} /> : null;
  const events = upcoming.data.data;
  if (events.length === 0) return null;
  const chip = { width: layout.width, minHeight: layout.minHeight };
  return (
    <View role="region" aria-label={UPCOMING_EVENTS_TITLE}>
      <Card style={styles.card}>
        <View style={[styles.header, { minHeight: layout.header }]}>
          <IconEvents size={16} color={theme.primaryInk} />
          <Text {...headingRole(2)} maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.heading}>
            {UPCOMING_EVENTS_TITLE}
          </Text>
          <Pressable onPress={() => router.push(`/t/${slug}/events`)} accessibilityRole="link" accessibilityLabel={UPCOMING_EVENTS_SEE_ALL.name} style={({ pressed }) => [styles.seeAll, pressed ? styles.pressed : null]}>
            <Text maxFontSizeMultiplier={TEXT_MAX_SCALE} style={[styles.seeAllText, { color: theme.primaryInk }]}>
              {UPCOMING_EVENTS_SEE_ALL.label}
            </Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View role="list" style={styles.chips}>
            {events.map((e) => {
              const when = formatDateTime(e.startAt, e.timezone);
              const rsvp = rsvpBadge(e.myRsvp);
              return (
                <View key={e.id} role="listitem">
                  {/* withAnchor: the Events stack may not be mounted yet, and would hold this one screen with no list to go back to. */}
                  <Pressable
                    onPress={() => router.push(`/t/${slug}/events/${e.id}`, { withAnchor: true })}
                    accessibilityRole="link"
                    accessibilityLabel={upcomingEventName(e, when)}
                    style={({ pressed }) => [styles.chip, chip, pressed ? styles.chipPressed : null]}
                  >
                    <EventDateTile startAt={e.startAt} timezone={e.timezone} size="sm" />
                    <View style={styles.text}>
                      <Text numberOfLines={layout.lines} maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.title}>
                        {e.title}
                      </Text>
                      <Text numberOfLines={layout.lines} maxFontSizeMultiplier={TEXT_MAX_SCALE} style={styles.line}>
                        {when} · {e.city}
                      </Text>
                      {rsvp && (
                        <View style={styles.answer}>
                          <Badge label={rsvp.label} tone={rsvp.tone} />
                        </View>
                      )}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </Card>
    </View>
  );
}

/** The strip's shape while its events load, at its sizes: no words and nothing to press, so screen readers skip it. */
function UpcomingEventsPlaceholder({ layout }: { layout: StripLayout }) {
  const chip = [styles.chip, { width: layout.width, minHeight: layout.minHeight }];
  return (
    <View aria-hidden testID="upcoming-events-loading">
      <Card style={styles.card}>
        <View style={[styles.header, { minHeight: layout.header }]}>
          <View style={styles.headingBar} />
        </View>
        <View style={[styles.chips, { overflow: "hidden" }]}>
          <View style={chip} />
          <View style={chip} />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: spacing.sm },
  // As tall as See all is drawn, or the heading at a large text size (stripLayout's header), so the placeholder's
  // header is the same.
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  heading: { flex: 1, fontWeight: "700", color: colors.text, fontSize: 14, lineHeight: HEADING_LINE },
  headingBar: { width: 144, height: 14, borderRadius: radius.full, backgroundColor: colors.bg },
  // A full 44-point target, drawn no taller than the heading.
  seeAll: { minHeight: 44, minWidth: 44, marginVertical: -8, marginRight: -spacing.sm, paddingHorizontal: spacing.sm, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  seeAllText: { fontSize: 14, lineHeight: HEADING_LINE, fontWeight: "600" },
  pressed: { backgroundColor: colors.bg },
  chips: { flexDirection: "row", gap: spacing.sm },
  // Its width and height come from stripLayout, which the placeholder's chips share.
  chip: { flexDirection: "row", gap: 10, padding: CHIP_PADDING, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: "#f8fafc" },
  chipPressed: { backgroundColor: colors.bg },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: TITLE_LINE, fontWeight: "600", color: colors.text },
  line: { marginTop: TITLE_GAP, fontSize: 12, lineHeight: PLACE_LINE, color: colors.muted },
  answer: { marginTop: "auto", paddingTop: ANSWER_GAP },
});
