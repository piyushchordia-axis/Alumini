import type { ChatBlockDto, CursorPage, CursorQuery } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { Tx } from "../../db/client";
import { toChatBlockDto } from "../../dto/chat.dto";
import { AppError } from "../../lib/errors";
import { runInTransaction } from "../../lib/transaction";
import { deleteBlock, findBlock, findParticipant, insertBlock, limitLockWait, listBlocks, lockDirectConversation, lockPair, updateConversation, updateParticipant } from "../../repositories/chat.repo";
import { listSharedGroupIds, suppressInvitesFrom } from "../../repositories/chatGroups.repo";
import { findMembershipById } from "../../repositories/memberships.repo";
import { applyBlockToMentorships } from "../../repositories/mentorship.repo";
import { applyBlockToReferrals } from "../../repositories/referrals.repo";
import { publishBlockOnMentorships } from "../mentorship/events";
import { publishBlockOnReferrals } from "../referrals/events";
import type { TenantContext } from "../../types/request";
import { emitUnread, type ChatActor } from "./chat.service";
import { publishChanged, publishChangedTo } from "./fanout";

/**
 * The blocker's own devices hear about every group they share with the other member, where that member's messages have just
 * started or stopped showing redacted to them. Nobody else hears anything.
 */
async function tellAboutSharedGroups(ctx: AppContext, tx: Tx, slug: string, me: string, otherId: string): Promise<void> {
  for (const groupId of await listSharedGroupIds(tx, me, otherId)) await publishChanged(ctx, tx, slug, groupId, { onlyMembershipId: me });
}

/**
 * Blocks a member. Their request in waiting becomes DECLINED, their group invitations to this member disappear and so do
 * this member's to them, so a block can't leave them a way into the blocker's group, and the blocker's copy of the thread
 * freezes where it is, so nothing they send can move it or show as unread. The blocked member hears nothing and sees no
 * change but an invitation going, which an invitation also does when it lapses or its group closes. A thread still frozen
 * from an earlier block keeps its place, because the time on it is the last one this member may know about.
 */
export async function blockMember(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, membershipId: string): Promise<ChatBlockDto> {
  const me = actor.membership.id;
  const tenantId = tenantCtx.tenant.id;
  const slug = tenantCtx.tenant.slug;
  const target = await findMembershipById(ctx.db, tenantId, membershipId);
  if (!target) throw AppError.notFound("Member not found");
  if (target.id === me) throw AppError.badRequest("You can't block yourself");
  await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    // The block goes in under these locks: a send or an invitation holding them has already decided, and the next one will see the block.
    await lockPair(tx, tenantId, me, target.id);
    // Mentorship and referral requests between them, which take the pair's lock too: this member's to them are withdrawn
    // and theirs to this member suppressed, silently, so answering one can never meet the block. Before the conversation, as
    // accepting does.
    await publishBlockOnMentorships(ctx, tx, slug, me, await applyBlockToMentorships(tx, tenantId, me, target.id, new Date()));
    await publishBlockOnReferrals(ctx, tx, slug, me, await applyBlockToReferrals(tx, tenantId, me, target.id, new Date()));
    const conversation = await lockDirectConversation(tx, tenantId, me, target.id);
    if (!(await insertBlock(tx, { tenantId, blockerMembershipId: me, blockedMembershipId: target.id }))) return;
    // Their invitations waiting for this member go out of sight, and look to them as they did.
    for (const groupId of await suppressInvitesFrom(tx, me, target.id)) await publishChangedTo(ctx, tx, slug, groupId, [me]);
    // And this member's to them, as withdrawn, without a word to them.
    await suppressInvitesFrom(tx, target.id, me);
    await tellAboutSharedGroups(ctx, tx, slug, me, target.id);
    if (!conversation) return;
    const mine = await findParticipant(tx, conversation.id, me);
    await updateParticipant(tx, conversation.id, me, { frozenSortAt: mine?.frozenSortAt ?? conversation.lastMessageAt });
    if (conversation.directState === "PENDING" && conversation.requesterMembershipId !== me) await updateConversation(tx, conversation.id, { directState: "DECLINED" });
    await publishChanged(ctx, tx, slug, conversation.id, { onlyMembershipId: me });
  });
  await emitUnread(ctx, tenantCtx, actor);
  return toChatBlockDto((await findBlock(ctx.db, me, target.id))!, target);
}

/**
 * Lifts a block. In a direct thread everything so far is marked read, because what was withheld stays hidden for good. The
 * thread stays where it was in their list until the next message they can see, or its time would show when a withheld
 * message was sent. A request the block declined stays declined, and the member asks again in the usual way. In a group,
 * their messages show again, because there they were only ever redacted, never withheld.
 */
export async function unblockMember(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, membershipId: string): Promise<void> {
  const me = actor.membership.id;
  const tenantId = tenantCtx.tenant.id;
  const slug = tenantCtx.tenant.slug;
  const target = await findMembershipById(ctx.db, tenantId, membershipId);
  if (!target) throw AppError.notFound("Member not found");
  await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    // Under the same locks as blocking and sending, or this could miss a first message that has seen the block and not yet committed.
    await lockPair(tx, tenantId, me, target.id);
    const conversation = await lockDirectConversation(tx, tenantId, me, target.id);
    if (!(await deleteBlock(tx, me, target.id))) return;
    await tellAboutSharedGroups(ctx, tx, slug, me, target.id);
    if (!conversation) return;
    await updateParticipant(tx, conversation.id, me, { lastReadSeq: conversation.lastSeq });
    await publishChanged(ctx, tx, slug, conversation.id, { onlyMembershipId: me });
  });
  await emitUnread(ctx, tenantCtx, actor);
}

export async function listMyBlocks(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, query: CursorQuery): Promise<CursorPage<ChatBlockDto>> {
  const page = await listBlocks(ctx.db, tenantCtx.tenant.id, actor.membership.id, query);
  return { data: page.data.map((r) => toChatBlockDto(r.block, r.member)), nextCursor: page.nextCursor };
}
