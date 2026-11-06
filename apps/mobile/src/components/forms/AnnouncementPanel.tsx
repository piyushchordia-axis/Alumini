import { ANNOUNCEMENT_NO_CHANNELS, ANNOUNCEMENT_ONE_MESSAGE, ANNOUNCEMENT_PIN_LABEL, DIM_PAGE_TEXT, announcementChannelLabel, announcementReachText, type AnnouncementAudienceDto, type AnnouncementOptions } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { IconAnnounce } from "@/components/icons";
import { Choice, FieldError, Row } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, radius, spacing, useTheme } from "@/theme";

/** Who an announcement would reach by each channel, asked only while Announce is on, as on the web composer. */
export function useAnnouncementAudience(slug: string, on: boolean) {
  return useQuery({ queryKey: qk.admin.announcementAudience(slug), queryFn: () => api.admin.announcements.audience(slug), enabled: on });
}

/**
 * The post form's Announce panel: who gets it, Pin, and the channels the institution's plan includes, each with how many
 * it reaches (and, with several, that each member still gets one message). Until the audience has loaded there are no
 * channels to choose.
 */
export function AnnouncementPanel({ value, onChange, audience, error }: { value: AnnouncementOptions; onChange: (v: AnnouncementOptions) => void; audience?: AnnouncementAudienceDto; error?: string }) {
  const theme = useTheme();
  return (
    <View role="group" aria-label="Announcement" style={{ gap: spacing.sm, borderWidth: 1, borderColor: theme.primaryRing, backgroundColor: theme.primaryWash, borderRadius: radius.md, padding: spacing.md }}>
      <Row gap={6}>
        <IconAnnounce size={16} color={theme.primaryInk} />
        <Text style={{ fontWeight: "700", color: colors.text }}>Announcement</Text>
      </Row>
      <Text style={{ fontSize: 13, color: DIM_PAGE_TEXT }}>{announcementReachText(audience)}</Text>
      <Choice kind="checkbox" label={ANNOUNCEMENT_PIN_LABEL} checked={value.pin} onPress={() => onChange({ ...value, pin: !value.pin })} />
      {audience?.channels.map((c) => {
        const on = value.channels.includes(c);
        return <Choice key={c} kind="checkbox" label={announcementChannelLabel(c, audience)} checked={on} onPress={() => onChange({ ...value, channels: on ? value.channels.filter((x) => x !== c) : [...value.channels, c] })} />;
      })}
      {audience && audience.channels.length > 1 ? <Text style={{ fontSize: 12, color: DIM_PAGE_TEXT }}>{ANNOUNCEMENT_ONE_MESSAGE}</Text> : null}
      {audience && audience.channels.length === 0 ? <Text style={{ fontSize: 12, color: DIM_PAGE_TEXT }}>{ANNOUNCEMENT_NO_CHANNELS}</Text> : null}
      <FieldError error={error} />
    </View>
  );
}
