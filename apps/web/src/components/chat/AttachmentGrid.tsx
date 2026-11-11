import type { ChatAttachmentDto } from "@illuminize/shared";
import { CHAT_FILE_DEFAULT_NAME, fileDownloadLabel, fileMetaText, PHOTO_COMPACT_SIDE, PHOTO_GRID_WIDTH, PHOTO_LOAD_FAILED_TEXT, photoGridLayout, photoOpenLabel, type PhotoCell as Cell } from "@illuminize/shared/chat";
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
 * button. `compact` is the consoles' denser look for a chat report's view: the photos as a row of small squares
 * (PHOTO_COMPACT_SIDE), and the files as full-width rows. There a photo the caller says is `broken` shows only a mark (the
 * caller says why, and offers the way on), while one whose own image failed offers Try again, which loads it again from
 * the same link and tells `onRetry`.
 */
export function AttachmentGrid<A extends ChatAttachmentDto>({
  attachments,
  sourceOf,
  retrying = false,
  onOpen,
  onDownload,
  onRetry,
  onImageError,
  width = PHOTO_GRID_WIDTH,
  compact = false,
}: {
  attachments: A[];
  sourceOf: (attachment: A) => PhotoSource;
  /** Links are being fetched again: a photo that failed waits for them rather than showing its failure. */
  retrying?: boolean;
  /** Opens the photo at `index` among the photos; `opener` is the button, for focus to come back to. */
  onOpen?: (index: number, opener: HTMLElement) => void;
  onDownload?: (attachment: A) => void;
  /** "Try again" on a photo that didn't load: fetch its links again (in a compact grid, after it loads again by itself). */
  onRetry?: () => void;
  /** A photo's image failed to load, perhaps because its link expired. */
  onImageError?: () => void;
  width?: number;
  compact?: boolean;
}) {
  const photos = attachments.filter((a) => a.kind === "PHOTO");
  const files = attachments.filter((a) => a.kind === "FILE");
  const tile = (photo: A, i: number, style: CSSProperties) => (
    <PhotoTile
      key={photo.id}
      style={style}
      compact={compact}
      source={sourceOf(photo)}
      label={photoOpenLabel(i, photos.length)}
      retrying={retrying}
      onOpen={onOpen && ((el) => onOpen(i, el))}
      onRetry={onRetry}
      onImageError={onImageError}
    />
  );
  const grid = photoGridLayout(photos, width);
  return (
    <div className="flex flex-col gap-1">
      {photos.length > 0 &&
        (compact ? (
          <div className="flex flex-wrap gap-1">{photos.map((photo, i) => tile(photo, i, { width: PHOTO_COMPACT_SIDE, height: PHOTO_COMPACT_SIDE }))}</div>
        ) : (
          <div className="relative" style={{ width: grid.width, maxWidth: "100%", aspectRatio: `${grid.width} / ${grid.height}` }}>
            {photos.map((photo, i) => tile(photo, i, cellStyle(grid.cells[i]!, grid.width, grid.height)))}
          </div>
        ))}
      {files.map((file) => (
        <FileRow key={file.id} file={file} width={compact ? null : width} onDownload={onDownload} />
      ))}
    </div>
  );
}

const cellStyle = (cell: Cell, width: number, height: number): CSSProperties => ({ left: pct(cell.x, width), top: pct(cell.y, height), width: pct(cell.width, width), height: pct(cell.height, height) });

function PhotoTile({
  style,
  compact,
  source,
  label,
  retrying,
  onOpen,
  onRetry,
  onImageError,
}: {
  style: CSSProperties;
  compact: boolean;
  source: PhotoSource;
  label: string;
  retrying: boolean;
  onOpen?: (opener: HTMLElement) => void;
  onRetry?: () => void;
  onImageError?: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const failedId = useId();
  const { src } = source;
  const broken = !retrying && (!!source.broken || (!!src && failedSrc === src));
  // A plain grey box while loading, with no shimmer, so nothing moves for anyone who asked for less motion.
  const tile = clsx(compact ? "relative shrink-0 rounded-lg" : "absolute rounded-xl", "overflow-hidden bg-slate-200");

  // A compact square is too small for the words. When its link has gone (`broken`), its caller says so beside the grid.
  // When its own image failed, it loads again from the same link: a button like the photo's, so focus stays on it.
  if (broken && compact) {
    if (!source.broken && onOpen) {
      return (
        <button
          type="button"
          aria-label="Try again"
          aria-describedby={failedId}
          title={PHOTO_LOAD_FAILED_TEXT}
          style={style}
          onClick={(e) => {
            e.stopPropagation();
            setFailedSrc(null);
            onRetry?.();
          }}
          className={clsx(tile, "flex flex-col items-center justify-center gap-0.5 text-slate-800 hover:bg-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ink")}
        >
          <IconAlert size={18} />
          <span className="text-xs font-semibold leading-tight underline">Try again</span>
          <span id={failedId} className="sr-only">
            {PHOTO_LOAD_FAILED_TEXT}
          </span>
        </button>
      );
    }
    return (
      <div style={style} role="img" aria-label={PHOTO_LOAD_FAILED_TEXT} title={PHOTO_LOAD_FAILED_TEXT} className={clsx(tile, "flex items-center justify-center text-slate-700")}>
        <IconAlert size={20} />
      </div>
    );
  }
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

/**
 * A file in a message: a white card whatever the bubble's colour, so it reads the same in any institution's colour. A null
 * `width` is the compact grid's: as wide as there is room for, up to a limit.
 */
function FileRow<A extends ChatAttachmentDto>({ file, width, onDownload }: { file: A; width: number | null; onDownload?: (attachment: A) => void }) {
  const name = file.name ?? CHAT_FILE_DEFAULT_NAME;
  return (
    <div className={clsx("flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white py-1.5 pl-3 pr-1.5 text-left not-italic text-slate-900", width === null && "w-full max-w-md")} style={width === null ? undefined : { width, maxWidth: "100%" }}>
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
