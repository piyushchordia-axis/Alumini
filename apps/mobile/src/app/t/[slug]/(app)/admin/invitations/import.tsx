import {
  INVITATION_CSV_HINT,
  INVITATION_TEMPLATE_FILE,
  formatCount,
  importDoneText,
  importIgnoredText,
  importInChunks,
  importProblems,
  importProgressText,
  importResultText,
  importSummaryText,
  invitationTemplateCsv,
  partialImportText,
  readInvitationCsv,
  rowCountText,
  sendNowLabel,
  withBom,
  type ChunkedImportOutcome,
  type InvitationImportRow,
  type InviteImportMapping,
} from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { IconDownload, IconUpload } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { Button, Card, Choice, ErrorText, Muted, Spinner } from "@/components/ui";
import { useAdminProfileFields } from "@/hooks/useAdminProfileFields";
import { refreshInvitations, useInvitationSummary } from "@/hooks/useAdminInvitations";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { CSV_FILE_TYPES, UnreadableFileError, pickTextFile, saveFile } from "@/lib/files";
import { leaveGroupNotice } from "@/lib/groups";
import { colors, spacing } from "@/theme";

/** Rows shown before importing, and problems listed after it before "Show all". */
const PREVIEW_ROWS = 5;
const PROBLEMS_SHOWN = 50;

const KEEP_OPEN = "Keep this screen open until the import finishes.";

/** Leaving by going back: Android's back button, iOS's swipe down (cancelled by the stack and reported as POP), the bar's Back. */
const BACK_ACTIONS = new Set(["GO_BACK", "POP"]);

/**
 * Importing a list of invitations, a modal above the console's list, as the web console's Import card: a CSV picked
 * from the phone (or the web build's file chooser), its first rows and the columns used, whether to send at once, then
 * the import in requests of 500 rows with its progress, and what came of each problem row, by line. It waits for the
 * institution's questions, as their keys are columns too. Nothing takes it away while an import runs: an import left
 * half done would leave the admin guessing which rows went.
 */
export default function InvitationImportScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const fields = useAdminProfileFields(slug, false);
  const summary = useInvitationSummary(slug);
  const channels = summary.data?.channels ?? [];
  const ready = !!fields.data;

  const [picked, setPicked] = useState<{ fileName: string; mapping: InviteImportMapping } | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  // Untouched, sending follows the plan once the summary is in: on when it sends.
  const [sendChoice, setSendChoice] = useState<boolean | null>(null);
  const sendNow = (sendChoice ?? channels.length > 0) && channels.length > 0;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<ChunkedImportOutcome | null>(null);
  const [showAll, setShowAll] = useState(false);
  const picking = useRef(false);

  const run = useMutation({
    mutationFn: ({ rows, send }: { rows: InvitationImportRow[]; send: boolean }) =>
      importInChunks(rows, (chunk) => api.admin.invitations.import(slug, { rows: chunk.rows, send, rowOffset: chunk.rowOffset }), { fields: fields.data, onProgress: (done, total) => setProgress({ done, total }) }),
    onMutate: ({ rows }) => {
      setOutcome(null);
      setShowAll(false);
      setProgress({ done: 0, total: rows.length });
    },
    onSuccess: (result) => {
      setOutcome(result);
      // Kept after a failed request, so Import sends the file again.
      if (!result.error) setPicked(null);
    },
    // Here rather than in mutate's options, so it still runs if the screen has gone.
    onSettled: () => {
      setProgress(null);
      void refreshInvitations(qc, slug);
    },
  });
  const importing = run.isPending;

  usePreventRemove(importing, ({ data, repeat }) => {
    // Anything but going back (a sign-out) goes ahead.
    if (!BACK_ACTIONS.has(data.action.type)) return repeat();
    if (Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(KEEP_OPEN);
  });

  // Back to the list it was opened from; opened cold (a link, or a reload on the web build), the console's home is under
  // it instead, so the list takes its place. Either way the list says what the import did as it shows.
  const done = () => {
    if (outcome) leaveGroupNotice("admin:invitations", importDoneText(outcome.result));
    const state = navigation.getState();
    const below = state && state.index > 0 ? state.routes[state.index - 1] : undefined;
    if (below && /^invitations(\/index)?$/.test(below.name)) router.back();
    else router.replace(`/t/${slug}/admin/invitations`);
  };

  const choose = async () => {
    if (!fields.data || picking.current) return;
    picking.current = true;
    setPickError(null);
    try {
      const file = await pickTextFile(CSV_FILE_TYPES);
      if (!file) return;
      const read = readInvitationCsv(file.text, fields.data);
      setOutcome(null);
      if (!read.mapping) {
        setPicked(null);
        setPickError(read.problem);
        return;
      }
      setPicked({ fileName: file.name, mapping: read.mapping });
    } catch (err) {
      setPickError(err instanceof UnreadableFileError ? err.message : new UnreadableFileError().message);
    } finally {
      picking.current = false;
    }
  };

  const saveTemplate = async () => {
    if (!fields.data) return;
    setTemplateError(null);
    try {
      await saveFile(INVITATION_TEMPLATE_FILE, withBom(invitationTemplateCsv(fields.data)), "text/csv");
    } catch (err) {
      setTemplateError(err instanceof Error && err.message ? err.message : "Couldn't save the template");
    }
  };

  const problems = outcome ? importProblems(outcome.result) : [];
  const rows = picked?.mapping.rows ?? [];
  const ignored = picked ? importIgnoredText(picked.mapping) : null;
  return (
    <AdminScreen title="Import a list">
      <Muted size={13}>{"A CSV with a phone column, and optionally name, batch, email and your profile field keys. Numbers without a country code use your institution's country."}</Muted>
      <Muted size={13}>{INVITATION_CSV_HINT}</Muted>
      {fields.error && !fields.data ? (
        <>
          <ErrorText error={`Couldn't load your profile questions: ${errorMessage(fields.error)}`} />
          <Button title="Try again" variant="outline" onPress={() => void fields.refetch()} />
        </>
      ) : !ready ? (
        <Spinner label="Loading your profile questions" />
      ) : null}
      {!picked && (
        <View style={styles.buttons}>
          <Button title="Choose CSV file" variant={outcome ? "outline" : "primary"} style={styles.grow} disabled={!ready || importing} icon={(c) => <IconUpload size={18} color={c} />} onPress={() => void choose()} />
          <Button title="Template" variant="ghost" style={styles.grow} disabled={!ready || importing} icon={(c) => <IconDownload size={18} color={c} />} onPress={() => void saveTemplate()} />
        </View>
      )}
      <ErrorText error={pickError} />
      <ErrorText error={templateError} />
      {picked && (
        <Card style={styles.preview}>
          <Text style={styles.summary}>
            <Text style={styles.strong}>{picked.fileName}</Text>: {importSummaryText(picked.mapping)}
          </Text>
          {ignored ? <Muted size={13}>{ignored}</Muted> : null}
          <View role="list" aria-label="First rows">
            {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
              <View key={i} role="listitem" style={styles.previewRow}>
                <Text style={styles.phone}>{r.phone || "—"}</Text>
                {[r.name, r.batchYear, r.email].some(Boolean) ? <Text style={styles.previewMeta}>{[r.name, r.batchYear, r.email].filter(Boolean).join(" · ")}</Text> : null}
              </View>
            ))}
          </View>
          {rows.length > PREVIEW_ROWS ? <Muted size={12}>…and {formatCount(rows.length - PREVIEW_ROWS)} more</Muted> : null}
          <Choice kind="checkbox" label={sendNowLabel(channels)} checked={sendNow} disabled={channels.length === 0 || importing} onPress={() => setSendChoice(!sendNow)} />
          <Button title={progress ? importProgressText(progress.done, progress.total) : `Import ${rowCountText(rows.length)}`} disabled={importing} onPress={() => run.mutate({ rows, send: sendNow })} />
          {progress ? <Muted size={13}>{KEEP_OPEN}</Muted> : null}
          <Button title="Choose another file" variant="ghost" disabled={importing} onPress={() => void choose()} />
        </Card>
      )}
      {outcome && (
        <View style={styles.result}>
          {outcome.error ? <ErrorText error={[errorMessage(outcome.error), partialImportText(outcome.imported, outcome.error)].filter(Boolean).join(" ")} /> : null}
          {!outcome.error || outcome.imported > 0 ? (
            <StatusLine flush text={importResultText(outcome.result)} />
          ) : null}
          {problems.length > 0 && (
            <View role="list" aria-label="Rows not imported" style={styles.problems}>
              {(showAll ? problems : problems.slice(0, PROBLEMS_SHOWN)).map((p) => (
                <Text key={p.row} role="listitem" style={styles.problem}>
                  Line {p.row} <Text style={styles.phone}>{p.phone}</Text>: <Text style={{ color: p.status === "invalid" ? colors.danger : colors.muted }}>{p.message}</Text>
                </Text>
              ))}
            </View>
          )}
          {problems.length > PROBLEMS_SHOWN && !showAll ? <Button title={`Show all ${formatCount(problems.length)} problems`} variant="ghost" onPress={() => setShowAll(true)} /> : null}
          {!picked && <Button title="Done" onPress={done} />}
        </View>
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  grow: { flexGrow: 1 },
  preview: { gap: spacing.sm },
  summary: { fontSize: 14, color: colors.text },
  strong: { fontWeight: "700" },
  previewRow: { paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  phone: { fontSize: 13, color: colors.text, fontVariant: ["tabular-nums"] },
  previewMeta: { fontSize: 12, color: colors.muted },
  result: { gap: spacing.sm },
  problems: { gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md },
  problem: { fontSize: 12, color: colors.text },
});
