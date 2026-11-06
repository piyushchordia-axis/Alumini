import { memberReasonSchema } from "@illuminize/shared";
import { unlessOutOfDate, type ApiClientError } from "@illuminize/shared/client";
import { useState } from "react";
import { Text } from "react-native";
import { Sheet } from "@/components/Sheet";
import { Button, ErrorText, Input } from "@/components/ui";
import { colors } from "@/theme";

/**
 * Asks for the reason or note an admin action carries, then acts (the web console's ReasonModal). With `required`, the
 * confirm button waits for a reason the API takes (3 to 500 characters). It stays open, with what was typed, while the
 * action fails, and Cancel or the backdrop keep the text for next time. An out-of-date answer (another admin acted first,
 * or it's gone) closes it, as trying again can't help: `onOutOfDate` hears it, to refetch and say why. With `text` and
 * `onTextChange` the screen holds what's typed, as one sheet serving many rows keeps a draft for each.
 */
export function ReasonSheet({
  open,
  title,
  body,
  confirmLabel,
  required = false,
  tone = "danger",
  placeholder,
  onConfirm,
  onOutOfDate,
  onClose,
  text: heldText,
  onTextChange,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  required?: boolean;
  tone?: "primary" | "danger";
  placeholder?: string;
  onConfirm: (text: string) => Promise<unknown>;
  onOutOfDate?: (err: ApiClientError) => void;
  onClose: () => void;
  text?: string;
  onTextChange?: (text: string) => void;
}) {
  const [ownText, setOwnText] = useState("");
  const text = heldText ?? ownText;
  const setText = onTextChange ?? setOwnText;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ready = !required || memberReasonSchema.safeParse({ reason: text }).success;
  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlessOutOfDate(() => onConfirm(text.trim()), onOutOfDate);
      setText("");
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} title={title} onClose={close}>
      {body ? <Text style={{ fontSize: 14, color: colors.muted }}>{body}</Text> : null}
      {/* autoComplete off, so the web build's browser doesn't keep it for session restore, past sign-out. */}
      <Input
        value={text}
        onChangeText={setText}
        placeholder={placeholder ?? (required ? "Reason (shown to the member)" : "Optional note")}
        hint={required ? "At least 3 characters." : undefined}
        maxLength={500}
        multiline
        autoFocus
        autoComplete="off"
        editable={!busy}
      />
      <ErrorText error={error} />
      <Button title={confirmLabel} variant={tone} loading={busy} disabled={!ready} onPress={() => void confirm()} />
      <Button title="Cancel" variant="ghost" disabled={busy} onPress={close} />
    </Sheet>
  );
}
