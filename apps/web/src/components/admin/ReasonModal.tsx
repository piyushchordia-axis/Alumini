import { useState } from "react";
import { Button, Modal, Textarea } from "@/components/ui";

export interface ReasonModalProps {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: (text: string) => Promise<unknown> | void;
  onClose: () => void;
}

/** Small modal that collects a reason / note before an admin action. */
export function ReasonModal({ open, title, label, placeholder, required, confirmLabel = "Confirm", tone = "primary", onConfirm, onClose }: ReasonModalProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(text.trim());
      setText("");
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone} onClick={() => void submit()} loading={busy} disabled={required && text.trim().length < 3}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {label && <p className="mb-2 text-sm text-slate-600">{label}</p>}
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? (required ? "Reason (shown to the member)" : "Optional note")} maxLength={500} />
    </Modal>
  );
}
