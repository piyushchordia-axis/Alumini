-- Who a group's owner removed, kept apart from the participant's state, which an invitation overwrites: only accepting an
-- invitation they could see lets them back in (see wasRemoved in services/chat/common.ts).
ALTER TABLE "chat_participants" ADD COLUMN "removed_at" timestamp (3) with time zone;
