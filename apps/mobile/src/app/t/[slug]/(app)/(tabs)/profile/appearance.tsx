import {
  BACKDROP_LABELS,
  backdropChoices,
  chosenBackdrop,
  pageBackdrop,
  photoRemoval,
  resolveAppearance,
  type MemberAppearanceUpdate,
  type MemberBackdrop,
  type MembershipDto,
  type PageBackdropSpec,
} from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { AccessibilityInfo, ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { IconCamera, IconCheck, IconImage } from "@/components/icons";
import { Button, Card, FieldError, Muted, Screen, focusOn, headingRole, type Focusable } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, radius, spacing, useTheme } from "@/theme";

const ADD_HINT = "Opens your photos to choose one";

/**
 * The member's background for the app at this institution, as on the web app's My profile (see pageBackdrop): the plain
 * page, a tint of the institution's colour, its cover, or a photo of their own. It is saved on their membership, so the
 * web app shows it too. The app behind changes as soon as a tile is chosen, and changes back if the save fails.
 */
export default function AppearanceScreen() {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const stored = resolveAppearance(membership.appearance);
  const shown = chosenBackdrop(stored, tenant);
  const options = backdropChoices(tenant);
  const upload = useImageUpload(slug, { purpose: "backdrop" });
  const { busy } = upload;
  const photoTile = useRef<Focusable>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Read out politely: the upload starting or cancelled, the photo arriving or going. A phone's screen reader is told;
  // the browser build's follows a hidden live region.
  const [status, setStatus] = useState("");
  const spoken = busy ? "Uploading photo…" : status;
  useEffect(() => {
    if (spoken && Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(spoken);
  }, [spoken]);

  const mutationKey = ["appearance", slug];
  const setAppearance = (appearance: MembershipDto["appearance"]) => qc.setQueryData<MembershipDto>(qk.membership(slug), (m) => m && { ...m, appearance });
  const save = useMutation({
    mutationKey,
    mutationFn: (change: MemberAppearanceUpdate) => api.membership.updateAppearance(slug, change),
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: qk.membership(slug), exact: true });
      const previous = qc.getQueryData<MembershipDto>(qk.membership(slug))?.appearance;
      if (previous) setAppearance({ ...resolveAppearance(previous), ...change });
      return { previous };
    },
    // While a later choice is still on its way, its answer decides what shows, so an earlier one doesn't flash back.
    onError: (err, _change, context) => {
      if (context?.previous && qc.isMutating({ mutationKey }) === 1) setAppearance(context.previous);
      setProblem(errorMessage(err));
    },
    onSuccess: (updated) => {
      if (qc.isMutating({ mutationKey }) === 1) qc.setQueryData(qk.membership(slug), updated);
    },
    // The last save to settle asks the server what it holds: with choices overlapping, an answer dropped while another
    // was on its way, or a rollback to a snapshot a later save had already replaced, would otherwise stay on screen.
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) === 1) void qc.invalidateQueries({ queryKey: qk.membership(slug), exact: true });
    },
  });

  const pickPhoto = async () => {
    if (busy) return;
    setProblem(null);
    setStatus("");
    const url = await upload.pickAndUpload();
    if (url) save.mutate({ backdrop: "PHOTO", photoUrl: url }, { onSuccess: () => setStatus("Photo added.") });
  };

  const choose = (backdrop: MemberBackdrop) => {
    setProblem(null);
    if (backdrop === "PHOTO" && !stored.photoUrl) void pickPhoto();
    else if (backdrop !== stored.backdrop) save.mutate({ backdrop });
  };

  const removePhoto = () => {
    upload.clearError();
    setProblem(null);
    save.mutate(photoRemoval(stored), { onSuccess: () => setStatus("Photo removed.") });
    // The photo's buttons go with it; the tile that adds one takes the focus.
    focusOn(photoTile.current);
  };

  // Two tiles to a row, as on a phone-wide web page; a row of one keeps its tile at half width.
  const rows: MemberBackdrop[][] = [];
  for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2));

  return (
    <Screen title="Appearance">
      <Card style={{ gap: spacing.md }}>
        <View style={{ gap: 2 }}>
          <Text {...headingRole(2)} style={styles.heading}>
            Background
          </Text>
          <Muted size={13}>{`Your background for ${tenant.shortName ?? tenant.name}, on every device. Only you see this. Posts and cards stay white so they're easy to read.`}</Muted>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Background" style={{ gap: spacing.md }}>
          {rows.map((row) => (
            <View key={row.join()} style={{ flexDirection: "row", gap: spacing.md }}>
              {row.map((backdrop) => {
                const adding = backdrop === "PHOTO" && !stored.photoUrl;
                return (
                  <BackdropTile
                    key={backdrop}
                    label={BACKDROP_LABELS[backdrop]}
                    checked={shown === backdrop}
                    tileRef={backdrop === "PHOTO" ? photoTile : undefined}
                    hint={adding ? ADD_HINT : undefined}
                    busy={adding && busy}
                    onPress={() => choose(backdrop)}
                    preview={adding ? <AddPhotoPreview busy={busy} /> : <BackdropPreview spec={pageBackdrop({ backdrop, photoUrl: stored.photoUrl }, tenant)} />}
                  />
                );
              })}
              {row.length === 1 && <View style={{ flex: 1 }} />}
            </View>
          ))}
        </View>
        {(!!stored.photoUrl || busy) && (
          <View role="group" aria-label="Your background photo" style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
            {/* Stays pressable while uploading (marked busy, not disabled), so focus stays on it; a second press does nothing. */}
            {!!stored.photoUrl && (
              <Button
                title={busy ? "Uploading…" : "Change photo"}
                variant="outline"
                icon={(color) => (busy ? <ActivityIndicator color={color} size="small" /> : <IconCamera size={18} color={color} />)}
                aria-busy={busy}
                aria-disabled={busy}
                onPress={() => void pickPhoto()}
              />
            )}
            {busy ? (
              <Button
                title="Cancel upload"
                variant="ghost"
                onPress={() => {
                  upload.cancel();
                  setStatus("Upload cancelled.");
                  focusOn(photoTile.current);
                }}
              />
            ) : (
              <Button title="Remove photo" variant="ghost" onPress={removePhoto} />
            )}
          </View>
        )}
        <FieldError error={upload.error ?? problem} />
        {Platform.OS === "web" && (
          <Text style={styles.status} aria-live="polite">
            {spoken}
          </Text>
        )}
      </Card>
    </Screen>
  );
}

/** One background to choose: a picture of a page with a white card on it, and its name, chosen as reactions are. */
function BackdropTile({
  label,
  checked,
  preview,
  busy,
  hint,
  tileRef,
  onPress,
}: {
  label: string;
  checked: boolean;
  preview: ReactNode;
  busy?: boolean;
  hint?: string;
  tileRef?: Ref<Focusable>;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      ref={tileRef}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={hint}
      // aria-checked rather than accessibilityState: React Native maps it on devices, and react-native-web only emits the ARIA form.
      aria-checked={checked}
      aria-busy={!!busy}
      style={({ pressed }) => [
        styles.tile,
        // A thicker ring when chosen, with the padding a point smaller, so nothing moves.
        checked ? { backgroundColor: theme.primaryWash, borderColor: theme.primaryRing, borderWidth: 2, padding: spacing.sm - 1 } : { backgroundColor: pressed ? colors.bg : colors.card },
      ]}
    >
      {preview}
      {/* On the preview's corner, not beside the label, so choosing a tile never rewraps its label and moves what's below. */}
      {checked && (
        <View aria-hidden style={[styles.check, { backgroundColor: theme.primaryInk }]}>
          <IconCheck size={13} strokeWidth={2.75} color="#ffffff" />
        </View>
      )}
      <View style={styles.tileLabel}>
        <Text style={{ flexShrink: 1, fontSize: 14, fontWeight: "600", color: checked ? theme.primaryInk : "#334155" }}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** The page as this background draws it, photo and veil included, under a white card standing for a post. */
function BackdropPreview({ spec }: { spec: PageBackdropSpec }) {
  return (
    <View aria-hidden style={[styles.preview, { backgroundColor: spec.color }]}>
      {spec.imageUrl && (
        <>
          <Image source={{ uri: spec.imageUrl }} resizeMode="cover" accessible={false} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: spec.color, opacity: spec.scrim }]} />
        </>
      )}
      <View style={styles.stub}>
        <View style={[styles.stubLine, { width: "50%", backgroundColor: "#e2e8f0" }]} />
        <View style={[styles.stubLine, { width: "75%", backgroundColor: "#f1f5f9" }]} />
      </View>
    </View>
  );
}

/** "Your photo" before there is one: choosing it opens the member's photos. */
function AddPhotoPreview({ busy }: { busy: boolean }) {
  return (
    <View aria-hidden style={[styles.preview, styles.addPhoto]}>
      {busy ? <ActivityIndicator size="small" color={colors.muted} /> : <IconImage size={20} color={colors.muted} />}
      <Text style={{ fontSize: 12, color: colors.muted }}>{busy ? "Uploading…" : "Add a photo"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 15, fontWeight: "700", color: colors.text },
  tile: { flex: 1, minHeight: 44, gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  tileLabel: { flexDirection: "row", alignItems: "center", minHeight: 20, paddingHorizontal: 2 },
  // Inside the chosen tile's 2pt border, 4pt in from the preview's top right corner.
  check: { position: "absolute", top: spacing.sm + 3, right: spacing.sm + 3, width: 20, height: 20, borderRadius: radius.full, borderWidth: 2, borderColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  preview: { height: 64, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: "rgba(15,23,42,0.06)" },
  stub: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 12,
    bottom: 0,
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 8,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: "#ffffff",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  stubLine: { height: 6, borderRadius: radius.full },
  addPhoto: { alignItems: "center", justifyContent: "center", gap: 4, borderStyle: "dashed", borderColor: colors.borderStrong, backgroundColor: "#f8fafc" },
  // Read by screen readers, not seen.
  status: { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" },
});
