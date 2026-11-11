import { CHAT_ATTACHMENTS_PER_MESSAGE, CHAT_FILE_MAX_BYTES, GREYS, STATUS_TONES } from "@illuminize/shared";
import { useId, useRef, type ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { IconFile, IconImage, type IconProps } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { Button, describedBy } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

export type AttachChoice = "photos" | "files";

const CHOICES: { value: AttachChoice; label: string; hint: string; icon: (p: IconProps) => ReactElement }[] = [
  { value: "photos", label: "Photos", hint: `JPEG, PNG or WebP, up to ${CHAT_ATTACHMENTS_PER_MESSAGE}`, icon: IconImage },
  { value: "files", label: "PDF file", hint: `Up to ${Math.round(CHAT_FILE_MAX_BYTES / (1024 * 1024))} MB`, icon: IconFile },
];

/**
 * What to add to a chat message: photos from the library or a PDF. The picker opens once the sheet has gone, since iOS can't
 * show one while the sheet is still sliding away; elsewhere at once, which the browser build needs to open its file chooser
 * from the tap itself.
 */
export function AttachSheet({ open, onClose, onChoose }: { open: boolean; onClose: () => void; onChoose: (choice: AttachChoice) => void }) {
  const next = useRef<AttachChoice | null>(null);
  const choose = (choice: AttachChoice) => {
    onClose();
    if (Platform.OS === "ios") next.current = choice;
    else onChoose(choice);
  };
  return (
    <Sheet
      open={open}
      title="Add to message"
      onClose={onClose}
      onDismiss={() => {
        const choice = next.current;
        next.current = null;
        if (choice) onChoose(choice);
      }}
    >
      <View style={{ gap: spacing.xs }}>
        {CHOICES.map((c) => (
          <Choice key={c.value} label={c.label} hint={c.hint} icon={c.icon} onPress={() => choose(c.value)} />
        ))}
      </View>
      <Button title="Cancel" variant="outline" onPress={onClose} />
    </Sheet>
  );
}

/** A described row, as More's are: the icon in a well, the name, and the line under it read after the name. */
function Choice({ label, hint, icon: Icon, onPress }: { label: string; hint: string; icon: (p: IconProps) => ReactElement; onPress: () => void }) {
  const hintId = useId();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} {...describedBy(hintId)} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={styles.well}>
        <Icon size={20} color={GREYS.body} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.label}>{label}</Text>
        <Text nativeID={hintId} style={styles.hint}>
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingVertical: spacing.xs },
  well: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: STATUS_TONES.neutral.fill, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "600", color: colors.text },
  hint: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 1 },
});
