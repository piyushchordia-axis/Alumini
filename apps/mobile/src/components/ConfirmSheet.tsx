import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, ErrorText } from "@/components/ui";
import { colors, spacing } from "@/theme";

/**
 * Asks before a destructive or hard-to-undo action. Use this rather than Alert.alert in new flows: Alert.alert does
 * nothing on the web export, so the action could never be confirmed there.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  /** Why the action failed, shown in the sheet. Alert.alert would show nothing on the web export. */
  error?: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const cancel = () => {
    if (!busy) onCancel();
  };
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={cancel}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.5)" }}>
        <Pressable style={{ flex: 1 }} onPress={cancel} accessibilityRole="button" accessibilityLabel="Close" />
        <View role="alertdialog" aria-modal aria-label={title} style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.xl, paddingBottom: spacing.xl + insets.bottom, gap: spacing.md }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>{title}</Text>
          {body ? <Text style={{ fontSize: 14, color: colors.muted }}>{body}</Text> : null}
          <ErrorText error={error} />
          <Button title={confirmLabel} variant={destructive ? "danger" : "primary"} onPress={onConfirm} loading={busy} />
          <Button title="Cancel" variant="ghost" onPress={cancel} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}
