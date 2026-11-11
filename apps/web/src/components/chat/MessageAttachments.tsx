import type { ChatAttachmentDto, ChatMessageDto } from "@illuminize/shared";
import type { OutboxAttachment } from "@illuminize/shared/chat";
import { errorMessage } from "@illuminize/shared/client";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { AttachmentGrid } from "@/components/chat/AttachmentGrid";
import { attachmentLinksQuery, freshAttachmentLink, sentPreviewOf } from "@/lib/chatAttachments";
import { downloadFromUrl } from "@/lib/download";
import { toast } from "@/stores/uiStore";

/** Links older than this when a photo fails to load may have expired, so they're fetched again once without asking. */
const MAYBE_EXPIRED_AFTER_MS = 30_000;

/**
 * True once the element has come near the visible part of `rootRef` (the thread's scrolling log), and from then on: links
 * are fetched for the messages being looked at, as one request for each batch that comes into view, never for a whole
 * thread at once.
 */
function useSeen(rootRef: RefObject<HTMLElement | null> | undefined) {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { root: rootRef?.current ?? null, rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, rootRef]);
  return { ref, seen };
}

/** Downloads one of a message's files or photos from fresh links, saying so if it can't. */
export async function downloadAttachment(qc: QueryClient, slug: string, conversationId: string, messageId: string, attachmentId: string) {
  try {
    const link = await freshAttachmentLink(qc, slug, conversationId, messageId, attachmentId);
    downloadFromUrl(link.downloadUrl);
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

/**
 * A sent message's photos and files in its bubble, with links fetched once it's near the screen (batched with the other
 * messages that come into view with it) and fetched again when a photo fails to load after they may have expired.
 */
export function MessageAttachments({
  slug,
  conversationId,
  message,
  root,
  onOpenPhoto,
}: {
  slug: string;
  conversationId: string;
  message: ChatMessageDto;
  /** The scrolling log the message is in. */
  root?: RefObject<HTMLElement | null>;
  onOpenPhoto: (messageId: string, index: number, opener: HTMLElement) => void;
}) {
  const qc = useQueryClient();
  const { ref, seen } = useSeen(root);
  const links = useQuery({ ...attachmentLinksQuery(slug, conversationId, message.id), enabled: seen });
  const retriedFor = useRef(0);

  const sourceOf = (a: ChatAttachmentDto) => {
    const link = links.data?.links.find((l) => l.id === a.id);
    const placeholder = sentPreviewOf(a.id);
    if (link) return { src: link.thumbUrl ?? link.url, placeholder };
    // Left out of an answer, or no answer: the member may not see it any more, or the request failed.
    return { src: null, placeholder, broken: !links.isFetching && (!!links.error || !!links.data) };
  };
  const onImageError = () => {
    if (links.isFetching || retriedFor.current === links.dataUpdatedAt || Date.now() - links.dataUpdatedAt < MAYBE_EXPIRED_AFTER_MS) return;
    retriedFor.current = links.dataUpdatedAt;
    void links.refetch();
  };

  return (
    <div ref={ref}>
      <AttachmentGrid
        attachments={message.attachments}
        sourceOf={sourceOf}
        retrying={links.isFetching}
        onOpen={(index, opener) => onOpenPhoto(message.id, index, opener)}
        onDownload={(a) => void downloadAttachment(qc, slug, conversationId, message.id, a.id)}
        onRetry={() => void links.refetch()}
        onImageError={onImageError}
      />
    </div>
  );
}

/** A message still being sent: its photos from the previews on this device, and its files without a download yet. */
export function PendingAttachments({ attachments }: { attachments: OutboxAttachment[] }) {
  return <AttachmentGrid attachments={attachments} sourceOf={(a) => ({ src: attachments.find((p) => p.id === a.id)?.previewUri ?? null })} />;
}
