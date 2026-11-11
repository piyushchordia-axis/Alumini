import type { ChatAttachmentDto, ChatAttachmentLinkDto, ChatMessageDto } from "@illuminize/shared";
import { PHOTO_LOAD_FAILED_TEXT, photoViewerTitle } from "@illuminize/shared/chat";
import { errorMessage } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode, type Ref } from "react";
import { AccessibilityInfo, ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, Text, View, type ListViewToken, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconAlert, IconChevronLeft, IconChevronRight, IconClose, IconDownload, IconFlag, IconShare } from "@/components/icons";
import { focusOn, headingRole, type Focusable } from "@/components/ui";
import { attachmentLinksQuery, openAttachment } from "@/lib/chatAttachments";
import { heldState } from "@/lib/a11y";
import { formatDateTime } from "@/lib/format";
import { spacing } from "@/theme";

const WEB = Platform.OS === "web";
// The web app's slate-950 at 95%, with white controls and slate-300 for the time.
const STAGE = "rgba(2,6,23,0.95)";
const SUBTLE = "#cbd5e1";
const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

function ViewerButton({ label, onPress, disabled = false, busy = false, buttonRef, style, children }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; buttonRef?: Ref<Focusable>; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Pressable
      ref={buttonRef}
      onPress={disabled || busy ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Stays focusable at either end, so focus never drops out of the viewer.
      aria-disabled={disabled}
      {...heldState(disabled)}
      aria-busy={busy}
      style={({ pressed }) => [styles.button, style, pressed && !disabled ? { backgroundColor: "rgba(255,255,255,0.15)" } : null, disabled ? { opacity: 0.4 } : null]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : children}
    </Pressable>
  );
}

/**
 * A message's photos one at a time, over everything: Close, Share photo (on the web build, Download photo) and Report
 * message for someone else's, a page per photo to swipe through with Previous and Next beside it. Android's Back closes
 * it, as Escape does on the web build. It fades in, or appears at once for anyone who asked for less motion, and screen
 * readers start on Close and stay inside it. The full photo comes from links fetched again if they're no longer fresh,
 * kept in memory only, with the thumbnail under it while it loads (an Image of its own, from the bubble's memory cache:
 * expo-image keeps a `placeholder` on disk whatever the cachePolicy).
 *
 * `open` false hides it before the caller unmounts it, so iOS can say when it's gone (`onDismiss`) before a report sheet
 * takes its place.
 */
export function PhotoViewer({
  slug,
  conversationId,
  message,
  ...rest
}: Omit<PhotoViewerFrameProps<ChatAttachmentDto>, "sentAt" | "cachePolicy" | "linkOf" | "lost" | "retrying" | "onRetry" | "onShare" | "onImageError"> & {
  slug: string;
  conversationId: string;
  message: ChatMessageDto;
}) {
  const qc = useQueryClient();
  const links = useQuery(attachmentLinksQuery(slug, conversationId, message.id));
  return (
    <PhotoViewerFrame
      {...rest}
      sentAt={message.createdAt}
      cachePolicy="memory"
      linkOf={(photo) => links.data?.links.find((l) => l.id === photo.id)}
      lost={!links.isFetching && (!!links.error || !!links.data)}
      retrying={links.isFetching}
      onRetry={() => void links.refetch()}
      onShare={(photo) => openAttachment(qc, slug, conversationId, message.id, photo)}
    />
  );
}

type PhotoLink = Pick<ChatAttachmentLinkDto, "url" | "thumbUrl">;

interface PhotoViewerFrameProps<A extends ChatAttachmentDto> {
  open: boolean;
  photos: A[];
  startIndex: number;
  /** Whose photos they are, "you" for the member's own. */
  who: string;
  /** When the message was sent, as an ISO time. */
  sentAt: string;
  /** "memory" keeps a photo in expo-image's memory to show again; "none" keeps nothing, as for a chat report's view. */
  cachePolicy: "memory" | "none";
  /** A photo's links, or undefined while they aren't known or can't be had. */
  linkOf: (photo: A) => PhotoLink | undefined;
  /** Links have come back (or failed) without a photo's: show the failure. */
  lost: boolean;
  /** Links are being fetched again: a failure waits for them. */
  retrying: boolean;
  /** Try again on a photo that didn't load; without it the failure shows with no button. */
  onRetry?: () => void;
  /** Shares the photo (on the web build, downloads it); throws with words to say. */
  onShare: (photo: A) => Promise<void>;
  /** The full photo failed to load, perhaps because its link ran out. */
  onImageError?: (photo: A) => void;
  /** Only for someone else's message. */
  onReport?: () => void;
  onClose: () => void;
  /** iOS only: it has gone. */
  onDismiss?: () => void;
}

/**
 * The viewer itself, knowing nothing about where its links come from: the member's PhotoViewer fetches them, while a chat
 * report's view in the console has them already, signed for that view, keeps no photo in any cache and offers no Report
 * message.
 */
export function PhotoViewerFrame<A extends ChatAttachmentDto>({
  open,
  photos,
  startIndex,
  who,
  sentAt,
  cachePolicy,
  linkOf,
  lost,
  retrying,
  onRetry,
  onShare,
  onImageError,
  onReport,
  onClose,
  onDismiss,
}: PhotoViewerFrameProps<A>) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const count = photos.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), count - 1));
  const at = Math.min(Math.max(index, 0), count - 1);
  const photo = photos[at]!;
  const list = useRef<FlatList<A>>(null);
  const closeButton = useRef<Focusable>(null);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const title = photoViewerTitle(at, count, who);

  useEffect(() => {
    if (problem && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(problem);
  }, [problem]);

  const go = (step: number) => {
    const next = Math.min(Math.max(at + step, 0), count - 1);
    if (next === at) return;
    setIndex(next);
    list.current?.scrollToIndex({ index: next, animated: !reduceMotion });
  };
  // A FlatList won't take a new onViewableItemsChanged once drawn, so this one never changes.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setIndex(first.index);
  }, []);

  // The web build's arrow keys page, as on the web app; its Modal already closes on Escape.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
  });
  useEffect(() => {
    if (!WEB || !open) return;
    const listener = (e: KeyboardEvent) => onKey(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [open]);

  const share = async () => {
    setProblem(null);
    setSharing(true);
    try {
      await onShare(photo);
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType={reduceMotion ? "none" : "fade"} statusBarTranslucent onRequestClose={onClose} onShow={() => focusOn(closeButton.current)} onDismiss={onDismiss}>
      <View role="dialog" aria-modal aria-label={title} accessibilityViewIsModal style={{ flex: 1, backgroundColor: STAGE }}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.xs, paddingLeft: insets.left + spacing.xs, paddingRight: insets.right + spacing.xs }]}>
          <View style={{ flex: 1, minWidth: 0, paddingHorizontal: spacing.sm }}>
            <Text {...headingRole(2)} numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <Text numberOfLines={1} style={styles.time}>
              {formatDateTime(sentAt)}
            </Text>
          </View>
          <ViewerButton label={WEB ? "Download photo" : "Share photo"} busy={sharing} onPress={() => void share()}>
            {WEB ? <IconDownload size={22} color="#fff" /> : <IconShare size={22} color="#fff" />}
          </ViewerButton>
          {onReport && (
            <ViewerButton label="Report message" onPress={onReport}>
              <IconFlag size={22} color="#fff" />
            </ViewerButton>
          )}
          <ViewerButton label="Close" onPress={onClose} buttonRef={closeButton}>
            <IconClose size={22} color="#fff" />
          </ViewerButton>
        </View>
        <View style={{ flex: 1 }} onLayout={(e) => setStage({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
          {stage && stage.width > 0 && (
            <FlatList
              // Drawn again at a new width (the phone turned), so each page stays one screen wide.
              key={stage.width}
              ref={list}
              data={photos}
              keyExtractor={(p) => p.id}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={at}
              getItemLayout={(_, i) => ({ length: stage.width, offset: stage.width * i, index: i })}
              onViewableItemsChanged={onViewable}
              viewabilityConfig={VIEWABILITY}
              renderItem={({ item }) => (
                <ViewerPhoto
                  photo={item}
                  link={linkOf(item)}
                  lost={lost}
                  retrying={retrying}
                  cachePolicy={cachePolicy}
                  width={stage.width}
                  height={stage.height}
                  quiet={reduceMotion}
                  onRetry={onRetry}
                  onImageError={onImageError && (() => onImageError(item))}
                />
              )}
            />
          )}
          {count > 1 && (
            <>
              <ViewerButton label="Previous photo" disabled={at === 0} onPress={() => go(-1)} style={[styles.pager, { left: insets.left + spacing.sm }]}>
                <IconChevronLeft size={22} color="#fff" />
              </ViewerButton>
              <ViewerButton label="Next photo" disabled={at === count - 1} onPress={() => go(1)} style={[styles.pager, { right: insets.right + spacing.sm }]}>
                <IconChevronRight size={22} color="#fff" />
              </ViewerButton>
            </>
          )}
        </View>
        {/* Mounted while empty, so a problem that appears in it is read out. */}
        <View role="status" accessibilityLiveRegion="polite" style={{ paddingBottom: insets.bottom + spacing.md, paddingHorizontal: spacing.lg, alignItems: "center" }}>
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * One page: the photo fitted to the screen, its thumbnail under it while it loads, or what to do when it won't. Kept in
 * memory under a key per photo, or with `cachePolicy` "none" not kept at all.
 */
function ViewerPhoto({
  photo,
  link,
  lost,
  retrying,
  cachePolicy,
  width,
  height,
  quiet,
  onRetry,
  onImageError,
}: {
  photo: ChatAttachmentDto;
  link: PhotoLink | undefined;
  lost: boolean;
  retrying: boolean;
  cachePolicy: "memory" | "none";
  width: number;
  height: number;
  quiet: boolean;
  onRetry?: () => void;
  onImageError?: () => void;
}) {
  const kept = cachePolicy === "memory";
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const uri = link?.url ?? null;
  const broken = !retrying && ((!!uri && failedUri === uri) || (!link && lost));
  return (
    <View style={{ width, height, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm }}>
      {broken ? (
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <IconAlert size={28} color={SUBTLE} />
          <Text style={{ fontSize: 14, color: SUBTLE }}>{PHOTO_LOAD_FAILED_TEXT}</Text>
          {onRetry && (
            <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again" style={({ pressed }) => [styles.retry, pressed ? { backgroundColor: "rgba(255,255,255,0.1)" } : null]}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff" }}>Try again</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <>
          {link?.thumbUrl && loadedUri !== uri ? (
            <Image
              source={{ uri: link.thumbUrl, cacheKey: kept ? `chat-${photo.id}-thumb` : undefined }}
              contentFit="contain"
              cachePolicy={cachePolicy}
              transition={0}
              accessible={false}
              style={{ position: "absolute", top: 0, left: spacing.sm, width: width - spacing.sm * 2, height }}
            />
          ) : null}
          <Image
            source={uri ? { uri, cacheKey: kept ? `chat-${photo.id}-full` : undefined } : null}
            contentFit="contain"
            cachePolicy={cachePolicy}
            transition={0}
            accessible={false}
            onLoad={() => setLoadedUri(uri)}
            onError={() => {
              setFailedUri(uri);
              onImageError?.();
            }}
            style={{ width: width - spacing.sm * 2, height }}
          />
          {/* A spinner while the photo loads, but nothing that moves for anyone who asked for less motion. */}
          {!quiet && loadedUri !== uri && <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} />}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 2, paddingBottom: spacing.sm },
  title: { fontSize: 16, fontWeight: "700", color: "#fff" },
  time: { fontSize: 13, color: SUBTLE },
  button: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  pager: { position: "absolute", top: "50%", marginTop: -22, backgroundColor: "rgba(0,0,0,0.5)" },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.lg, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.4)" },
  problem: { fontSize: 13, color: "#fff", textAlign: "center", backgroundColor: "rgba(15,23,42,0.9)", borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, overflow: "hidden" },
});
