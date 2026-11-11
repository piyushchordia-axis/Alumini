import { CHAT_TRAY_LABEL, formatFileSize, trayItemLabels, type TrayItem } from "@illuminize/shared/chat";
import clsx from "clsx";
import { IconAlert, IconClose, IconFile } from "@/components/icons";

/**
 * The photos and PDFs waiting to go with the message being written, above the box: a 64px square per photo, a card per
 * file, each with a remove button, a spinner while it uploads, and a red ring with "Try again" when it didn't. What's
 * uploading or failed is said by the composer's status line. A remove button carries `data-tray-remove` with its item's key,
 * so the composer can move focus to the next one. Its 44px target reaches 14px past the tile's corner, so inside the tile it
 * covers only the top right, and a click on the middle of a failed tile is Try again, never Remove; the list leaves room for
 * the overhang.
 */
export function AttachmentTray({ tray, onRemove, onRetry }: { tray: TrayItem[]; onRemove: (key: string) => void; onRetry: (key: string) => void }) {
  return (
    <ul role="list" aria-label={CHAT_TRAY_LABEL} className="-mx-1 flex gap-4 overflow-x-auto pb-2 pl-1 pr-4 pt-3.5">
      {tray.map((item) => (
        <TrayTile key={item.key} item={item} labels={trayItemLabels(tray, item.key)} onRemove={onRemove} onRetry={onRetry} />
      ))}
    </ul>
  );
}

function TrayTile({ item, labels, onRemove, onRetry }: { item: TrayItem; labels: ReturnType<typeof trayItemLabels>; onRemove: (key: string) => void; onRetry: (key: string) => void }) {
  const uploading = item.status === "uploading";
  const failed = item.status === "failed";
  return (
    <li aria-busy={uploading || undefined} className={clsx("relative h-16 shrink-0", item.kind === "PHOTO" ? "w-16" : "w-[200px] max-w-[60vw]")}>
      <span className="sr-only">{uploading ? labels.busy : labels.name}</span>
      <div className={clsx("absolute inset-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100", failed && "ring-2 ring-red-600")}>
        {item.kind === "PHOTO" ? (
          item.previewUri && <img src={item.previewUri} alt="" className={clsx("h-full w-full object-cover", uploading && "opacity-50")} />
        ) : (
          <div className={clsx("flex h-full items-center gap-2 bg-white py-2 pl-2.5 pr-10", uploading && "opacity-50")}>
            <IconFile size={22} className="text-slate-500" />
            <div aria-hidden className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900" title={item.name ?? undefined}>
                {item.name}
              </p>
              <p className="text-xs text-slate-600">{formatFileSize(item.size)}</p>
            </div>
          </div>
        )}
        {uploading && (
          <span aria-hidden className="absolute inset-0 flex items-center justify-center">
            <span className="h-5 w-5 rounded-full border-2 border-slate-700 border-t-transparent motion-safe:animate-spin" />
          </span>
        )}
        {failed && (
          <button
            type="button"
            aria-label={labels.retry}
            onClick={() => onRetry(item.key)}
            className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-white/85 text-[11px] font-semibold text-tone-danger-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ink"
          >
            <IconAlert size={18} />
            <span aria-hidden>Try again</span>
          </button>
        )}
      </div>
      {/* A 44px target over the tile's corner; the visible mark is a dark disc 4px inside the corner that reads on any photo. */}
      <button
        type="button"
        data-tray-remove={item.key}
        aria-label={labels.remove}
        title={labels.remove}
        onClick={() => onRemove(item.key)}
        className="absolute -right-3.5 -top-3.5 z-10 flex h-11 w-11 items-end justify-start pb-0.5 pl-0.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ink"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/70 text-white">
          <IconClose size={14} />
        </span>
      </button>
    </li>
  );
}
