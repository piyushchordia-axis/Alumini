import type { ChatMemberDto } from "@illuminize/shared";
import { BLOCK_EXPLAINED } from "@illuminize/shared/chat";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button, type ButtonProps } from "@/components/ui";
import { api } from "@/lib/api";
import { refreshChat } from "@/lib/chat";
import { toast } from "@/stores/uiStore";

type Member = Pick<ChatMemberDto, "id" | "fullName">;

function useBlockChange(slug: string, member: Member, onDone?: (blocked: boolean) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (block: boolean) => (block ? api.chat.block(slug, member.id).then(() => true) : api.chat.unblock(slug, member.id).then(() => false)),
    onSuccess: (nowBlocked) => {
      void refreshChat(qc, slug);
      toast.success(nowBlocked ? `${member.fullName} is blocked` : `${member.fullName} is unblocked`);
      onDone?.(nowBlocked);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Asks before blocking. Neither blocking nor unblocking is ever shown to the other member, and these words promise nothing a block doesn't do. */
export function BlockConfirmDialog({ slug, member, open, onClose, onDone }: { slug: string; member: Member; open: boolean; onClose: () => void; onDone?: () => void }) {
  const block = useBlockChange(slug, member, () => {
    onClose();
    onDone?.();
  });
  return (
    <ConfirmDialog
      open={open}
      title={`Block ${member.fullName}?`}
      body={BLOCK_EXPLAINED}
      confirmLabel="Block member"
      destructive
      busy={block.isPending}
      onConfirm={() => block.mutate(true)}
      onCancel={onClose}
    />
  );
}

/** "Block member", which asks first, or "Unblock member", which doesn't need to. */
export function BlockMemberButton({
  slug,
  member,
  blocked,
  variant = "outline",
  size = "sm",
  className,
  onDone,
}: {
  slug: string;
  member: Member;
  blocked: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  /** After an unblock goes through. */
  onDone?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const unblock = useBlockChange(slug, member, onDone);
  return (
    <>
      <Button variant={blocked ? "outline" : variant} size={size} className={clsx("min-h-11", className)} loading={unblock.isPending} onClick={() => (blocked ? unblock.mutate(false) : setConfirming(true))}>
        {blocked ? "Unblock member" : "Block member"}
      </Button>
      <BlockConfirmDialog slug={slug} member={member} open={confirming} onClose={() => setConfirming(false)} />
    </>
  );
}
