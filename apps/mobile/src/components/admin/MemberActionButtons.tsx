import { MEMBER_ACTION_COPY, memberActionLabel, memberActionsFor, type MemberAdminAction } from "@illuminize/shared";
import { useState } from "react";
import { View } from "react-native";
import { ReasonSheet } from "@/components/admin/ReasonSheet";
import { Button } from "@/components/ui";
import type { MemberActions, MemberRef } from "@/hooks/useMemberActions";
import { spacing } from "@/theme";

/** Asks for the reason the member is told (Reject, Suspend), then acts. An out-of-date answer closes it, said by the hook. */
export function MemberReasonSheet({ action, member, actions, open, onClose }: { action: MemberAdminAction; member: MemberRef; actions: MemberActions; open: boolean; onClose: () => void }) {
  const reason = MEMBER_ACTION_COPY[action].reason;
  if (!reason) return null;
  return (
    <ReasonSheet
      open={open}
      title={reason.title(member.fullName)}
      body={reason.body}
      confirmLabel={reason.confirm}
      required
      onConfirm={(text) => actions.run(action, member, text)}
      onClose={onClose}
    />
  );
}

/**
 * What an admin can do to a member in their status, as compact buttons named with the member ("Approve Parth Joshi"), so
 * a screen reader tells one row's from the next. Approve and Reinstate act on a tap; Reject and Suspend ask for a reason.
 * `disabled` holds them all, as while the rows on screen are a previous search's.
 */
export function MemberActionButtons({ member, actions, disabled = false }: { member: MemberRef; actions: MemberActions; disabled?: boolean }) {
  const [asking, setAsking] = useState<MemberAdminAction | null>(null);
  const busy = actions.busyAction(member.id);
  const available = memberActionsFor(member.status);
  const withReason = available.find((action) => MEMBER_ACTION_COPY[action].reason);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      {available.map((action) => {
        const copy = MEMBER_ACTION_COPY[action];
        return (
          <Button
            key={action}
            size="compact"
            title={copy.label}
            accessibilityLabel={memberActionLabel(action, member.fullName)}
            variant={copy.variant}
            loading={busy === action}
            disabled={disabled || (!!busy && busy !== action)}
            style={{ minWidth: 96 }}
            onPress={() => (copy.reason ? setAsking(action) : actions.tap(action, member))}
          />
        );
      })}
      {withReason && <MemberReasonSheet action={withReason} member={member} actions={actions} open={asking === withReason} onClose={() => setAsking(null)} />}
    </View>
  );
}
