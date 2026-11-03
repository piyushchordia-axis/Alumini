import { REPORT_REASONS, REPORT_REASON_LABELS, type ContentType, type ReportReason } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Chip, ErrorText, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { colors, spacing } from "@/theme";

/**
 * Reports a post, listing or group. `label` makes it a full-size button with that name, such as "Report group", and the sheet
 * takes the same title; without it the button is a small "Report", named "Report this content". With `onReported`, the
 * outcome goes to the screen and a failure stays in the sheet, because Alert.alert does nothing on the web export.
 */
export function ReportButton({ slug, contentType, contentId, label, onReported }: { slug: string; contentType: ContentType; contentId: string; label?: string; onReported?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("SPAM");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const close = () => {
    setOpen(false);
    setError(null);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.reports.create(slug, { contentType, contentId, reason, details: details || null });
      close();
      setDetails("");
      if (onReported) onReported("Thanks. The admins will take a look.");
      else Alert.alert("Thanks", "The admins will take a look.");
    } catch (err) {
      if (onReported) setError(errorMessage(err));
      else Alert.alert("Could not report", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {label ? (
        <Button title={label} variant="ghost" onPress={() => setOpen(true)} style={{ borderColor: "transparent" }} />
      ) : (
        <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Report this content">
          <Text style={{ color: colors.faint, fontSize: 12 }}>Report</Text>
        </Pressable>
      )}
      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.5)" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
          <View role="dialog" aria-modal aria-label={label ?? "Report content"} style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.xl, paddingBottom: spacing.xl + insets.bottom, gap: spacing.md }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>{label ?? "Report content"}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {REPORT_REASONS.map((r) => (
                <Chip key={r} tall={!!label} label={REPORT_REASON_LABELS[r]} active={reason === r} onPress={() => setReason(r)} />
              ))}
            </View>
            <Input accessibilityLabel="Details (optional)" placeholder="Anything the admins should know? (optional)" value={details} onChangeText={setDetails} maxLength={1000} multiline autoComplete="off" />
            <ErrorText error={error} />
            <Button title="Submit report" variant="danger" onPress={() => void submit()} loading={busy} />
            <Button title="Cancel" variant="ghost" onPress={close} disabled={busy} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
