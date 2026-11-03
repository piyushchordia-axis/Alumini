import { MENTORSHIP_NOTE_MAX_LENGTH, memberRoleLine, mentorshipNoteHelp, mentorshipNoteSchema } from "@illuminize/shared";
import { errorMessage, fatalQueryError, isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatHeader, ChatScreen } from "@/components/chat/ChatFrame";
import { MentorAction, useMentor } from "@/components/mentors/MentorAction";
import { MentorAreas } from "@/components/mentors/MentorCards";
import { MentorsOff, MentorUnavailable, mentorUnavailableText, useMentorsEnabled } from "@/components/mentors/MentorFrame";
import { Avatar, Button, ErrorText, Input, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { leaveGroupNotice } from "@/lib/groups";
import { mentorsHref, refreshMentorship } from "@/lib/mentors";
import { colors, radius, spacing } from "@/theme";

const TITLE = "Request mentorship";

export default function MentorRequestScreen() {
  const enabled = useMentorsEnabled();
  const { membershipId = "" } = useLocalSearchParams<{ membershipId: string }>();
  if (!enabled) return <MentorsOff title={TITLE} />;
  // Keyed, so a note written to one mentor is never sent to another.
  return <MentorRequest key={membershipId} id={membershipId} />;
}

/**
 * Request mentorship: a note, said up front to be what the mentor reads and, if they accept, the chat's first message. A
 * refetch of the mentor failing in the background keeps the form and the note, and so does one the API refuses once the form
 * is up (the mentor stopped, say): it says so above the note, which stays there to copy, and nothing can be sent.
 */
function MentorRequest({ id }: { id: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useMentor(slug, id);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const error = fatalQueryError(query);
  if (error && !query.data) return <MentorUnavailable header={TITLE} error={error} onRetry={() => void query.refetch()} />;
  if (!query.data)
    return (
      <ChatScreen>
        <ChatHeader title={TITLE} />
        <Spinner label="Loading mentor…" />
      </ChatScreen>
    );
  const m = query.data;
  const name = m.member.fullName;
  const refused = error ? mentorUnavailableText(error) : null;
  if (m.isMe) return <MentorUnavailable header={TITLE} title="You can't ask yourself" text="This is your own mentor profile." />;

  const submit = async () => {
    if (refused) return;
    setServerError(null);
    const parsed = mentorshipNoteSchema.safeParse(note);
    if (!parsed.success) {
      setNoteError(parsed.error.issues[0]?.message);
      return;
    }
    setNoteError(undefined);
    setBusy(true);
    try {
      await api.mentorship.request(slug, { mentorMembershipId: m.member.id, note: parsed.data });
      void refreshMentorship(qc, slug);
      leaveGroupNotice("mentors", "Request sent");
      // Down to Requests under this screen, so going back from there never lands on a form that would ask again.
      router.dismissTo(mentorsHref(slug, "requests", "sent"));
    } catch (err) {
      const fieldError = isApiClientError(err) ? err.fieldErrors.note : undefined;
      if (fieldError) setNoteError(fieldError);
      else setServerError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <ChatScreen>
      <ChatHeader title={TITLE} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl + insets.bottom, gap: spacing.lg }}>
        <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
            <Avatar name={name} src={m.member.avatarUrl} size={44} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>{name}</Text>
              <Text style={{ fontSize: 13, color: "#475569" }}>{memberRoleLine(m.member)}</Text>
            </View>
          </View>
          <MentorAreas areas={m.areas} />
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.md }}>
            {m.myRequest ? (
              // Asked already, perhaps on another device: one open request per mentor, so there's nothing to send.
              <MentorAction slug={slug} mentor={m} />
            ) : (
              <>
                {refused && (
                  <View role="alert" style={{ borderRadius: radius.md, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", padding: spacing.md, gap: 2 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: "#78350f" }}>{refused.heading}</Text>
                    <Text style={{ fontSize: 14, color: "#78350f" }}>{`${refused.body} Your note is still below, so you can copy it.`}</Text>
                  </View>
                )}
                <View style={{ gap: 4 }}>
                  {/* Off, so the web build's browser doesn't keep what's written here for session restore, where it would outlast sign-out. */}
                  <Input
                    label="Note to the mentor *"
                    accessibilityLabel="Note to the mentor"
                    accessibilityHint={mentorshipNoteHelp(name)}
                    value={note}
                    onChangeText={setNote}
                    multiline
                    maxLength={MENTORSHIP_NOTE_MAX_LENGTH}
                    autoComplete="off"
                    placeholder="Say who you are, what you'd like help with, and why you're asking them."
                    style={[{ minHeight: 140 }, noteError ? { borderColor: colors.danger } : null]}
                  />
                  {/* Laid out here rather than as the field's hint, so the help and the count stay in view beside an error. */}
                  {noteError ? (
                    <Text role="alert" style={{ fontSize: 12, color: colors.danger }}>
                      {noteError}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                    <Text style={{ flex: 1, fontSize: 12, color: colors.muted }}>{mentorshipNoteHelp(name)}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, fontVariant: ["tabular-nums"] }}>
                      {note.length} / {MENTORSHIP_NOTE_MAX_LENGTH}
                    </Text>
                  </View>
                </View>
                <ErrorText error={serverError} />
                <Button title="Send request" loading={busy} disabled={!!refused} onPress={() => void submit()} />
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </ChatScreen>
  );
}
