import { MEMBER_ACTION_COPY, memberActionLabel, memberStatusNowText, type NotificationSubjectDto } from "@illuminize/shared";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MemberReasonSheet } from "@/components/admin/MemberActionButtons";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Button } from "@/components/ui";
import type { MemberActionOutcome, MemberActions, MemberRef } from "@/hooks/useMemberActions";
import { colors, spacing } from "@/theme";

/**
 * Approve and Reject on a new-member notice while the request still waits, and otherwise where it stands now. Approve
 * asks first, unlike the members list's, as a notice is easily tapped while scrolling the bell; Reject asks for the
 * reason. Both send PENDING, so a notice left open can't overturn what another admin decided: the hook says so instead.
 */
export function MemberRequestActions({ subject, actions }: { subject: NotificationSubjectDto; actions: MemberActions }) {
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Where the request stood when last drawn. Once a refetch shows it has moved on (another admin decided, or the applicant
  // left), an open question closes, said as the API's refusal would be, and doesn't open again by itself should the
  // applicant apply again. Not while this admin's own answer is on its way: the hook says how that went.
  const [shown, setShown] = useState(subject.status);
  const [overtaken, setOvertaken] = useState<MemberActionOutcome | null>(null);
  if (shown !== subject.status) {
    setShown(subject.status);
    if (asking && subject.status !== "PENDING" && !actions.busyAction(subject.membershipId)) {
      setOvertaken({ id: subject.membershipId, text: memberStatusNowText(subject.status, subject.fullName), tone: "warning" });
    }
    setAsking(null);
    setError(null);
  }
  const { say } = actions;
  useEffect(() => {
    if (overtaken) say(overtaken);
  }, [overtaken, say]);
  if (subject.status === null) return <Text style={styles.gone}>No longer waiting</Text>;
  if (subject.status !== "PENDING") {
    return (
      <View style={styles.badge}>
        <MemberStatusBadge status={subject.status} />
      </View>
    );
  }
  const member: MemberRef = { id: subject.membershipId, fullName: subject.fullName, status: "PENDING" };
  const busy = actions.busyAction(member.id);
  const closeApprove = () => {
    setAsking(null);
    setError(null);
  };
  const approve = async () => {
    setError(null);
    try {
      // Resolves once approved, or once refused as out of date, which the hook has said: either way the question is gone.
      await actions.run("approve", member);
      setAsking(null);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <View style={styles.actions}>
      <Button
        size="compact"
        title={MEMBER_ACTION_COPY.approve.label}
        accessibilityLabel={memberActionLabel("approve", member.fullName)}
        loading={busy === "approve"}
        disabled={!!busy && busy !== "approve"}
        style={styles.button}
        onPress={() => {
          setError(null);
          setAsking("approve");
        }}
      />
      <Button
        size="compact"
        variant="outline"
        title={MEMBER_ACTION_COPY.reject.label}
        accessibilityLabel={memberActionLabel("reject", member.fullName)}
        loading={busy === "reject"}
        disabled={!!busy && busy !== "reject"}
        style={styles.button}
        onPress={() => setAsking("reject")}
      />
      <ConfirmSheet
        open={asking === "approve"}
        title={`Approve ${member.fullName ?? "this request"}?`}
        body="They're told they're in and can sign in straight away."
        confirmLabel={MEMBER_ACTION_COPY.approve.label}
        busy={busy === "approve"}
        error={error}
        onConfirm={() => void approve()}
        onCancel={closeApprove}
      />
      <MemberReasonSheet action="reject" member={member} actions={actions} open={asking === "reject"} onClose={() => setAsking(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  button: { minWidth: 96 },
  badge: { flexDirection: "row" },
  gone: { fontSize: 13, color: colors.muted },
});
