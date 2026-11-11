import { STATUS_TONES } from "@illuminize/shared";
import { CHAT_TRAY_LABEL, formatFileSize, trayItemLabels, type TrayItem } from "@illuminize/shared/chat";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { IconAlert, IconClose, IconFile } from "@/components/icons";
import type { Focusable } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

const TILE = 64;
const FILE_TILE_MAX = 200;
/**
 * How far a remove button's 44-point target reaches past its tile's corner. Inside, it covers only the tile's top right,
 * so a tap on the middle of a failed tile is Try again, never Remove; the tray leaves room for the overhang.
 */
const OVERHANG = 14;
// A failed tile: the danger tone's solid as its ring, its ink for the words and the mark.
const DANGER_RING = STATUS_TONES.danger.solid;
const DANGER_INK = STATUS_TONES.danger.ink;

/**
 * The photos and PDFs waiting to go with the message being written, above the box, in a row that scrolls sideways: a
 * 64-point square per photo, a card per file, each with a remove button, a spinner while it uploads, and a red ring with
 * "Try again" when it didn't. What's uploading or failed is said by the composer's status line. `removeRef` hands each
 * remove button to the composer, which moves focus to the next one after a remove.
 */
export function AttachmentTray({
  tray,
  onRemove,
  onRetry,
  removeRef,
}: {
  tray: TrayItem[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  removeRef: (key: string, node: Focusable | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      role="list"
      aria-label={CHAT_TRAY_LABEL}
      style={{ marginHorizontal: -spacing.xs, marginBottom: spacing.sm }}
      contentContainerStyle={{ gap: spacing.lg, paddingLeft: spacing.xs, paddingRight: OVERHANG + spacing.xs, paddingTop: OVERHANG }}
    >
      {tray.map((item) => (
        <TrayTile key={item.key} item={item} labels={trayItemLabels(tray, item.key)} onRemove={onRemove} onRetry={onRetry} removeRef={removeRef} />
      ))}
    </ScrollView>
  );
}

function TrayTile({
  item,
  labels,
  onRemove,
  onRetry,
  removeRef,
}: {
  item: TrayItem;
  labels: ReturnType<typeof trayItemLabels>;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  removeRef: (key: string, node: Focusable | null) => void;
}) {
  const uploading = item.status === "uploading";
  const failed = item.status === "failed";
  const photo = item.kind === "PHOTO";
  return (
    <View role="listitem" aria-busy={uploading} aria-label={uploading ? labels.busy : labels.name} style={[styles.slot, photo ? { width: TILE } : { maxWidth: FILE_TILE_MAX }]}>
      <View style={[styles.tile, failed ? styles.failedTile : null]}>
        {photo ? (
          item.previewUri ? (
            <Image source={{ uri: item.previewUri }} cachePolicy="none" contentFit="cover" transition={0} accessible={false} style={[StyleSheet.absoluteFill, uploading ? { opacity: 0.5 } : null]} />
          ) : null
        ) : (
          <View style={[styles.fileBody, uploading ? { opacity: 0.5 } : null]}>
            <IconFile size={22} color={colors.muted} />
            <View aria-hidden style={{ flexShrink: 1, minWidth: 0 }}>
              <Text numberOfLines={1} ellipsizeMode="middle" style={styles.fileName}>
                {item.name}
              </Text>
              <Text style={styles.fileSize}>{formatFileSize(item.size)}</Text>
            </View>
          </View>
        )}
        {uploading && (
          <View aria-hidden style={[StyleSheet.absoluteFill, styles.center]}>
            <ActivityIndicator color={colors.text} />
          </View>
        )}
        {failed && (
          <Pressable onPress={() => onRetry(item.key)} accessibilityRole="button" accessibilityLabel={labels.retry} style={[StyleSheet.absoluteFill, styles.center, styles.retry]}>
            <IconAlert size={18} color={DANGER_INK} />
            <Text aria-hidden style={styles.retryText}>
              Try again
            </Text>
          </Pressable>
        )}
      </View>
      {/* A 44-point target over the tile's corner (OVERHANG); the visible mark is a dark disc inside the corner that reads on any photo. */}
      <Pressable ref={(node) => removeRef(item.key, node)} onPress={() => onRemove(item.key)} accessibilityRole="button" accessibilityLabel={labels.remove} style={styles.remove}>
        <View style={styles.removeDisc}>
          <IconClose size={14} color="#fff" />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { height: TILE },
  tile: { flex: 1, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: "#f1f5f9" },
  failedTile: { borderWidth: 2, borderColor: DANGER_RING },
  fileBody: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: "100%", backgroundColor: colors.card, paddingLeft: 10, paddingRight: 40 },
  fileName: { fontSize: 14, fontWeight: "500", color: colors.text },
  fileSize: { fontSize: 12, color: colors.secondary },
  center: { alignItems: "center", justifyContent: "center" },
  retry: { gap: 2, backgroundColor: "rgba(255,255,255,0.88)" },
  retryText: { fontSize: 11, fontWeight: "700", color: DANGER_INK },
  // The disc sits 4 points inside the tile's corner, as on the web app: 2 from this target's left and bottom edges.
  remove: { position: "absolute", top: -OVERHANG, right: -OVERHANG, width: 44, height: 44, alignItems: "flex-start", justifyContent: "flex-end", paddingLeft: 2, paddingBottom: 2, zIndex: 1 },
  removeDisc: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(15,23,42,0.7)", alignItems: "center", justifyContent: "center" },
});
