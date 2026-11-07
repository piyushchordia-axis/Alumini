import type { AppContext } from "../../context";
import type { Tx } from "../../db/client";
import { afterCommit } from "../../lib/transaction";
import { deleteWithheldMessagesOf, limitLockWait, lockConversationsOfMembers, updateConversation } from "../../repositories/chat.repo";
import { deleteUnsentChatAttachmentsOf, withheldChatAttachmentKeysOf } from "../../repositories/chatAttachments.repo";
import { suppressInvitesBy } from "../../repositories/chatGroups.repo";
import { listMembershipsForUser } from "../../repositories/memberships.repo";
import { removeChatFiles } from "./attachments.service";
import { emitBadges } from "./chat.service";
import { chatTenantById } from "./common";
import { publishChangedTo } from "./fanout";
import { departForDeletion } from "./groups.service";

/**
 * Inside the account-deletion transaction, before the user row goes. What's left afterwards comes from the foreign keys:
 * their messages stay in other people's threads with a null sender, their side of each 1:1 goes null, leaving it read-only,
 * invitations to them go with their participant rows, and reports survive with null parties. This handles what those can't:
 * pending requests involving them are declined; they leave each group they're in, which passes on any they owned or archives
 * one nobody is left in, and keeps its member count right; invitations they sent stop showing; and their withheld messages,
 * which nobody ever received and nobody can review, are deleted outright, with their photos and files, as are uploads they
 * never sent. Those files go once this commits; what they sent stays with its message.
 */
export async function prepareChatForAccountDeletion(ctx: AppContext, tx: Tx, userId: string): Promise<void> {
  await limitLockWait(tx);
  const memberships = await listMembershipsForUser(tx, userId);
  const membershipIds = memberships.map((r) => r.membership.id);
  const membershipIn = new Map(memberships.map((r) => [r.membership.tenantId, r.membership.id]));
  // Every conversation they're in is locked here, in one order, so this can't deadlock with a send or a join.
  for (const conversation of await lockConversationsOfMembers(tx, membershipIds)) {
    if (conversation.directState === "PENDING") await updateConversation(tx, conversation.id, { directState: "DECLINED" });
    const membershipId = membershipIn.get(conversation.tenantId);
    if (conversation.kind === "GROUP" && membershipId) await departForDeletion(ctx, tx, await chatTenantById(tx, conversation.tenantId), conversation, membershipId);
  }
  // Whoever they'd invited sees the invitation go, on Groups and on the badge.
  const dropped = await suppressInvitesBy(tx, membershipIds);
  for (const tenantId of new Set(dropped.map((d) => d.tenantId))) {
    const tenant = await chatTenantById(tx, tenantId);
    const here = dropped.filter((d) => d.tenantId === tenantId);
    for (const d of here) await publishChangedTo(ctx, tx, tenant.slug, d.conversationId, [d.membershipId]);
    await emitBadges(ctx, tx, tenant, here.map((d) => d.membershipId));
  }
  // With every conversation of theirs locked, no send can claim an upload of theirs or withhold another message from under
  // this. An upload can still be saved meanwhile, so the unsent ones' keys come from the rows the delete took.
  const fileKeys = [...(await withheldChatAttachmentKeysOf(tx, membershipIds)), ...(await deleteUnsentChatAttachmentsOf(tx, membershipIds))];
  await deleteWithheldMessagesOf(tx, membershipIds);
  if (fileKeys.length > 0) await afterCommit(ctx, tx, () => removeChatFiles(ctx, fileKeys));
}
