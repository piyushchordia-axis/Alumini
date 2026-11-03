import type { ChatConversationDto } from "@illuminize/shared";
import { CHAT_MUTE_OPTIONS, chatMuteUntil, isMutedUntilTurnedOn, type ChatMuteOption } from "@illuminize/shared/chat";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BlockMemberButton } from "@/components/chat/BlockMemberButton";
import { Button, Modal } from "@/components/ui";
import { useNow } from "@/hooks/useChat";
import { api } from "@/lib/api";
import { isMuted, patchConversation } from "@/lib/chat";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/stores/uiStore";

/**
 * Mute and block for one thread. Reporting is on each message, because a report is about what was said. Blocking asks
 * first, and the screen asks in place of this sheet rather than over it, through `onBlock`.
 */
export function ConversationOptions({ slug, conversation, open, onClose, onBlock }: { slug: string; conversation: ChatConversationDto; open: boolean; onClose: () => void; onBlock: () => void }) {
  const qc = useQueryClient();
  const now = useNow();
  const [choosing, setChoosing] = useState(false);
  const muted = isMuted(conversation, now);
  const mute = useMutation({
    mutationFn: (until: string | null) => api.chat.mute(slug, conversation.id, { until }),
    onSuccess: (updated) => {
      patchConversation(qc, slug, conversation.id, () => updated);
      setChoosing(false);
      toast.success(updated.mutedUntil ? "Conversation muted" : "Conversation unmuted");
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const choose = (option: ChatMuteOption) => mute.mutate(chatMuteUntil(option, new Date()));
  const close = () => {
    setChoosing(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Conversation options">
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
          {muted ? (
            <>
              <p className="text-sm text-slate-600">{isMutedUntilTurnedOn(conversation.mutedUntil) ? "Muted until you turn it back on." : `Muted until ${formatDateTime(conversation.mutedUntil)}.`}</p>
              <Button variant="outline" className="min-h-11" onClick={() => mute.mutate(null)} loading={mute.isPending}>
                Unmute conversation
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">Muting stops notifications from this conversation and leaves it off the Messages badge.</p>
              <Button variant="outline" className="min-h-11" aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}>
                Mute conversation
              </Button>
              {choosing && (
                <div role="group" aria-label="Mute for" className="flex flex-wrap gap-2">
                  {CHAT_MUTE_OPTIONS.map((o) => (
                    <Button key={o.value} variant="ghost" className="min-h-11 border border-slate-200" disabled={mute.isPending} onClick={() => choose(o.value)}>
                      {o.label}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {conversation.peer && (
          <section className="space-y-2 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-800">Safety</h3>
            <p className="text-sm text-slate-600">To report something {conversation.peer.fullName} said, choose Report message beside it.</p>
            {conversation.blockedByMe ? (
              <BlockMemberButton slug={slug} member={conversation.peer} blocked size="md" />
            ) : (
              <Button
                variant="danger"
                className="min-h-11"
                onClick={() => {
                  close();
                  onBlock();
                }}
              >
                Block member
              </Button>
            )}
          </section>
        )}

        <div className="border-t border-slate-100 pt-4">
          <Link to={`/t/${slug}/app/messages/blocked`} onClick={close} className="inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-medium text-primary underline focus-visible:outline-2 focus-visible:outline-primary">
            Blocked members
          </Link>
        </div>
      </div>
    </Modal>
  );
}
