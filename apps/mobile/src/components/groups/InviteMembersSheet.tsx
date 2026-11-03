import { CHAT_GROUP_INVITES_PER_CALL, type ChatGroupDto, type ChatMemberDto } from "@illuminize/shared";
import { chatKeys } from "@illuminize/shared/chat";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet } from "@/components/chat/ChatFrame";
import { Avatar, Button, ErrorText, Input, Spinner } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { api } from "@/lib/api";
import { refreshGroup } from "@/lib/groups";
import { colors, radius, spacing, useTheme } from "@/theme";

function Candidate({ member, on, disabled, onPress }: { member: ChatMemberDto; on: boolean; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      // Just the name: the avatar's initials would only repeat it.
      accessibilityLabel={member.fullName}
      aria-checked={on}
      aria-disabled={disabled}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, opacity: disabled ? 0.5 : 1, backgroundColor: pressed ? colors.bg : colors.card })}
    >
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? theme.primary : colors.faint, backgroundColor: on ? theme.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
        {on && <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>✓</Text>}
      </View>
      <Avatar name={member.fullName} src={member.avatarUrl} size={32} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: colors.text }}>
        {member.fullName}
      </Text>
    </Pressable>
  );
}

/**
 * Invite members, by searching for them. The list leaves out anyone already in the group or invited, and anyone this member
 * blocked. What the inviter is told afterwards is the same whether or not each invitation reaches its invitee.
 */
export function InviteMembersSheet({
  slug,
  group,
  open,
  onClose,
  onDone,
  directoryOn,
}: {
  slug: string;
  group: ChatGroupDto;
  open: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
  directoryOn: boolean;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const [chosen, setChosen] = useState<Map<string, ChatMemberDto>>(() => new Map());
  const candidates = useQuery({
    queryKey: chatKeys.groupCandidates(slug, group.id, search),
    queryFn: () => api.chat.groups.inviteCandidates(slug, group.id, { q: search || undefined, limit: 20 }),
    enabled: open,
  });
  const full = chosen.size >= CHAT_GROUP_INVITES_PER_CALL;

  const reset = () => {
    setQ("");
    setChosen(new Map());
  };
  const invite = useMutation({
    mutationFn: () => api.chat.groups.invite(slug, group.id, [...chosen.keys()]),
    onSuccess: ({ invited }) => {
      void refreshGroup(qc, slug);
      reset();
      onClose();
      onDone(invited === 0 ? "They're already in the group" : invited === 1 ? "Invitation sent" : `${invited} invitations sent`);
    },
  });
  const close = () => {
    if (invite.isPending) return;
    reset();
    invite.reset();
    onClose();
  };
  const toggle = (m: ChatMemberDto) =>
    setChosen((old) => {
      const next = new Map(old);
      if (next.has(m.id)) next.delete(m.id);
      else if (next.size < CHAT_GROUP_INVITES_PER_CALL) next.set(m.id, m);
      return next;
    });

  const list = candidates.data ?? [];
  return (
    <Sheet open={open} title="Invite members" onClose={close}>
      <Text style={{ fontSize: 14, color: colors.muted }}>
        {group.visibility === "OPEN" ? "They'll find the invitation in Groups. Anyone can also join an open group from Discover." : "They'll find the invitation in Groups. New members see messages from when they join."}
      </Text>
      <Input accessibilityLabel="Search members" placeholder="Search by name" value={q} onChangeText={setQ} autoCorrect={false} autoComplete="off" />
      {chosen.size > 0 && (
        <View role="group" aria-label="Chosen" style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {[...chosen.values()].map((m) => (
            <Pressable
              key={m.id}
              onPress={() => toggle(m)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${m.fullName}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, borderRadius: radius.full, paddingHorizontal: spacing.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}
            >
              <Text numberOfLines={1} style={{ maxWidth: 180, fontSize: 13, color: colors.text }}>
                {m.fullName}
              </Text>
              <Text accessible={false} style={{ fontSize: 12, color: colors.muted }}>
                ✕
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {full && <Text style={{ fontSize: 12, color: colors.muted }}>You can invite up to {CHAT_GROUP_INVITES_PER_CALL} people at a time.</Text>}
      {candidates.isLoading ? (
        <Spinner label="Finding members…" />
      ) : candidates.error && list.length === 0 ? (
        <View style={{ gap: spacing.sm }}>
          <ErrorText error={candidates.error} />
          <Button title="Retry loading" variant="outline" onPress={() => void candidates.refetch()} />
        </View>
      ) : list.length === 0 ? (
        <Text style={{ textAlign: "center", fontSize: 14, color: colors.muted, paddingVertical: spacing.lg }}>{search ? "No one to invite matches that name." : "There's no one else to invite right now."}</Text>
      ) : (
        // A plain list, not a FlatList: it sits in the sheet's own scroll view, and holds 20 at most.
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" }}>
          {list.map((m, i) => {
            const on = chosen.has(m.id);
            return (
              <View key={m.id} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
                <Candidate member={m} on={on} disabled={!on && full} onPress={() => toggle(m)} />
              </View>
            );
          })}
        </View>
      )}
      {!directoryOn && (
        // The API offers nobody else with the directory off, so say why the list is short.
        <Text style={{ fontSize: 12, color: colors.muted }}>The member directory is switched off here, so you can invite people you already chat with or share a group with.</Text>
      )}
      <ErrorText error={invite.error} />
      <Button title={chosen.size > 1 ? `Send ${chosen.size} invitations` : "Send invitation"} loading={invite.isPending} disabled={chosen.size === 0} onPress={() => invite.mutate()} />
      <Button title="Cancel" variant="ghost" disabled={invite.isPending} onPress={close} />
    </Sheet>
  );
}
