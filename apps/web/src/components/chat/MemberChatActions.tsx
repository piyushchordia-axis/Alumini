import type { MemberProfileDto } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import { useQuery } from "@tanstack/react-query";
import { BlockMemberButton } from "@/components/chat/BlockMemberButton";
import { IconMessages } from "@/components/icons";
import { LinkButton } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { api } from "@/lib/api";

/** "Message this member" opens the thread the member already has, or a new one. Offered only where the profile allows it. */
export function MessageMemberButton({ slug, member }: { slug: string; member: Pick<MemberProfileDto, "id" | "canMessage"> }) {
  const existing = useQuery({ queryKey: chatKeys.direct(slug, member.id), queryFn: () => api.chat.directThread(slug, member.id), enabled: member.canMessage });
  if (!member.canMessage || existing.isLoading) return null;
  const id = existing.data?.conversationId;
  return (
    <LinkButton to={id ? `/t/${slug}/app/messages/${id}` : `/t/${slug}/app/messages/new?to=${member.id}`} size="md" className="min-h-11">
      <IconMessages size={18} />
      Message this member
    </LinkButton>
  );
}

/** Block or unblock from a profile, which is the way in when there's no conversation to block from. */
export function ProfileBlockButton({ slug, member }: { slug: string; member: Pick<MemberProfileDto, "id" | "fullName"> }) {
  // The same query as Blocked members. Blocking twice is harmless, so someone blocked beyond the first page only gets offered "Block" again.
  const blocks = useInfiniteList(chatKeys.blocks(slug), (cursor) => api.chat.blocks(slug, { cursor, limit: 30 }));
  if (blocks.isLoading) return null;
  const blocked = blocks.items.some((b) => b.member.id === member.id);
  return <BlockMemberButton slug={slug} member={member} blocked={blocked} variant="ghost" size="md" />;
}
