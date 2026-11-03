import { CHAT_MESSAGE_MAX_LENGTH } from "@illuminize/shared";
import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { useChatStore } from "@/stores/chatStore";

/** About five lines, then it scrolls. */
const MAX_HEIGHT_PX = 136;
/** The count appears this close to the limit, not before, when it would only be noise. */
const SHOW_COUNT_FROM = CHAT_MESSAGE_MAX_LENGTH - 500;
const NO_FILES = "Photos and files can't be sent in chat. Only text goes through.";

/** Enter sends where there's a real keyboard. On a touch keyboard Enter is the only way to start a new line. */
const enterSends = () => window.matchMedia("(pointer: fine)").matches;

/**
 * The message box. Its text is the draft for `draftKey`, held in memory only, so it survives leaving the thread, a failed
 * send and a failed refetch, and goes with sign-out. The caller decides when a send clears it.
 */
export function ChatComposer({
  draftKey,
  onSend,
  sending = false,
  notice,
  autoFocus = false,
  keyboardOpen = false,
}: {
  draftKey: string;
  onSend: (text: string) => void;
  sending?: boolean;
  /** Shown above the box, such as why the last send didn't go. */
  notice?: ReactNode;
  autoFocus?: boolean;
  /** The safe area at the bottom of a phone is behind the keyboard while it's open, so it would only leave a gap. */
  keyboardOpen?: boolean;
}) {
  const draft = useChatStore((s) => s.drafts[draftKey] ?? "");
  const setDraft = useChatStore((s) => s.setDraft);
  const box = useRef<HTMLTextAreaElement>(null);
  const [fileNotice, setFileNotice] = useState(false);
  const empty = draft.trim().length === 0;

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

  const send = () => {
    if (empty || sending) return;
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
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length > 0) setFileNotice(true);
  };
  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      setFileNotice(true);
    }
  };

  return (
    // autoComplete off on the form and the box: browsers otherwise keep a box's text for session restore, on disk, where a
    // draft would outlast sign-out. Drafts live in memory only.
    <form onSubmit={submit} autoComplete="off" className="border-t border-slate-200 bg-white px-3 pt-2">
      {(notice || fileNotice) && (
        <div role="status" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {fileNotice ? NO_FILES : notice}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          aria-label="Write a message"
          placeholder="Write a message"
          rows={1}
          autoComplete="off"
          value={draft}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          onChange={(e) => {
            setFileNotice(false);
            setDraft(draftKey, e.target.value);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={onDrop}
          className="block min-h-11 w-full min-w-0 flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-[15px] leading-snug text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          style={{ maxHeight: MAX_HEIGHT_PX }}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={empty || sending}
          // Keeps focus, and a phone's keyboard, in the box after a tap.
          onMouseDown={(e) => e.preventDefault()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? (
            <Spinner size="sm" className="text-white" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
            </svg>
          )}
        </button>
      </div>
      <div className={clsx("flex items-center justify-between gap-2 pt-1 text-xs text-slate-500", keyboardOpen ? "pb-2" : "pb-[max(0.5rem,env(safe-area-inset-bottom))]")}>
        <span>Text only. Photos and files aren't supported in chat.</span>
        {draft.length >= SHOW_COUNT_FROM && (
          <span className={clsx("shrink-0 tabular-nums", draft.length >= CHAT_MESSAGE_MAX_LENGTH && "font-medium text-red-600")}>
            {draft.length.toLocaleString()} / {CHAT_MESSAGE_MAX_LENGTH.toLocaleString()}
          </span>
        )}
      </div>
    </form>
  );
}
