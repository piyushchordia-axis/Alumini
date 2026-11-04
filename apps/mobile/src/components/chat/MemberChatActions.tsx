import type { MemberProfileDto } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { BlockMemberButton } from "@/components/chat/BlockMember";
import { IconMessages } from "@/components/icons";
import { Button } from "@/components/ui";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { api } from "@/lib/api";

/** "Message this member" opens the thread the member already has, or a new one. Offered only where the profile allows it. */
export function MessageMemberButton({ slug, member }: { slug: string; member: Pick<MemberProfileDto, "id" | "canMessage"> }) {
  const router = useRouter();
  const existing = useQuery({ queryKey: chatKeys.direct(slug, member.id), queryFn: () => api.chat.directThread(slug, member.id), enabled: member.canMessage });
  if (!member.canMessage || existing.isLoading) return null;
  const id = existing.data?.conversationId;
  // A link, as on the web app: it goes somewhere rather than doing something.
  return (
    <Button
      title="Message this member"
      icon={(color) => <IconMessages size={18} color={color} />}
      accessibilityRole="link"
      onPress={() => router.push(id ? `/t/${slug}/messages/${id}` : `/t/${slug}/messages/new?to=${member.id}`)}
    />
  );
}

/** Block or unblock from a profile, which is the way in when there's no conversation to block from. */
export function ProfileBlockButton({ slug, member }: { slug: string; member: Pick<MemberProfileDto, "id" | "fullName"> }) {
  // The same query as Blocked members. Blocking twice is harmless, so someone blocked beyond the first page only gets offered "Block" again.
  const blocks = useInfiniteList(chatKeys.blocks(slug), (cursor) => api.chat.blocks(slug, { cursor, limit: 30 }));
  if (blocks.isLoading) return null;
  const blocked = blocks.items.some((b) => b.member.id === member.id);
  return <BlockMemberButton slug={slug} member={member} blocked={blocked} variant="ghost" />;
}
