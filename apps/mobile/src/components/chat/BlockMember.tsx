import type { ChatMemberDto } from "@illuminize/shared";
import { BLOCK_EXPLAINED } from "@illuminize/shared/chat";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View, type ViewStyle } from "react-native";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Button, ErrorText } from "@/components/ui";
import { api } from "@/lib/api";
import { refreshChat } from "@/lib/chat";

type Member = Pick<ChatMemberDto, "id" | "fullName">;

function useBlockChange(slug: string, member: Member, onDone?: (blocked: boolean) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (block: boolean) => (block ? api.chat.block(slug, member.id).then(() => true) : api.chat.unblock(slug, member.id).then(() => false)),
    onSuccess: (nowBlocked) => {
      void refreshChat(qc, slug);
      onDone?.(nowBlocked);
    },
  });
}

/** Asks before blocking. Neither blocking nor unblocking is ever shown to the other member, and these words promise nothing a block doesn't do. */
export function BlockConfirmSheet({ slug, member, open, onClose, onDone }: { slug: string; member: Member; open: boolean; onClose: () => void; onDone?: () => void }) {
  const block = useBlockChange(slug, member, () => {
    onClose();
    onDone?.();
  });
  return (
    <ConfirmSheet
      open={open}
      title={`Block ${member.fullName}?`}
      body={BLOCK_EXPLAINED}
      confirmLabel="Block member"
      destructive
      busy={block.isPending}
      error={block.error}
      onConfirm={() => block.mutate(true)}
      onCancel={() => {
        block.reset();
        onClose();
      }}
    />
  );
}

/** "Block member", which asks first, or "Unblock member", which doesn't need to. `onChange` hears which it became. */
export function BlockMemberButton({ slug, member, blocked, variant = "outline", style, onChange }: { slug: string; member: Member; blocked: boolean; variant?: "outline" | "ghost" | "danger"; style?: ViewStyle; onChange?: (blocked: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);
  const unblock = useBlockChange(slug, member, onChange);
  return (
    <View style={{ gap: 6 }}>
      <Button title={blocked ? "Unblock member" : "Block member"} variant={blocked ? "outline" : variant} style={style} loading={unblock.isPending} onPress={() => (blocked ? unblock.mutate(false) : setConfirming(true))} />
      <ErrorText error={unblock.error} />
      <BlockConfirmSheet slug={slug} member={member} open={confirming} onClose={() => setConfirming(false)} onDone={() => onChange?.(true)} />
    </View>
  );
}
