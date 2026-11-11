import type { OutboxAttachment, TrayItem } from "@illuminize/shared/chat";
import { useMemo } from "react";
import { addFilesToTray, addPhotosToTray, removeFromTray, restoreTray, retryTrayItem, takeTray } from "@/lib/chatAttachments";
import { useChatStore } from "@/stores/chatStore";

const NO_ITEMS: TrayItem[] = [];

/**
 * The tray of photos and PDFs for the message being written in a conversation, kept under the composer's draft key. Its
 * uploads live outside the screen (lib/chatAttachments), so they carry on when the member leaves the thread.
 */
export function useChatAttachments(slug: string, conversationId: string, trayKey: string) {
  const tray = useChatStore((s) => s.trays[trayKey] ?? NO_ITEMS);
  return useMemo(
    () => ({
      tray,
      /** Each resolves to what to say about a pick turned away, or null. */
      addPhotos: () => addPhotosToTray(slug, conversationId, trayKey),
      addFiles: () => addFilesToTray(slug, conversationId, trayKey),
      /** Gives the tile whose remove button takes focus next, or null for the attach button. */
      remove: (itemKey: string) => removeFromTray(trayKey, itemKey),
      retry: (itemKey: string) => retryTrayItem(slug, conversationId, trayKey, itemKey),
      /** Empties the tray into a send. */
      take: () => takeTray(trayKey),
      restore: (attachments: readonly OutboxAttachment[]) => restoreTray(trayKey, attachments),
    }),
    [tray, slug, conversationId, trayKey],
  );
}
