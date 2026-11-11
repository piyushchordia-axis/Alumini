import type { ChatAttachmentDto } from "@illuminize/shared";
import { CHAT_FILE_DEFAULT_NAME, CHAT_FILE_OPEN_HINT, fileMetaText, fileOpenLabel, PHOTO_GRID_WIDTH, PHOTO_LOAD_FAILED_TEXT, photoGridLayout, photoOpenLabel, type PhotoCell } from "@illuminize/shared/chat";
import { Image } from "expo-image";
import { useId, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { IconAlert, IconDownload, IconFile, IconShare } from "@/components/icons";
import { describedBy, type Focusable } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

/** Where a photo's image comes from, as the caller knows it so far. */
export interface PhotoSource {
  /** The image to show, or null while it isn't known (links still loading). */
  uri: string | null;
  /** What expo-image keeps it under, so a link signed again doesn't load the same photo again. */
  cacheKey?: string;
  /**
   * Drawn under the image until it loads, such as the prepared copy of a photo just sent: a local file, shown with no cache
   * at all.
   */
  placeholder?: string | null;
  /** Its link couldn't be had: show the failure and the way to try again. */
  broken?: boolean;
}

// A grey box while loading, with no shimmer, so nothing moves for anyone who asked for less motion. A shade darker than
// slate-200, which is the colour of someone else's bubble here.
const PLACEHOLDER = colors.borderStrong;

/**
 * A message's photos and files, as a bubble shows them: the photos in the shared grid (photoGridLayout), its box sized from
 * the photos' own sizes before anything loads, so a thread doesn't jump; then a white card per file. It knows nothing about
 * links: the caller says where each photo comes from, and what opening one, opening a file and trying again do. Without
 * `onOpen` the photos are pictures only, as a sending message's previews are; without `onOpenFile` a file isn't a button.
 * Private photos are kept in memory only (`cachePolicy`), never on disk, so none goes through expo-image's `placeholder`,
 * which it caches on disk whatever the policy: a placeholder is an Image of its own, under the photo.
 */
export function AttachmentGrid({
  attachments,
  sourceOf,
  width = PHOTO_GRID_WIDTH,
  cachePolicy = "memory",
  retrying = false,
  opening = null,
  onOpen,
  onOpenFile,
  onRetry,
  onImageError,
  onLongPress,
}: {
  attachments: ChatAttachmentDto[];
  sourceOf: (attachment: ChatAttachmentDto) => PhotoSource;
  width?: number;
  cachePolicy?: "memory" | "none";
  /** Links are being fetched again: a photo that failed waits for them rather than showing its failure. */
  retrying?: boolean;
  /** The file being downloaded to open, which shows it's busy. */
  opening?: string | null;
  /** Opens the photo at `index` among the photos; `opener` is its button, for focus to come back to. */
  onOpen?: (index: number, opener: Focusable | null) => void;
  onOpenFile?: (attachment: ChatAttachmentDto) => void;
  /** "Try again" on a photo that didn't load: fetch its links again. */
  onRetry?: () => void;
  /** A photo's image failed to load, perhaps because its link expired. */
  onImageError?: () => void;
  /** Holding a photo or a file chooses its message, as tapping the bubble does. */
  onLongPress?: () => void;
}) {
  const photos = attachments.filter((a) => a.kind === "PHOTO");
  const files = attachments.filter((a) => a.kind === "FILE");
  const grid = photoGridLayout(photos, width);
  return (
    <View style={{ gap: spacing.xs }}>
      {photos.length > 0 && (
        <View style={{ width: grid.width, height: grid.height }}>
          {photos.map((photo, i) => (
            <PhotoTile
              key={photo.id}
              cell={grid.cells[i]!}
              source={sourceOf(photo)}
              label={photoOpenLabel(i, photos.length)}
              cachePolicy={cachePolicy}
              retrying={retrying}
              onOpen={onOpen && ((opener) => onOpen(i, opener))}
              onRetry={onRetry}
              onImageError={onImageError}
              onLongPress={onLongPress}
            />
          ))}
        </View>
      )}
      {files.map((file) => (
        <FileRow key={file.id} file={file} width={grid.width || width} busy={opening === file.id} onOpen={onOpenFile} onLongPress={onLongPress} />
      ))}
    </View>
  );
}

function PhotoTile({
  cell,
  source,
  label,
  cachePolicy,
  retrying,
  onOpen,
  onRetry,
  onImageError,
  onLongPress,
}: {
  cell: PhotoCell;
  source: PhotoSource;
  label: string;
  cachePolicy: "memory" | "none";
  retrying: boolean;
  onOpen?: (opener: Focusable | null) => void;
  onRetry?: () => void;
  onImageError?: () => void;
  onLongPress?: () => void;
}) {
  const ref = useRef<Focusable>(null);
  const failedId = useId();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const { uri } = source;
  const broken = !retrying && (!!source.broken || (!!uri && failedUri === uri));
  const box = { position: "absolute", left: cell.x, top: cell.y, width: cell.width, height: cell.height, borderRadius: radius.md, overflow: "hidden", backgroundColor: PLACEHOLDER } as const;

  if (broken) {
    return (
      <View style={[box, styles.failed]}>
        <IconAlert size={18} color={colors.text} />
        <Text nativeID={failedId} style={styles.failedText}>
          {PHOTO_LOAD_FAILED_TEXT}
        </Text>
        {onRetry && (
          <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again" accessibilityHint={PHOTO_LOAD_FAILED_TEXT} {...describedBy(failedId)} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const image = (
    <>
      {source.placeholder && (!uri || loadedUri !== uri) ? <Image source={{ uri: source.placeholder }} cachePolicy="none" contentFit="cover" transition={0} accessible={false} style={StyleSheet.absoluteFill} /> : null}
      <Image
        source={uri ? { uri, cacheKey: source.cacheKey } : null}
        contentFit="cover"
        cachePolicy={cachePolicy}
        transition={0}
        accessible={false}
        onLoad={() => setLoadedUri(uri)}
        onError={() => {
          setFailedUri(uri);
          onImageError?.();
        }}
        style={StyleSheet.absoluteFill}
      />
    </>
  );
  if (!onOpen) return <View style={box}>{image}</View>;
  return (
    <Pressable
      ref={ref}
      onPress={() => onOpen(ref.current)}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [box, pressed ? { opacity: 0.85 } : null]}
    >
      {image}
    </Pressable>
  );
}

/** A file in a message: a white card whatever the bubble's colour, so it reads the same in any institution's colour. */
function FileRow({ file, width, busy, onOpen, onLongPress }: { file: ChatAttachmentDto; width: number; busy: boolean; onOpen?: (file: ChatAttachmentDto) => void; onLongPress?: () => void }) {
  const name = file.name ?? CHAT_FILE_DEFAULT_NAME;
  const body = (
    <>
      <IconFile size={22} color={colors.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* The middle goes when it's too long, so the end of the name, ".pdf" with it, still shows. */}
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.fileName}>
          {name}
        </Text>
        <Text style={styles.fileMeta}>{fileMetaText(file)}</Text>
      </View>
    </>
  );
  if (!onOpen) return <View style={[styles.file, { width }]}>{body}</View>;
  return (
    <Pressable
      onPress={() => {
        if (!busy) onOpen(file);
      }}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={fileOpenLabel(name)}
      accessibilityHint={CHAT_FILE_OPEN_HINT}
      aria-busy={busy}
      style={({ pressed }) => [styles.file, { width }, pressed ? { backgroundColor: colors.bg } : null]}
    >
      {body}
      <View aria-hidden style={styles.fileAction}>
        {busy ? <ActivityIndicator color={colors.secondary} /> : Platform.OS === "web" ? <IconDownload size={20} color={colors.secondary} /> : <IconShare size={20} color={colors.secondary} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  failed: { alignItems: "center", justifyContent: "center", gap: 2, padding: spacing.xs },
  failedText: { fontSize: 12, lineHeight: 15, color: colors.text, textAlign: "center" },
  retry: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  retryText: { fontSize: 13, fontWeight: "700", color: colors.text, textDecorationLine: "underline" },
  file: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: 6 },
  fileName: { fontSize: 14, fontWeight: "500", color: colors.text },
  fileMeta: { fontSize: 12, color: colors.muted },
  fileAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
