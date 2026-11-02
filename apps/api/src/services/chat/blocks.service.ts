import type { ChatBlockDto, CursorPage, CursorQuery } from "@illuminize/shared";
import type { AppContext } from "../../context";
import { toChatBlockDto } from "../../dto/chat.dto";
import { AppError } from "../../lib/errors";
import { runInTransaction } from "../../lib/transaction";
import { deleteBlock, findBlock, findParticipant, insertBlock, limitLockWait, listBlocks, lockDirectConversation, lockPair, updateConversation, updateParticipant } from "../../repositories/chat.repo";
import { findMembershipById } from "../../repositories/memberships.repo";
import type { TenantContext } from "../../types/request";
import { emitUnread, type ChatActor } from "./chat.service";
import { publishChanged } from "./fanout";

/**
 * Blocks a member. Their request in waiting becomes DECLINED, and the blocker's copy of the thread freezes where it is, so
 * nothing they send can move it or show as unread. The blocked member hears nothing and sees no change. A thread still
 * frozen from an earlier block keeps its place, because the time on it is the last one this member may know about.
 */
export async function blockMember(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, membershipId: string): Promise<ChatBlockDto> {
  const me = actor.membership.id;
  const tenantId = tenantCtx.tenant.id;
  const target = await findMembershipById(ctx.db, tenantId, membershipId);
  if (!target) throw AppError.notFound("Member not found");
  if (target.id === me) throw AppError.badRequest("You can't block yourself");
  await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    // The block goes in under these locks: a send holding them has already decided, and the next one will see the block.
    await lockPair(tx, tenantId, me, target.id);
    const conversation = await lockDirectConversation(tx, tenantId, me, target.id);
    if (!(await insertBlock(tx, { tenantId, blockerMembershipId: me, blockedMembershipId: target.id })) || !conversation) return;
    const mine = await findParticipant(tx, conversation.id, me);
    await updateParticipant(tx, conversation.id, me, { frozenSortAt: mine?.frozenSortAt ?? conversation.lastMessageAt });
    if (conversation.directState === "PENDING" && conversation.requesterMembershipId !== me) await updateConversation(tx, conversation.id, { directState: "DECLINED" });
    await publishChanged(ctx, tx, tenantCtx.tenant.slug, conversation.id, { onlyMembershipId: me });
  });
  await emitUnread(ctx, tenantCtx, actor);
  return toChatBlockDto((await findBlock(ctx.db, me, target.id))!, target);
}

/**
 * Lifts a block. Everything so far is marked read, because what was withheld stays hidden for good. The thread stays where
 * it was in their list until the next message they can see, or its time would show when a withheld message was sent. A
 * request the block declined stays declined, and the member asks again in the usual way.
 */
export async function unblockMember(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, membershipId: string): Promise<void> {
  const me = actor.membership.id;
  const tenantId = tenantCtx.tenant.id;
  const target = await findMembershipById(ctx.db, tenantId, membershipId);
  if (!target) throw AppError.notFound("Member not found");
  await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    // Under the same locks as blocking and sending, or this could miss a first message that has seen the block and not yet committed.
    await lockPair(tx, tenantId, me, target.id);
    const conversation = await lockDirectConversation(tx, tenantId, me, target.id);
    if (!(await deleteBlock(tx, me, target.id)) || !conversation) return;
    await updateParticipant(tx, conversation.id, me, { lastReadSeq: conversation.lastSeq });
    await publishChanged(ctx, tx, tenantCtx.tenant.slug, conversation.id, { onlyMembershipId: me });
  });
  await emitUnread(ctx, tenantCtx, actor);
}

export async function listMyBlocks(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, query: CursorQuery): Promise<CursorPage<ChatBlockDto>> {
  const page = await listBlocks(ctx.db, tenantCtx.tenant.id, actor.membership.id, query);
  return { data: page.data.map((r) => toChatBlockDto(r.block, r.member)), nextCursor: page.nextCursor };
}
