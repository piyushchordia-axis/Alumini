import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Image, Platform, StyleSheet, Text, View } from "react-native";
import { IconImage } from "@/components/icons";
import { Avatar, Button, FieldError, Row, focusOn, type Focusable } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { colors, radius, spacing } from "@/theme";

/**
 * The institution's logo (`round`, shown as members see it, initials until there is one) or cover image (`wide`, 16:9),
 * with Upload or Change, Cancel upload while one runs, and Remove. Photos are prepared on the phone first (useImageUpload).
 * Nothing changes for members until the form is saved, so Remove doesn't ask. `onBusyChange` tells the form while an
 * upload runs, so it can hold Save until the image is in.
 */
export function ImageField({
  slug,
  label,
  noun,
  shape,
  name,
  value,
  onChange,
  error,
  onBusyChange,
}: {
  slug: string;
  label: string;
  /** In the buttons: "Change logo", "Remove cover". */
  noun: string;
  shape: "round" | "wide";
  /** Whose initials a round preview shows until there is an image. */
  name: string;
  value: string | null;
  onChange: (url: string | null) => void;
  error?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const upload = useImageUpload(slug);
  const choose = useRef<Focusable>(null);
  // Read out politely: the upload starting, being cancelled, the image arriving or going. A phone's screen reader is
  // told; the browser build's follows a hidden live region.
  const [status, setStatus] = useState("");
  const { busy } = upload;
  const spoken = busy ? `Uploading the ${noun}…` : status;

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
      setStatus(`${label} added.`);
    }
  };

  return (
    <View role="group" aria-label={label} style={{ gap: spacing.sm }}>
      <Text style={styles.label}>{label}</Text>
      {shape === "round" ? (
        <Avatar name={name} src={value} size={64} />
      ) : value ? (
        <Image source={{ uri: value }} resizeMode="cover" accessible={false} accessibilityIgnoresInvertColors style={styles.cover} />
      ) : (
        <View aria-hidden style={[styles.cover, styles.noCover]}>
          <IconImage size={20} color={colors.muted} />
          <Text style={{ fontSize: 12, color: colors.muted }}>No cover image</Text>
        </View>
      )}
      <Row style={{ gap: spacing.md }}>
        {/* Stays pressable while uploading (marked busy, not disabled), so focus stays on it; a second press does nothing. */}
        <Button
          ref={choose}
          title={busy ? "Uploading…" : value ? `Change ${noun}` : `Upload ${noun}`}
          variant="outline"
          icon={(color) => (busy ? <ActivityIndicator color={color} size="small" /> : <IconImage size={18} color={color} />)}
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
            title={`Remove ${noun}`}
            variant="ghost"
            onPress={() => {
              upload.clearError();
              onChange(null);
              setStatus(`${label} removed.`);
              // This button goes with the image; focus moves to the one that adds a new one.
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
  label: { fontSize: 13, fontWeight: "600", color: "#334155" },
  cover: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md, overflow: "hidden" },
  noCover: { alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, backgroundColor: "#f8fafc" },
  // Read by screen readers, not seen.
  status: { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" },
});
