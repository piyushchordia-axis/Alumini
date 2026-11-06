import { MENTOR_REMOVE_CONFIRM, mentorListedText, mentorProfileRows, mentorshipKeys, roleChangeCopy, type AdminMemberDto, type MemberFact, type MembershipRole, type MentorProfileDto } from "@illuminize/shared";
import { errorMessage, isOutOfDate } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { StatusLine } from "@/components/Sheet";
import { Badge, Button, Card, headingRole } from "@/components/ui";
import type { MemberActionOutcome } from "@/hooks/useMemberActions";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";
import { colors, spacing } from "@/theme";

/** A member's facts in two columns, each a small label over its value, selectable so a phone number can be copied. */
export function MemberFacts({ facts }: { facts: MemberFact[] }) {
  return (
    <View style={styles.facts}>
      {facts.map((f) => (
        <View key={f.label} style={styles.fact}>
          <Text style={styles.label}>{f.label}</Text>
          <Text selectable style={styles.value}>
            {f.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Make admin, or Remove admin role, asked first, for an approved member who isn't the admin themself. How it went is
 * said through `say`. An answer that says the screen was out of date (the member suspended or gone, or this admin held
 * back by a report) closes the sheet and says why; any other failure stays in it, to try again.
 */
export function RoleChangeButton({ slug, member, tenantName, say }: { slug: string; member: Pick<AdminMemberDto, "id" | "fullName" | "role">; tenantName: string; say: (outcome: MemberActionOutcome) => void }) {
  const qc = useQueryClient();
  // The role asked for, kept while the sheet is open so a refetch underneath can't turn the question round.
  const [asking, setAsking] = useState<MembershipRole | null>(null);
  const next: MembershipRole = member.role === "TENANT_ADMIN" ? "MEMBER" : "TENANT_ADMIN";
  const copy = roleChangeCopy(member.fullName, asking ?? next, tenantName);
  const change = useMutation({
    mutationFn: (role: MembershipRole) => api.admin.members.setRole(slug, member.id, role),
    // A refusal refreshes too: it usually means the screen was out of date, and the membership says if this admin still is one.
    onSettled: () => void invalidateTenant(qc, slug),
  });
  const close = () => {
    setAsking(null);
    change.reset();
  };
  const confirm = () => {
    if (!asking) return;
    change.mutate(asking, {
      onSuccess: () => {
        close();
        say({ id: member.id, text: copy.done, tone: "info" });
      },
      onError: (err) => {
        if (!isOutOfDate(err)) return;
        close();
        say({ id: member.id, text: errorMessage(err), tone: "warning" });
      },
    });
  };
  return (
    <>
      <Button
        size="compact"
        variant="ghost"
        title={copy.label}
        style={{ minWidth: 96 }}
        onPress={() => {
          change.reset();
          setAsking(next);
        }}
      />
      <ConfirmSheet open={asking !== null} title={copy.title} body={copy.body} confirmLabel={copy.confirm} destructive={copy.destructive} busy={change.isPending} error={change.error} onConfirm={confirm} onCancel={close} />
    </>
  );
}

/**
 * What the member wrote to offer mentoring. Its note can't be reported like a chat message, so it's shown here, where an
 * admin can take them out of the Mentors list, asked first.
 */
export function MentorProfileCard({ slug, membershipId, profile }: { slug: string; membershipId: string; profile: MentorProfileDto }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [said, say] = useStatus<{ text: string; tone: "info" | "warning" }>();
  const remove = useMutation({
    mutationFn: () => api.admin.mentors.remove(slug, membershipId),
    // The members list, the member's profile and the Mentors section show it too.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.member(slug, membershipId) });
      void qc.invalidateQueries({ queryKey: ["admin", slug, "members"] });
      void qc.invalidateQueries({ queryKey: qk.member(slug, membershipId) });
      void qc.invalidateQueries({ queryKey: mentorshipKeys.all(slug) });
    },
  });
  const confirm = () =>
    remove.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        say({ text: MENTOR_REMOVE_CONFIRM.done, tone: "info" });
      },
      onError: (err) => {
        if (!isOutOfDate(err)) return;
        setConfirming(false);
        remove.reset();
        say({ text: errorMessage(err), tone: "warning" });
      },
    });
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={styles.header}>
        <Text {...headingRole(2)} style={styles.heading}>
          Mentor profile
        </Text>
        <Badge label={mentorListedText(profile.isActive)} tone={profile.isActive ? "success" : "neutral"} />
      </View>
      {mentorProfileRows(profile).map((row) => (
        <View key={row.label} style={{ gap: 2 }}>
          <Text style={styles.label}>{row.label}</Text>
          <Text selectable style={styles.value}>
            {row.value}
          </Text>
        </View>
      ))}
      {profile.isActive && (
        <Button
          title={MENTOR_REMOVE_CONFIRM.confirm}
          variant="outline"
          onPress={() => {
            remove.reset();
            setConfirming(true);
          }}
        />
      )}
      <StatusLine text={said?.text ?? null} tone={said?.tone} flush />
      <ConfirmSheet
        open={confirming}
        title={MENTOR_REMOVE_CONFIRM.title}
        body={MENTOR_REMOVE_CONFIRM.body}
        confirmLabel={MENTOR_REMOVE_CONFIRM.confirm}
        destructive
        busy={remove.isPending}
        error={remove.error}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  facts: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md },
  fact: { width: "50%", paddingRight: spacing.sm, gap: 2 },
  label: { fontSize: 12, color: colors.muted },
  value: { fontSize: 14, color: colors.text },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm },
  heading: { fontSize: 15, fontWeight: "700", color: colors.text },
});
