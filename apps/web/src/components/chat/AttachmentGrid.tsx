import type { ChatAttachmentDto } from "@illuminize/shared";
import { CHAT_FILE_DEFAULT_NAME, fileDownloadLabel, fileMetaText, PHOTO_GRID_WIDTH, PHOTO_LOAD_FAILED_TEXT, photoGridLayout, photoOpenLabel, type PhotoCell as Cell } from "@illuminize/shared/chat";
import clsx from "clsx";
import { useId, useState, type CSSProperties } from "react";
import { IconAlert, IconDownload, IconFile } from "@/components/icons";

/** Where a photo's image comes from, as the caller knows it so far. */
export interface PhotoSource {
  /** The image to show, or null while it isn't known (links still loading). */
  src: string | null;
  /** Drawn under the image until it loads, such as the preview of a photo just sent. */
  placeholder?: string | null;
  /** Its link couldn't be had: show the failure and the way to try again. */
  broken?: boolean;
}

const pct = (part: number, whole: number) => `${(part / whole) * 100}%`;

/**
 * A message's photos and files, as a bubble or a report shows them: the photos in the shared grid (photoGridLayout), its box
 * sized from the photos' own sizes before anything loads, so a thread doesn't jump; then a white card per file. It knows
 * nothing about links: the caller says where each photo comes from, and what opening, downloading and trying again do.
 * Without `onOpen` the photos are pictures only, as a pending message's previews are; without `onDownload` a file has no
 * button.
 */
export function AttachmentGrid({
  attachments,
  sourceOf,
  retrying = false,
  onOpen,
  onDownload,
  onRetry,
  onImageError,
  width = PHOTO_GRID_WIDTH,
}: {
  attachments: ChatAttachmentDto[];
  sourceOf: (attachment: ChatAttachmentDto) => PhotoSource;
  /** Links are being fetched again: a photo that failed waits for them rather than showing its failure. */
  retrying?: boolean;
  /** Opens the photo at `index` among the photos; `opener` is the button, for focus to come back to. */
  onOpen?: (index: number, opener: HTMLElement) => void;
  onDownload?: (attachment: ChatAttachmentDto) => void;
  /** "Try again" on a photo that didn't load: fetch its links again. */
  onRetry?: () => void;
  /** A photo's image failed to load, perhaps because its link expired. */
  onImageError?: () => void;
  width?: number;
}) {
  const photos = attachments.filter((a) => a.kind === "PHOTO");
  const files = attachments.filter((a) => a.kind === "FILE");
  const grid = photoGridLayout(photos, width);
  return (
    <div className="flex flex-col gap-1">
      {photos.length > 0 && (
        <div className="relative" style={{ width: grid.width, maxWidth: "100%", aspectRatio: `${grid.width} / ${grid.height}` }}>
          {photos.map((photo, i) => (
            <PhotoTile
              key={photo.id}
              style={cellStyle(grid.cells[i]!, grid.width, grid.height)}
              source={sourceOf(photo)}
              label={photoOpenLabel(i, photos.length)}
              retrying={retrying}
              onOpen={onOpen && ((el) => onOpen(i, el))}
              onRetry={onRetry}
              onImageError={onImageError}
            />
          ))}
        </div>
      )}
      {files.map((file) => (
        <FileRow key={file.id} file={file} width={width} onDownload={onDownload} />
      ))}
    </div>
  );
}

const cellStyle = (cell: Cell, width: number, height: number): CSSProperties => ({ left: pct(cell.x, width), top: pct(cell.y, height), width: pct(cell.width, width), height: pct(cell.height, height) });

function PhotoTile({ style, source, label, retrying, onOpen, onRetry, onImageError }: { style: CSSProperties; source: PhotoSource; label: string; retrying: boolean; onOpen?: (opener: HTMLElement) => void; onRetry?: () => void; onImageError?: () => void }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const failedId = useId();
  const { src } = source;
  const broken = !retrying && (!!source.broken || (!!src && failedSrc === src));
  // A plain grey box while loading, with no shimmer, so nothing moves for anyone who asked for less motion.
  const tile = "absolute overflow-hidden rounded-xl bg-slate-200";

  if (broken) {
    return (
      <div style={style} className={clsx(tile, "flex flex-col items-center justify-center gap-0.5 p-1 text-center text-slate-700")} onClick={(e) => e.stopPropagation()}>
        <IconAlert size={18} />
        <span id={failedId} className="text-xs leading-tight">
          {PHOTO_LOAD_FAILED_TEXT}
        </span>
        {onRetry && (
          <button type="button" aria-describedby={failedId} onClick={onRetry} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-slate-900 underline hover:bg-slate-300 focus-visible:outline-2 focus-visible:outline-primary-ink">
            Try again
          </button>
        )}
      </div>
    );
  }

  const images = (
    <>
      {source.placeholder && loadedSrc !== src && <img src={source.placeholder} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {src && failedSrc !== src && (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedSrc(src)}
          onError={() => {
            setFailedSrc(src);
            onImageError?.();
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </>
  );
  if (!onOpen) return <div style={style} className={tile}>{images}</div>;
  return (
    <button
      type="button"
      aria-label={label}
      style={style}
      onClick={(e) => {
        // The bubble's own click shows its time; opening a photo isn't choosing the message.
        e.stopPropagation();
        onOpen(e.currentTarget);
      }}
      className={clsx(tile, "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ink")}
    >
      {images}
    </button>
  );
}

/** A file in a message: a white card whatever the bubble's colour, so it reads the same in any institution's colour. */
function FileRow({ file, width, onDownload }: { file: ChatAttachmentDto; width: number; onDownload?: (attachment: ChatAttachmentDto) => void }) {
  const name = file.name ?? CHAT_FILE_DEFAULT_NAME;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white py-1.5 pl-3 pr-1.5 text-left not-italic text-slate-900" style={{ width, maxWidth: "100%" }}>
      <IconFile size={22} className="text-slate-500" />
      <div className="min-w-0 flex-1 py-1">
        <p className="truncate text-sm font-medium leading-snug" title={name}>
          {name}
        </p>
        <p className="text-xs leading-snug text-slate-500">{fileMetaText(file)}</p>
      </div>
      {onDownload && (
        <button
          type="button"
          aria-label={fileDownloadLabel(name)}
          title={fileDownloadLabel(name)}
          onClick={(e) => {
            e.stopPropagation();
            onDownload(file);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary-ink"
        >
          <IconDownload size={20} />
        </button>
      )}
    </div>
  );
}
