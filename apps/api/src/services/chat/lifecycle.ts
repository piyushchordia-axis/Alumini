import type { Tx } from "../../db/client";
import { deleteWithheldMessagesOf, limitLockWait, lockConversationsOfMembers, updateConversation } from "../../repositories/chat.repo";
import { listMembershipsForUser } from "../../repositories/memberships.repo";

/**
 * Inside the account-deletion transaction, before the user row goes. What's left afterwards comes from the foreign keys:
 * their messages stay in other people's threads with a null sender, their side of each 1:1 goes null, leaving it read-only,
 * and reports survive with null parties. This handles what those can't: pending requests involving them are declined, and
 * their withheld messages, which nobody ever received and nobody can review, are deleted outright.
 */
export async function prepareChatForAccountDeletion(tx: Tx, userId: string): Promise<void> {
  await limitLockWait(tx);
  const membershipIds = (await listMembershipsForUser(tx, userId)).map((r) => r.membership.id);
  for (const conversation of await lockConversationsOfMembers(tx, membershipIds)) {
    if (conversation.directState === "PENDING") await updateConversation(tx, conversation.id, { directState: "DECLINED" });
  }
  await deleteWithheldMessagesOf(tx, membershipIds);
}
