import type { PollDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { IconCheck } from "@/components/icons";
import { Button, Muted, Row } from "@/components/ui";
import { api } from "@/lib/api";
import { colors, spacing, useTheme } from "@/theme";

/** A post's poll: choose (one, or several when allowed); after voting or once closed, result bars. */
export function PollView({ slug, postId, poll, canVote }: { slug: string; postId: string; poll: PollDto; canVote: boolean }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const voted = poll.myVotes.length > 0;
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const showResults = poll.isClosed || !canVote || (voted && !changing);
  const update = (data: PollDto) => {
    qc.setQueriesData({ queryKey: ["post", slug, postId] }, (old: unknown) => (old && typeof old === "object" ? { ...old, poll: data } : old));
    void qc.invalidateQueries({ queryKey: ["posts", slug] });
  };
  const vote = useMutation({
    mutationFn: (ids: string[]) => api.posts.poll.vote(slug, postId, ids),
    onSuccess: (data) => {
      update(data);
      setChanging(false);
      setPicked([]);
    },
    onError: (e) => Alert.alert("Could not vote", errorMessage(e)),
  });
  const clear = useMutation({ mutationFn: () => api.posts.poll.clear(slug, postId), onSuccess: update, onError: (e) => Alert.alert("Could not remove vote", errorMessage(e)) });
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  return (
    <View style={{ gap: 8 }} accessibilityLabel="Poll">
      {poll.options.map((o) => {
        const mine = poll.myVotes.includes(o.id);
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        if (showResults) {
          return (
            <View key={o.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: "hidden" }} accessibilityLabel={`${o.label}, ${pct} percent${mine ? ", your vote" : ""}`}>
              <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, backgroundColor: mine ? `${theme.primary}33` : "#f1f5f9" }} />
              <Row style={{ justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 9 }}>
                <Text style={{ color: colors.text, fontWeight: mine ? "700" : "400", flexShrink: 1 }}>
                  {o.label}
                  {mine ? " ✓" : ""}
                </Text>
                <Text style={{ color: colors.muted }}>
                  {pct}% ({o.votes})
                </Text>
              </Row>
            </View>
          );
        }
        const on = picked.includes(o.id);
        return (
          <Pressable
            key={o.id}
            accessibilityRole={poll.allowsMultiple ? "checkbox" : "button"}
            aria-checked={poll.allowsMultiple ? on : undefined}
            disabled={vote.isPending}
            onPress={() => (poll.allowsMultiple ? setPicked((p) => (on ? p.filter((x) => x !== o.id) : [...p, o.id])) : vote.mutate([o.id]))}
            style={{ borderWidth: 1, borderColor: on ? theme.primary : colors.border, backgroundColor: on ? `${theme.primary}1a` : "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              {/* Only for the eye: aria-checked says whether it's chosen. */}
              {poll.allowsMultiple && (
                <View
                  aria-hidden
                  style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: on ? theme.primary : colors.faint, backgroundColor: on ? theme.primary : colors.card, alignItems: "center", justifyContent: "center" }}
                >
                  {on && <IconCheck size={12} color="#fff" strokeWidth={3} />}
                </View>
              )}
              <Text style={{ flex: 1, color: colors.text }}>{o.label}</Text>
            </View>
          </Pressable>
        );
      })}
      <Muted>
        {poll.totalVoters} vote{poll.totalVoters === 1 ? "" : "s"}
        {poll.allowsMultiple ? " · choose several" : ""}
        {poll.closesAt ? ` · ${poll.isClosed ? "closed" : "closes"} ${new Date(poll.closesAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}
      </Muted>
      {!showResults && poll.allowsMultiple && <Button title="Vote" onPress={() => vote.mutate(picked)} disabled={picked.length === 0} loading={vote.isPending} />}
      {canVote && !poll.isClosed && voted && !changing && (
        <Row>
          <Pressable onPress={() => setChanging(true)} accessibilityRole="button" hitSlop={8}>
            <Text style={{ color: theme.primary }}>Change vote</Text>
          </Pressable>
          <Pressable onPress={() => clear.mutate()} accessibilityRole="button" hitSlop={8}>
            <Text style={{ color: colors.muted }}>Remove vote</Text>
          </Pressable>
        </Row>
      )}
      {changing && (
        <Pressable onPress={() => setChanging(false)} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: colors.muted }}>Cancel</Text>
        </Pressable>
      )}
    </View>
  );
}
