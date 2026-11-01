import { Button, Modal } from "@/components/ui";

/**
 * Asks before a destructive or hard-to-undo action. Use this rather than window.confirm in new flows: it matches the
 * rest of the app, and a browser test can drive it without handling a native dialog.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = () => {
    if (!busy) onCancel();
  };
  return (
    <Modal
      open={open}
      onClose={cancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={cancel} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body ? <p className="text-sm text-slate-600">{body}</p> : null}
    </Modal>
  );
}
