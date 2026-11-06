import { CONTENT_TYPE_LABELS, adminContentTarget, canPin, groupApproval, groupSeenNext, moderationActionsFor, moderationBylineText, moderationItemKey, reportCountLabel, type ContentAction, type GroupReview, type ModerationItemDto, type TenantFeatures } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ContentPreview } from "@/components/admin/ContentPreview";
import { IconAnnounce, IconExternalLink, IconFlag, IconPin } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { Badge, Button, Card, ErrorText, Spinner } from "@/components/ui";
import type { ModerationActions } from "@/hooks/useModerationActions";
import type { RowStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { targetHref } from "@/lib/notificationLinks";
import { qk } from "@/lib/queryKeys";
import { colors, radius, spacing, useTheme } from "@/theme";

const ACTION_BUTTONS: Readonly<Record<ContentAction, { title: string; variant: "primary" | "outline" | "danger" }>> = {
  approve: { title: "Approve", variant: "primary" },
  reject: { title: "Reject", variant: "outline" },
  remove: { title: "Remove", variant: "danger" },
  restore: { title: "Restore", variant: "outline" },
};

/**
 * One item of the moderation queue: its badges, author and opening words, its whole content on request (fetched the
 * first time it's opened), a way to see it in the member app, and what can be done to it in its status. Reject and Remove
 * ask for a note (`onAsk`, the screen's one sheet); the rest act on a tap. Whether it's open is the screen's, so a row
 * scrolled away and back stays as it was. "Open in app" leaves the console for the member app's own screen, down to the
 * tabs underneath (dismissTo) rather than a second set of them on top.
 */
export function ModerationRow({
  slug,
  item,
  features,
  expanded,
  status,
  actions,
  onToggle,
  onAsk,
  onReveal,
}: {
  slug: string;
  item: ModerationItemDto;
  features: TenantFeatures;
  expanded: boolean;
  status: RowStatus | null;
  actions: ModerationActions;
  onToggle: (open: boolean) => void;
  onAsk: (prompt: "reject" | "remove") => void;
  onReveal: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const key = moderationItemKey(item);
  const full = useQuery({ queryKey: qk.admin.content(slug, item.contentType, item.id), queryFn: () => api.admin.moderation.get(slug, item.contentType, item.id), enabled: expanded });
  const busy = actions.busyWith(item);
  const target = adminContentTarget(item.contentType, item.id, features);
  const href = target ? targetHref(slug, target, { isAdmin: true }) : null;
  const words = item.title ?? item.excerpt ?? "";
  // A group's name and description as its preview first showed them since it opened (or since this row was drawn): what
  // the admin read, which a refresh of the preview meanwhile, as when its owner edits it, mustn't swap just before Approve.
  const [seen, setSeen] = useState<GroupReview | null>(null);
  const seenNext = groupSeenNext(seen, expanded, full.data);
  if (seenNext !== seen) setSeen(seenNext);

  const approve = () => {
    const step = groupApproval(item.contentType, expanded ? full.data : null, seen);
    if (!step.send) {
      if (step.reason === "changed") setSeen(step.seen);
      onToggle(true);
      actions.sayRow({ id: key, text: step.hint, tone: step.reason === "changed" ? "warning" : "info" });
      onReveal();
      return;
    }
    actions.tap("approve", item, step.reviewed);
  };
  const press = (action: ContentAction) => {
    if (action === "approve") approve();
    else if (action === "restore") actions.tap("restore", item);
    else onAsk(action);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.badges}>
        <Badge label={CONTENT_TYPE_LABELS[item.contentType]} tone="info" />
        {item.kind === "ANNOUNCEMENT" && <Badge label="Announcement" tone="primary" icon={(c) => <IconAnnounce size={12} color={c} />} />}
        {item.isPinned && <Badge label="Pinned" icon={(c) => <IconPin size={12} color={c} />} />}
        {item.reportCount > 0 && <Badge label={reportCountLabel(item.reportCount)} tone="danger" icon={(c) => <IconFlag size={12} color={c} />} />}
      </View>
      <Text style={styles.byline}>{moderationBylineText(item, timeAgo(item.createdAt))}</Text>
      <Text numberOfLines={2} style={styles.words}>
        {words}
      </Text>
      <View style={styles.links}>
        <Pressable onPress={() => onToggle(!expanded)} accessibilityRole="button" aria-expanded={expanded} style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}>
          <Text style={[styles.linkText, { color: theme.primaryInk }]}>{expanded ? "Hide" : "View full content"}</Text>
        </Pressable>
        {href && (
          <Pressable onPress={() => router.dismissTo(href)} accessibilityRole="link" accessibilityLabel="Open in app" accessibilityHint="Leaves the admin console" style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}>
            <Text style={[styles.linkText, { color: theme.primaryInk }]}>Open in app</Text>
            <IconExternalLink size={14} color={theme.primaryInk} />
          </Pressable>
        )}
      </View>
      {expanded && (
        <View style={styles.panel}>
          {full.data ? (
            <ContentPreview type={item.contentType} content={full.data} />
          ) : full.error ? (
            <View style={{ gap: spacing.sm }}>
              <ErrorText error={full.error} />
              <Button size="compact" variant="outline" title="Try again" onPress={() => void full.refetch()} />
            </View>
          ) : (
            <Spinner label="Loading the content" />
          )}
        </View>
      )}
      <View style={styles.actions}>
        {moderationActionsFor(item.moderationStatus).map((action) => (
          <Button
            key={action}
            size="compact"
            title={ACTION_BUTTONS[action].title}
            variant={ACTION_BUTTONS[action].variant}
            // The same name on every row, as on the web console; which item it is follows on a phone.
            accessibilityHint={words || undefined}
            loading={busy === action}
            disabled={!!busy && busy !== action}
            style={styles.button}
            onPress={() => press(action)}
          />
        ))}
        {canPin(item.contentType, item.moderationStatus) && (
          <Button
            size="compact"
            variant="ghost"
            title={item.isPinned ? "Unpin" : "Pin"}
            accessibilityHint={words || undefined}
            icon={(c) => <IconPin size={16} color={c} />}
            loading={busy === "pin"}
            disabled={!!busy && busy !== "pin"}
            onPress={() => actions.pin(item, !item.isPinned)}
          />
        )}
      </View>
      <StatusLine flush text={status?.text ?? null} tone={status?.tone} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  byline: { fontSize: 12, color: colors.muted },
  words: { fontSize: 14, lineHeight: 20, color: colors.text },
  links: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg },
  link: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4 },
  linkText: { fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.6 },
  panel: { borderRadius: radius.md, backgroundColor: "#f8fafc", padding: spacing.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  button: { minWidth: 88 },
});
