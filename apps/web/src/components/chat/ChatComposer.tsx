import { ALLOWED_IMAGE_MIME, CHAT_ATTACHMENT_LIMIT_TEXT, CHAT_FILE_TYPES, CHAT_MESSAGE_MAX_LENGTH } from "@illuminize/shared";
import { CHAT_ATTACH_FAILED_TEXT, CHAT_ATTACH_LABEL, CHAT_ATTACHMENTS_OFF_CAPTION, trayFull, traySendable, trayStatusText, type TrayItem } from "@illuminize/shared/chat";
import clsx from "clsx";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { AttachmentTray } from "@/components/chat/AttachmentTray";
import { IconPaperclip } from "@/components/icons";
import { Notice, Spinner } from "@/components/ui";
import { useChatStore } from "@/stores/chatStore";

/** About five lines, then it scrolls. */
const MAX_HEIGHT_PX = 136;
/** The count appears this close to the limit, not before, when it would only be noise. */
const SHOW_COUNT_FROM = CHAT_MESSAGE_MAX_LENGTH - 500;
/** Only the photo types the server takes, so iPhone Safari hands a HEIC photo over as a JPEG, and PDF. */
const ACCEPT = [...ALLOWED_IMAGE_MIME, ...CHAT_FILE_TYPES].join(",");
const NO_ITEMS: TrayItem[] = [];

/** Enter sends where there's a real keyboard. On a touch keyboard Enter is the only way to start a new line. */
const enterSends = () => window.matchMedia("(pointer: fine)").matches;

const carriesFiles = (data: DataTransfer) => [...data.types].includes("Files");

/** Photos and PDFs going with the message, where the thread takes them (see useChatAttachments). */
export interface ComposerAttachments {
  tray: TrayItem[];
  /**
   * Whether more can be added (the thread's canAttach). Without it the tray is still shown, to be emptied, but there's no
   * paperclip, and a pasted or dropped file gets the caption: photos and files stopped being allowed here while some were
   * waiting.
   */
  canAdd: boolean;
  /** Adds picked, pasted or dropped files; resolves to what to say about any turned away, or null. */
  onAdd: (files: File[]) => Promise<string | null>;
  /** Takes one out, giving the tile whose remove button takes focus next, or null for the attach button. */
  onRemove: (key: string) => string | null;
  onRetry: (key: string) => void;
}

/**
 * The message box. Its text is the draft for `draftKey`, held in memory only, so it survives leaving the thread, a failed
 * send and a failed refetch, and goes with sign-out. The caller decides when a send clears it. Above it, `notice` (a
 * warning, read out as it appears) takes the place of `intro` (an info note the box is described by) while it shows.
 * With `attach`, a paperclip (while `canAdd`) adds photos and PDFs to a tray above the box (pasting and dropping files do
 * too), busy while they're prepared, and Send waits until they've uploaded; without it, `attachCaption` says under the box
 * why they can't be added here.
 */
export function ChatComposer({
  draftKey,
  onSend,
  sending = false,
  notice,
  intro,
  describedBy,
  attach = null,
  attachCaption = null,
  autoFocus = false,
  keyboardOpen = false,
}: {
  draftKey: string;
  /** The words to send, trimmed; empty when only photos and files go. */
  onSend: (text: string) => void;
  sending?: boolean;
  /** A warning above the box, such as why the last send didn't go. */
  notice?: string | null;
  /** What sending here does, when that's worth knowing first, such as asking again. */
  intro?: string | null;
  /** The id of anything else on the screen that describes the box. */
  describedBy?: string;
  attach?: ComposerAttachments | null;
  /** Why photos and files can't be added here (threadFooter's attachCaption), shown in place of the paperclip. */
  attachCaption?: string | null;
  autoFocus?: boolean;
  /** The safe area at the bottom of a phone is behind the keyboard while it's open, so it would only leave a gap. */
  keyboardOpen?: boolean;
}) {
  const draft = useChatStore((s) => s.drafts[draftKey] ?? "");
  const setDraft = useChatStore((s) => s.setDraft);
  const box = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachButton = useRef<HTMLButtonElement>(null);
  // Where focus goes once a removed tile has gone: the next tile's remove button, or the paperclip (null).
  const focusAfterRemove = useRef<string | null | undefined>(undefined);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Adds still being prepared (each photo decoded and made smaller), before any of their tiles appear.
  const [preparing, setPreparing] = useState(0);
  const introId = useId();
  const tray = attach?.tray ?? NO_ITEMS;
  const status = trayStatusText(tray);
  const sendable = traySendable(tray, draft);
  // The tray holding Send back says why, on a button that stays focusable; nothing to send at all is a plain disabled one.
  const held = !!sendable.reason;
  const canSend = sendable.ok && !sending;
  const canAdd = !!attach?.canAdd;
  const warning = attachNotice ?? notice;
  const showIntro = !warning && !!intro;

  // Grows with what's written, up to the limit.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft]);

  // Only with a real keyboard: on a phone this would throw the on-screen one up over the thread.
  useEffect(() => {
    if (autoFocus && enterSends()) box.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const next = focusAfterRemove.current;
    if (next === undefined) return;
    focusAfterRemove.current = undefined;
    // With no paperclip (photos and files stopped being allowed here), the box.
    const target = next === null ? (attachButton.current ?? box.current) : form.current?.querySelector<HTMLElement>(`[data-tray-remove="${CSS.escape(next)}"]`);
    target?.focus();
  }, [tray]);

  const send = () => {
    if (!canSend) return;
    setAttachNotice(null);
    onSend(draft.trim());
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Never mid-composition: Indian-language and other IME keyboards use Enter to pick a word.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!enterSends()) return;
    e.preventDefault();
    send();
  };
  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!attach?.canAdd) return setAttachNotice(attachCaption ?? CHAT_ATTACHMENTS_OFF_CAPTION);
    setAttachNotice(null);
    setPreparing((n) => n + 1);
    void attach
      .onAdd(files)
      .then(
        (refused) => {
          if (refused) setAttachNotice(refused);
        },
        () => setAttachNotice(CHAT_ATTACH_FAILED_TEXT),
      )
      .finally(() => setPreparing((n) => n - 1));
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return;
    // A copied image comes with no text of its own; anything copied with words still pastes them.
    if (canAdd && !e.clipboardData.getData("text/plain")) e.preventDefault();
    addFiles(files);
  };
  const onDragOver = (e: DragEvent<HTMLFormElement>) => {
    if (!carriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (canAdd) setDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLFormElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLFormElement>) => {
    setDragging(false);
    if (!carriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  };
  const remove = (key: string) => {
    if (!attach) return;
    setAttachNotice(null);
    focusAfterRemove.current = attach.onRemove(key);
  };

  return (
    // autoComplete off on the form and the box: browsers otherwise keep a box's text for session restore, on disk, where a
    // draft would outlast sign-out. Drafts live in memory only.
    <form
      ref={form}
      onSubmit={submit}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      autoComplete="off"
      className={clsx("border-t border-slate-200 bg-white px-3 pt-2", dragging && "ring-2 ring-inset ring-primary-ring")}
    >
      {/* Always there, so a warning that appears in it is read out. */}
      <div role="status">{warning && <Notice tone="warning" className="mb-2">{warning}</Notice>}</div>
      {showIntro && (
        <Notice tone="info" id={introId} className="mb-2">
          {intro}
        </Notice>
      )}
      {attach && tray.length > 0 && <AttachmentTray tray={tray} onRemove={remove} onRetry={attach.onRetry} />}
      {/* Always there while photos and files can be added, so what's uploading or failed is read out politely. */}
      {attach && (
        <div role="status" className={clsx("text-xs text-slate-600", status && "pb-2")}>
          {status}
        </div>
      )}
      <div className="flex items-end gap-2">
        {canAdd && (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              tabIndex={-1}
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                // Cleared, so choosing the same file again still counts as a choice.
                e.target.value = "";
                addFiles(files);
              }}
            />
            <button
              ref={attachButton}
              type="button"
              aria-label={CHAT_ATTACH_LABEL}
              title={CHAT_ATTACH_LABEL}
              aria-disabled={trayFull(tray) || undefined}
              aria-busy={preparing > 0 || undefined}
              onClick={() => {
                if (trayFull(tray)) return setAttachNotice(CHAT_ATTACHMENT_LIMIT_TEXT);
                setAttachNotice(null);
                fileInput.current?.click();
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary-ink aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
            >
              {preparing > 0 ? <span aria-hidden className="h-5 w-5 rounded-full border-2 border-slate-600 border-t-transparent motion-safe:animate-spin" /> : <IconPaperclip size={22} />}
            </button>
          </>
        )}
        <textarea
          ref={box}
          aria-label="Write a message"
          aria-describedby={[showIntro && introId, describedBy].filter(Boolean).join(" ") || undefined}
          placeholder="Write a message"
          rows={1}
          autoComplete="off"
          value={draft}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          onChange={(e) => {
            setAttachNotice(null);
            setDraft(draftKey, e.target.value);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="block min-h-11 w-full min-w-0 flex-1 resize-none rounded-2xl border border-slate-400 bg-white px-4 py-2.5 text-[15px] leading-snug text-slate-900 placeholder:text-slate-500 focus:border-primary-ink focus:outline-none focus:ring-2 focus:ring-primary/20"
          style={{ maxHeight: MAX_HEIGHT_PX }}
        />
        <button
          type="submit"
          aria-label="Send message"
          title={sendable.reason ?? undefined}
          disabled={!held && !canSend}
          aria-disabled={held || undefined}
          // Keeps focus, and a phone's keyboard, in the box after a tap.
          onMouseDown={(e) => e.preventDefault()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ink disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
        >
          {sending ? (
            <Spinner size="sm" className="text-on-primary" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
            </svg>
          )}
        </button>
      </div>
      <div className={clsx("flex items-center justify-between gap-2 pt-1 text-xs text-slate-500", keyboardOpen ? "pb-2" : "pb-[max(0.5rem,env(safe-area-inset-bottom))]")}>
        <span>{attachCaption}</span>
        {draft.length >= SHOW_COUNT_FROM && (
          <span className={clsx("shrink-0 tabular-nums", draft.length >= CHAT_MESSAGE_MAX_LENGTH && "font-medium text-red-600")}>
            {draft.length.toLocaleString()} / {CHAT_MESSAGE_MAX_LENGTH.toLocaleString()}
          </span>
        )}
      </div>
    </form>
  );
}
