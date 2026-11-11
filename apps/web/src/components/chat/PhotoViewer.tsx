import type { ChatAttachmentDto, ChatMessageDto } from "@illuminize/shared";
import { PHOTO_LOAD_FAILED_TEXT, photoViewerTitle } from "@illuminize/shared/chat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { downloadAttachment } from "@/components/chat/MessageAttachments";
import { IconAlert, IconChevronLeft, IconChevronRight, IconClose, IconDownload, IconFlag } from "@/components/icons";
import { attachmentLinksQuery } from "@/lib/chatAttachments";

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function ViewerButton({ label, onClick, disabled = false, className, buttonRef, children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; buttonRef?: Ref<HTMLButtonElement>; children: ReactNode }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      // Stays focusable at either end, so focus never drops out of the viewer.
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-disabled:opacity-40 aria-disabled:hover:bg-transparent", className)}
    >
      {children}
    </button>
  );
}

/**
 * A message's photos one at a time, over everything: Close, Previous and Next, Download photo, and Report message for
 * someone else's message. Esc closes it and the arrow keys page; focus starts on Close, stays inside, and goes back to the
 * photo that opened it. Nothing animates. The full photo comes from links fetched again if they're no longer fresh, and
 * `suspended` hands the keyboard to a report dialog opened over it.
 */
export function PhotoViewer({
  slug,
  conversationId,
  message,
  photos,
  startIndex,
  who,
  opener,
  suspended = false,
  onReport,
  onClose,
}: {
  slug: string;
  conversationId: string;
  message: ChatMessageDto;
  photos: ChatAttachmentDto[];
  startIndex: number;
  /** Whose photos they are, "you" for the member's own. */
  who: string;
  /** The photo button that opened it, which takes focus back. */
  opener: HTMLElement | null;
  suspended?: boolean;
  /** Only for someone else's message. */
  onReport?: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [index, setIndex] = useState(startIndex);
  const at = Math.min(Math.max(index, 0), photos.length - 1);
  const photo = photos[at]!;
  const count = photos.length;
  const links = useQuery(attachmentLinksQuery(slug, conversationId, message.id));
  const link = links.data?.links.find((l) => l.id === photo.id);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const timeId = useId();
  const title = photoViewerTitle(at, count, who);
  const src = link?.url ?? null;
  const broken = !links.isFetching && ((!!src && failedSrc === src) || (!link && (!!links.error || !!links.data)));
  const sentAt = new Date(message.createdAt);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => (opener?.isConnected ? opener : previous)?.focus();
  }, [opener]);

  const go = (step: number) => setIndex(Math.min(Math.max(at + step, 0), count - 1));
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (suspended) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowLeft" && count > 1) {
      e.preventDefault();
      go(-1);
    } else if (e.key === "ArrowRight" && count > 1) {
      e.preventDefault();
      go(1);
    } else if (e.key === "Tab") {
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      const inside = dialog.current?.contains(document.activeElement);
      if (!inside || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={timeId} className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 text-white">
      <div className="flex items-center gap-1 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
        <div className="min-w-0 flex-1 px-2">
          <h2 id={titleId} className="truncate text-base font-semibold">
            {title}
          </h2>
          <p id={timeId} className="truncate text-sm text-slate-300">
            <time dateTime={message.createdAt}>{sentAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
          </p>
        </div>
        <ViewerButton label="Download photo" onClick={() => void downloadAttachment(qc, slug, conversationId, message.id, photo.id)}>
          <IconDownload />
        </ViewerButton>
        {onReport && (
          <ViewerButton label="Report message" onClick={onReport}>
            <IconFlag />
          </ViewerButton>
        )}
        <ViewerButton label="Close" onClick={onClose} buttonRef={closeButton}>
          <IconClose />
        </ViewerButton>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-16"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {broken ? (
          <div className="flex flex-col items-center gap-2 text-center text-slate-200">
            <IconAlert size={28} />
            <p className="text-sm">{PHOTO_LOAD_FAILED_TEXT}</p>
            <button type="button" onClick={() => void links.refetch()} className="min-h-11 rounded-lg border border-white/40 px-4 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              Try again
            </button>
          </div>
        ) : (
          <>
            {(!src || loadedSrc !== src) && <span aria-hidden className="absolute h-8 w-8 rounded-full border-2 border-white/70 border-t-transparent motion-safe:animate-spin" />}
            {src && (
              <img
                key={src}
                src={src}
                alt=""
                referrerPolicy="no-referrer"
                onLoad={() => setLoadedSrc(src)}
                onError={() => setFailedSrc(src)}
                className={clsx("max-h-full max-w-full object-contain", loadedSrc !== src && "invisible")}
              />
            )}
          </>
        )}
        {count > 1 && (
          <>
            <ViewerButton label="Previous photo" onClick={() => go(-1)} disabled={at === 0} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 sm:left-4">
              <IconChevronLeft />
            </ViewerButton>
            <ViewerButton label="Next photo" onClick={() => go(1)} disabled={at === count - 1} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 sm:right-4">
              <IconChevronRight />
            </ViewerButton>
          </>
        )}
      </div>
    </div>
  );
}
