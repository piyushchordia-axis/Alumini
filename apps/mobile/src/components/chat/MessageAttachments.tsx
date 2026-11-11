import type { ChatAttachmentDto, ChatMessageDto } from "@illuminize/shared";
import type { OutboxAttachment } from "@illuminize/shared/chat";
import { errorMessage } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AttachmentGrid, type PhotoSource } from "@/components/chat/AttachmentGrid";
import type { Focusable } from "@/components/ui";
import { attachmentLinksQuery, openAttachment, sentPreviewOf } from "@/lib/chatAttachments";

/** Links older than this when a photo fails to load may have expired, so they're fetched again once without asking. */
const MAYBE_EXPIRED_AFTER_MS = 30_000;

/**
 * Opening a message's files: downloaded from fresh links and handed to the share sheet (on the web build, downloaded), one
 * at a time, saying through `onProblem` what went wrong. `opening` is the file under way, for its row to show it's busy.
 */
export function useOpenAttachment(slug: string, conversationId: string, onProblem: (text: string) => void) {
  const qc = useQueryClient();
  const [opening, setOpening] = useState<string | null>(null);
  const open = async (messageId: string, attachment: ChatAttachmentDto) => {
    if (opening) return;
    setOpening(attachment.id);
    try {
      await openAttachment(qc, slug, conversationId, messageId, attachment);
    } catch (err) {
      onProblem(errorMessage(err));
    } finally {
      setOpening(null);
    }
  };
  return { opening, open };
}

/**
 * A sent message's photos and files in its bubble. Links are fetched when its row is drawn, which a thread's list does only
 * near the screen, batched with every other message drawn with it into one request; fetched again when a photo fails to
 * load after they may have expired. Photos are kept in expo-image's memory alone, under a key per photo, so signing a link
 * again doesn't reload one already shown.
 */
export function MessageAttachments({
  slug,
  conversationId,
  message,
  width,
  opening,
  onOpenPhoto,
  onOpenFile,
  onLongPress,
}: {
  slug: string;
  conversationId: string;
  message: ChatMessageDto;
  width: number;
  opening: string | null;
  onOpenPhoto: (messageId: string, index: number, opener: Focusable | null) => void;
  onOpenFile: (attachment: ChatAttachmentDto) => void;
  onLongPress?: () => void;
}) {
  const links = useQuery(attachmentLinksQuery(slug, conversationId, message.id));
  const retriedFor = useRef(0);

  const sourceOf = (a: ChatAttachmentDto): PhotoSource => {
    const link = links.data?.links.find((l) => l.id === a.id);
    const placeholder = sentPreviewOf(a.id);
    if (link) return { uri: link.thumbUrl ?? link.url, cacheKey: `chat-${a.id}-thumb`, placeholder };
    // Left out of an answer, or no answer: the member may not see it any more, or the request failed.
    return { uri: null, placeholder, broken: !links.isFetching && (!!links.error || !!links.data) };
  };
  const onImageError = () => {
    if (links.isFetching || retriedFor.current === links.dataUpdatedAt || Date.now() - links.dataUpdatedAt < MAYBE_EXPIRED_AFTER_MS) return;
    retriedFor.current = links.dataUpdatedAt;
    void links.refetch();
  };

  return (
    <AttachmentGrid
      attachments={message.attachments}
      sourceOf={sourceOf}
      width={width}
      retrying={links.isFetching}
      opening={opening}
      onOpen={(index, opener) => onOpenPhoto(message.id, index, opener)}
      onOpenFile={onOpenFile}
      onRetry={() => void links.refetch()}
      onImageError={onImageError}
      onLongPress={onLongPress}
    />
  );
}

/** A message still being sent: its photos from their prepared copies on this device, and its files without a way to open them yet. */
export function PendingAttachments({ attachments, width }: { attachments: OutboxAttachment[]; width: number }) {
  return <AttachmentGrid attachments={attachments} width={width} cachePolicy="none" sourceOf={(a) => ({ uri: attachments.find((p) => p.id === a.id)?.previewUri ?? null })} />;
}
