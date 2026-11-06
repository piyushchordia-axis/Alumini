import { CONTENT_TYPE_LABELS, MODERATION_STATUS_LABELS, MODERATION_STATUS_TONE, REPORT_CONTENT_GONE_TEXT, REPORT_REASON_LABELS, reportShowsTitle, reportedByText, type AdminReportDto } from "@illuminize/shared";
import { StyleSheet, Text, View } from "react-native";
import { Badge, Button, Card } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";

export type ReportPrompt = "reportRemove" | "reportResolve" | "reportDismiss";

/**
 * One report: why, about what and where that content stands, who reported it and what they said, the content's words
 * (or that it's gone), and on an open report the three ways to close it, each asking for a note (`onAsk`, the screen's
 * one sheet). What becomes of it is said above the list, as the row leaves its tab.
 */
export function ReportRow({ report, onAsk }: { report: AdminReportDto; onAsk: (prompt: ReportPrompt) => void }) {
  const content = report.content;
  return (
    <Card style={styles.card}>
      <View style={styles.badges}>
        <Badge label={REPORT_REASON_LABELS[report.reason]} tone="danger" />
        <Badge label={CONTENT_TYPE_LABELS[report.contentType]} tone="info" />
        {content && <Badge label={MODERATION_STATUS_LABELS[content.moderationStatus]} tone={MODERATION_STATUS_TONE[content.moderationStatus]} />}
      </View>
      <Text style={styles.meta}>{reportedByText(report, timeAgo(report.createdAt))}</Text>
      {report.details ? (
        <Text selectable style={styles.details}>
          “{report.details}”
        </Text>
      ) : null}
      <View style={styles.content}>
        {content ? (
          <>
            {reportShowsTitle(content) && <Text style={styles.title}>{content.title}</Text>}
            <Text style={styles.words}>{content.excerpt ?? content.title}</Text>
          </>
        ) : (
          <Text style={styles.gone}>{REPORT_CONTENT_GONE_TEXT}</Text>
        )}
      </View>
      {report.resolutionNote ? <Text style={styles.meta}>Resolution: {report.resolutionNote}</Text> : null}
      {report.status === "OPEN" && (
        <View style={styles.actions}>
          <Button size="compact" variant="danger" title="Remove content" onPress={() => onAsk("reportRemove")} />
          <Button size="compact" variant="outline" title="Resolve, keep content" onPress={() => onAsk("reportResolve")} />
          <Button size="compact" variant="ghost" title="Dismiss" onPress={() => onAsk("reportDismiss")} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  meta: { fontSize: 12, color: colors.muted },
  details: { fontSize: 14, color: "#334155" },
  content: { gap: 2, borderRadius: radius.md, backgroundColor: "#f8fafc", padding: spacing.md },
  title: { fontSize: 14, fontWeight: "700", color: colors.text },
  words: { fontSize: 14, lineHeight: 20, color: "#1e293b" },
  gone: { fontSize: 14, fontStyle: "italic", color: colors.faint },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
