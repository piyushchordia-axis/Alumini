import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { IconCamera } from "@/components/icons";
import { Avatar, Button, FieldError, Row, focusOn, type Focusable } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { colors, elevation, radius, spacing } from "@/theme";

const SIZE = 96;
const HINT = "Members recognise faces first. A JPEG, PNG or WebP up to 5 MB.";

/**
 * The member's profile photo: a round preview (initials until there is one), and buttons to add, change or remove it, as
 * on the web app. The photo is picked with a square crop and uploaded as an avatar, which the server crops to a square;
 * only such an upload is accepted as a profile photo. `error` is the form's message for the photo (from the server); a
 * problem with the picked file shows in its place. `onBusyChange` tells the form while an upload is running, so it can
 * hold back saving until the photo is in.
 */
export function AvatarPicker({
  slug,
  name,
  value,
  onChange,
  error,
  onBusyChange,
}: {
  slug: string;
  name: string;
  value: string | null;
  onChange: (url: string | null) => void;
  error?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const upload = useImageUpload(slug, { purpose: "avatar", square: true });
  const choose = useRef<Focusable>(null);
  // Read out politely: the upload starting, being cancelled, the photo arriving or going. A phone's screen reader is
  // told; the browser build's follows a hidden live region.
  const [status, setStatus] = useState("");
  const { busy } = upload;
  const spoken = busy ? "Uploading photo…" : status;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (spoken && Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(spoken);
  }, [spoken]);

  const pick = async () => {
    if (busy) return;
    setStatus("");
    const url = await upload.pickAndUpload();
    if (url) {
      onChange(url);
      setStatus("Photo added.");
    }
  };

  return (
    <View style={styles.panel} role="group" aria-label="Profile photo">
      <View style={styles.ring}>
        <Avatar name={name} src={value} size={SIZE} />
      </View>
      <View style={{ alignItems: "center", gap: 2 }}>
        <Text style={styles.title}>Profile photo</Text>
        <Text style={styles.hint}>{HINT}</Text>
      </View>
      <Row style={{ justifyContent: "center", flexWrap: "wrap", gap: spacing.md }}>
        {/* Stays pressable while uploading (marked busy, not disabled), so focus stays on it; a second press does nothing. */}
        <Button
          ref={choose}
          title={busy ? "Uploading…" : value ? "Change photo" : "Add photo"}
          variant="outline"
          icon={(color) => (busy ? <ActivityIndicator color={color} size="small" /> : <IconCamera size={18} color={color} />)}
          accessibilityHint={`Profile photo. ${HINT}`}
          aria-busy={busy}
          aria-disabled={busy}
          onPress={() => void pick()}
        />
        {busy ? (
          <Button
            title="Cancel upload"
            variant="ghost"
            onPress={() => {
              upload.cancel();
              setStatus("Upload cancelled.");
              focusOn(choose.current);
            }}
          />
        ) : value ? (
          <Button
            title="Remove photo"
            variant="ghost"
            accessibilityHint="Profile photo"
            onPress={() => {
              upload.clearError();
              onChange(null);
              setStatus("Photo removed.");
              // This button goes with the photo; focus moves to the one that adds a new photo.
              focusOn(choose.current);
            }}
          />
        ) : null}
      </Row>
      <FieldError error={upload.error ?? error} />
      {Platform.OS === "web" && (
        <Text style={styles.status} aria-live="polite">
          {spoken}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // An inset panel, as on the web app.
  panel: { alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: "#f8fafc" },
  // A white ring and a light shadow round the photo, as on the web app.
  ring: { ...elevation[1], borderRadius: SIZE / 2 + 4, borderWidth: 4, borderColor: "#ffffff", backgroundColor: "#ffffff" },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  hint: { fontSize: 13, color: colors.muted, textAlign: "center" },
  // Read by screen readers, not seen.
  status: { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" },
});
