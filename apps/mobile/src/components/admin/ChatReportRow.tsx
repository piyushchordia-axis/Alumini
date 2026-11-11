import {
  CHAT_REPORT_FILES_LOST_TEXT,
  CHAT_REPORT_FILES_TEXT,
  CHAT_REPORT_MESSAGE_GONE_TEXT,
  CHAT_REPORT_TARGET_KIND_LABELS,
  CHAT_REPORT_VIEW_HINT,
  REPORT_REASON_LABELS,
  chatReportActionLabel,
  chatReportActionsFor,
  chatReportHasFiles,
  chatReportHeadline,
  chatReportMemberLinkText,
  chatReportSenderLabel,
  chatReportViewLabel,
  type AdminChatAttachmentDto,
  type AdminChatReportDto,
  type AdminChatReportMessageDto,
  type AdminChatReportViewDto,
  type ChatReportCloseAction,
} from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { AttachmentGrid } from "@/components/chat/AttachmentGrid";
import { PhotoViewerFrame } from "@/components/chat/PhotoViewer";
import { IconAlert, IconChevronRight } from "@/components/icons";
import { StatusLine } from "@/components/Sheet";
import { Badge, Button, Card, focusOn, type Focusable } from "@/components/ui";
import { openAttachmentFrom } from "@/lib/chatAttachments";
import { formatDateTime, timeAgo } from "@/lib/format";
import { colors, radius, spacing, useTheme } from "@/theme";

const VARIANT: Readonly<Record<ChatReportCloseAction, "danger" | "outline" | "ghost">> = { remove: "danger", resolve: "outline", dismiss: "ghost" };

/**
 * What a view's photos and files do: whether they still open, and what opening one, a photo failing to load and its Try
 * again do.
 */
interface ReportFiles {
  lost: boolean;
  /** The file being downloaded to open. */
  opening: string | null;
  onOpen: (message: AdminChatReportMessageDto, index: number, opener: Focusable | null) => void;
  onOpenFile: (attachment: AdminChatAttachmentDto) => void;
  onFailed: () => void;
  onRetry: () => void;
}

/**
 * A reported message with the messages around it, oldest first, as they read in the thread. The reported one is marked
 * by a badge as well as its colour. The words can't be selected, so the phone's copy menu never offers them. Each
 * message's photos and files are under it, from the links the view came with, kept in no image cache; once they no
 * longer open, the photos fail as a photo that didn't load does and the files can't be opened. Until then, a photo that
 * didn't load fails alone, and loads again from its link.
 */
export function ReportedMessages({ messages, files }: { messages: AdminChatReportMessageDto[]; files: ReportFiles }) {
  if (messages.length === 0) return <Text style={styles.gone}>{CHAT_REPORT_MESSAGE_GONE_TEXT}</Text>;
  return (
    <View role="list" aria-label="The reported message and the messages around it, oldest first" style={styles.thread}>
      {messages.map((m) => (
        <View key={m.id} role="listitem" style={[styles.message, m.isTarget ? styles.target : null]}>
          <View style={styles.messageHead}>
            <Text style={styles.sender}>{chatReportSenderLabel(m)}</Text>
            <Text style={styles.time}>{formatDateTime(m.createdAt)}</Text>
            {m.isTarget && <Badge label="Reported message" tone="danger" />}
            {m.removed && <Badge label="Removed" />}
          </View>
          {m.body ? (
            <Text selectable={false} style={styles.body}>
              {m.body}
            </Text>
          ) : null}
          {m.attachments.length > 0 && (
            <View style={styles.attachments}>
              <AttachmentGrid
                compact
                cachePolicy="none"
                attachments={m.attachments}
                sourceOf={(a) => (files.lost ? { uri: null, broken: true } : { uri: a.thumbUrl ?? a.url })}
                opening={files.opening}
                onOpen={(index, opener) => files.onOpen(m, index, opener)}
                onOpenFile={files.lost ? undefined : files.onOpenFile}
                onImageError={files.onFailed}
                onRetry={files.onRetry}
              />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * One chat report. Closed, it says who reported whom, why and when, and no words, with the button that opens it and the
 * reminder that each view is audited. Open (`view`, for one report on the screen at a time), it shows the reporter's
 * note, the messages or the reported request with their photos and files, a way to the reported member's page, and on an
 * open report the ways to close it, each asking for a note through the screen's sheet (`onAsk`).
 *
 * The photos and files open from the view's own links while `filesOpen` says they still work; after that, Try again views
 * the report again (`onView`), which is another audited view: the messages close while it comes, as every view's do
 * here, and focus then goes to the line saying how long the new links last. A photo opens over the screen with no Report
 * message, and a file goes to the share sheet. What the row keeps of a view (the photo open, a file being downloaded, a
 * problem) goes when the view does, and a download still running then hands nothing over.
 */
export function ChatReportRow({
  report,
  view,
  opening,
  problem,
  filesOpen,
  onView,
  onHide,
  onAsk,
  onOpenMember,
}: {
  report: AdminChatReportDto;
  view: AdminChatReportViewDto | null;
  opening: boolean;
  problem: string | null;
  /** Whether the open view's photos and files may still be opened. */
  filesOpen: () => boolean;
  onView: () => void;
  onHide: () => void;
  onAsk: (action: ChatReportCloseAction) => void;
  onOpenMember: (membershipId: string) => void;
}) {
  const theme = useTheme();
  const reported = report.reported;
  // Its photos and files no longer open: their links ran out.
  const [lost, setLost] = useState(false);
  // The photo open over the screen and the photo that opened it; `open` goes false first on iOS, which says when the
  // viewer has gone. And the file being downloaded to share.
  const [viewing, setViewing] = useState<{ messageId: string; index: number; opener: Focusable | null; open: boolean } | null>(null);
  const [openingFile, setOpeningFile] = useState<string | null>(null);
  const [filesProblem, setFilesProblem] = useState<string | null>(null);
  // Nothing of one view outlives it: each closes before another opens (useChatReportView), so this clears what the row
  // kept between any two, in render so that no frame shows a photo of a view that has gone. The view itself, links and
  // all, stays in the hook's state alone.
  if (!view && (lost || viewing || openingFile || filesProblem)) {
    setLost(false);
    setViewing(null);
    setOpeningFile(null);
    setFilesProblem(null);
  }
  // The view on screen after each render, for a download to know whether the view that started it is still there.
  const shownView = useRef(view);
  const retryButton = useRef<Focusable>(null);
  const filesNote = useRef<Focusable>(null);
  const viewButton = useRef<Focusable>(null);
  // Once they stop working, what had focus may go (the photo viewer, a photo that becomes a mark, a file that can't be
  // opened any more), and focus goes to Try again rather than nowhere, once the viewer has gone.
  const focusRetry = useRef(false);
  // Try again was pressed: focus goes to the new view's files line when it comes, or to View messages if it failed.
  const retried = useRef(false);
  useEffect(() => {
    shownView.current = view;
    if (!view) focusRetry.current = false;
  }, [view]);
  useEffect(() => {
    if (!lost || viewing || !focusRetry.current) return;
    focusRetry.current = false;
    focusOn(retryButton.current);
  }, [lost, viewing]);
  useEffect(() => {
    if (!retried.current || opening) return;
    retried.current = false;
    if (view) focusOn(filesNote.current);
    else if (problem) focusOn(viewButton.current);
  }, [view, opening, problem]);

  /** The viewer has gone: focus goes back to the photo that opened it, unless Try again is taking it. */
  const viewerGone = () => {
    const opener = viewing?.opener;
    setViewing(null);
    if (!focusRetry.current) focusOn(opener);
  };
  // On iOS the viewer is hidden first and gone once it says so (onDismiss); elsewhere it goes at once.
  const closeViewer = () => (Platform.OS === "ios" ? setViewing((v) => (v ? { ...v, open: false } : v)) : viewerGone());
  /**
   * The links have run out. Focus goes to Try again when the admin just pressed a photo or a file (`pressed`), which goes,
   * or the photo viewer was open, which closes; not for a photo failing to load by itself.
   */
  const markLost = (pressed: boolean) => {
    setLost(true);
    if (pressed || viewing) focusRetry.current = true;
    if (viewing) closeViewer();
  };
  /** Downloads a file or photo of this view to share, handing it over only while this view is still the one shown. */
  const share = (attachment: AdminChatAttachmentDto) => {
    const mine = view;
    const wanted = () => shownView.current === mine;
    return { wanted, done: openAttachmentFrom(attachment.downloadUrl, attachment, wanted) };
  };
  const openFile = async (attachment: AdminChatAttachmentDto) => {
    if (openingFile) return;
    if (!filesOpen()) return markLost(true);
    setFilesProblem(null);
    setOpeningFile(attachment.id);
    const { wanted, done } = share(attachment);
    try {
      await done;
    } catch (err) {
      if (wanted()) setFilesProblem(errorMessage(err));
    } finally {
      if (wanted()) setOpeningFile(null);
    }
  };
  // A photo that fails to load while the links should still work (a dropped request, a stored copy gone) fails alone.
  const files: ReportFiles = {
    lost,
    opening: openingFile,
    onOpen: (message, index, opener) => (filesOpen() ? setViewing({ messageId: message.id, index, opener, open: true }) : markLost(true)),
    onOpenFile: (attachment) => void openFile(attachment),
    onFailed: () => {
      if (!filesOpen()) markLost(false);
    },
    onRetry: () => {
      if (!filesOpen()) markLost(true);
    },
  };
  const retryView = () => {
    retried.current = true;
    onView();
  };
  const viewed = viewing && view?.messages.find((m) => m.id === viewing.messageId);
  const viewedPhotos = viewed ? viewed.attachments.filter((a) => a.kind === "PHOTO") : [];
  return (
    <Card style={styles.card}>
      <View style={styles.badges}>
        <Badge label={REPORT_REASON_LABELS[report.reason]} tone="danger" />
        <Badge label={CHAT_REPORT_TARGET_KIND_LABELS[report.targetKind]} tone="info" />
        {report.resolutionAction === "REMOVE_MESSAGE" && <Badge label="Message removed" />}
      </View>
      <Text style={styles.meta}>
        {chatReportHeadline(report)} · {timeAgo(report.createdAt)}
      </Text>
      {view ? (
        <View style={styles.open}>
          {view.details ? (
            <Text selectable={false} style={styles.note}>
              <Text style={styles.strong}>{"Reporter's note:"}</Text> {view.details}
            </Text>
          ) : null}
          {report.targetKind === "MESSAGE" ? (
            <ReportedMessages messages={view.messages} files={files} />
          ) : (
            <View style={[styles.message, styles.target]}>
              <Text selectable={false} style={styles.body}>
                {view.noteSnapshot}
              </Text>
            </View>
          )}
          {chatReportHasFiles(view) && (
            <View style={styles.files}>
              {/* Focusable, for focus to land on once a Try again has brought new links. */}
              <View ref={filesNote} accessible tabIndex={-1}>
                <Text style={styles.meta}>{CHAT_REPORT_FILES_TEXT}</Text>
              </View>
              <StatusLine flush tone="warning" icon={(color) => <IconAlert size={16} color={color} />} text={lost ? CHAT_REPORT_FILES_LOST_TEXT : filesProblem} />
              {lost && <Button ref={retryButton} size="compact" variant="outline" title="Try again" accessibilityHint={CHAT_REPORT_FILES_LOST_TEXT} onPress={retryView} style={styles.retry} />}
            </View>
          )}
          {view.resolutionNote ? (
            <Text selectable={false} style={styles.meta}>
              Resolution: {view.resolutionNote}
            </Text>
          ) : null}
          {reported && (
            <View>
              <Text style={styles.meta}>To suspend them, open</Text>
              <Pressable onPress={() => onOpenMember(reported.id)} accessibilityRole="link" style={({ pressed }) => [styles.link, pressed ? { opacity: 0.6 } : null]}>
                <Text style={[styles.linkText, { color: theme.primaryInk }]}>{chatReportMemberLinkText(reported)}</Text>
                <IconChevronRight size={14} color={theme.primaryInk} />
              </Pressable>
            </View>
          )}
          <View style={styles.actions}>
            {chatReportActionsFor(report).map((action) => (
              <Button key={action} size="compact" variant={VARIANT[action]} title={chatReportActionLabel(action, report.targetKind)} onPress={() => onAsk(action)} />
            ))}
            <Button size="compact" variant="ghost" title="Hide" onPress={onHide} />
          </View>
        </View>
      ) : (
        <View style={styles.closed}>
          <Button ref={viewButton} size="compact" variant="outline" title={chatReportViewLabel(report.targetKind)} loading={opening} onPress={onView} />
          <Text style={styles.hint}>{CHAT_REPORT_VIEW_HINT}</Text>
        </View>
      )}
      <StatusLine flush text={problem} tone="warning" />
      {viewing && viewed && viewedPhotos.length > 0 && (
        <PhotoViewerFrame
          open={viewing.open}
          photos={viewedPhotos}
          startIndex={viewing.index}
          who={chatReportSenderLabel(viewed)}
          sentAt={viewed.createdAt}
          cachePolicy="none"
          linkOf={(photo) => photo}
          lost={false}
          retrying={false}
          onShare={async (photo) => {
            if (filesOpen()) await share(photo).done;
            else markLost(true);
          }}
          onImageError={files.onFailed}
          onClose={closeViewer}
          onDismiss={viewerGone}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  meta: { fontSize: 12, color: colors.muted },
  closed: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  hint: { flexShrink: 1, fontSize: 12, color: colors.muted },
  open: { gap: spacing.md },
  note: { fontSize: 14, color: "#334155" },
  strong: { fontWeight: "700" },
  thread: { gap: spacing.sm },
  message: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: 4, backgroundColor: colors.card },
  target: { borderColor: "#fca5a5", backgroundColor: "#fef2f2" },
  messageHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  sender: { fontSize: 13, fontWeight: "700", color: colors.text },
  time: { fontSize: 12, color: colors.muted },
  body: { fontSize: 14, lineHeight: 20, color: "#1e293b" },
  gone: { fontSize: 14, fontStyle: "italic", color: colors.muted },
  link: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, minHeight: 44 },
  linkText: { fontSize: 14, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  attachments: { marginTop: 4 },
  files: { gap: spacing.sm },
  retry: { alignSelf: "flex-start" },
});
