import { REPORT_REASONS, REPORT_REASON_LABELS, type ContentType, type ReportReason } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";
import { Button, Chip, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { colors, spacing } from "@/theme";

export function ReportButton({ slug, contentType, contentId }: { slug: string; contentType: ContentType; contentId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("SPAM");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.reports.create(slug, { contentType, contentId, reason, details: details || null });
      setOpen(false);
      Alert.alert("Thanks", "The admins will take a look.");
    } catch (err) {
      Alert.alert("Could not report", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8}>
        <Text style={{ color: colors.faint, fontSize: 12 }}>Report</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.5)" }}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.xl, gap: spacing.md }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>Report content</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {REPORT_REASONS.map((r) => (
                <Chip key={r} label={REPORT_REASON_LABELS[r]} active={reason === r} onPress={() => setReason(r)} />
              ))}
            </View>
            <Input placeholder="Anything the admins should know? (optional)" value={details} onChangeText={setDetails} multiline />
            <Button title="Submit report" variant="danger" onPress={() => void submit()} loading={busy} />
            <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
