import { REFERRAL_NOT_TAKING, REFERRAL_NOTE_MAX_LENGTH, REFERRAL_NOTE_PLACEHOLDER, memberRoleLine, myReferralText, referralAskRefusalText, referralNoteHelp, referralNoteSchema, takesReferralRequests } from "@illuminize/shared";
import { errorMessage, fatalQueryError, isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { JobUnavailable, ReferralsUnavailable, jobUnavailableText } from "@/components/jobs/JobUnavailable";
import { Avatar, Button, ErrorText, Input, Spinner } from "@/components/ui";
import { useJob } from "@/hooks/useJob";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { leaveGroupNotice } from "@/lib/groups";
import { jobsHref, refreshReferrals, useReferralsAvailable } from "@/lib/referrals";
import { colors, radius, spacing } from "@/theme";

export default function ReferralRequestScreen() {
  const available = useReferralsAvailable();
  const { jobId = "" } = useLocalSearchParams<{ jobId: string }>();
  // Makes no calls while referrals are off for this member.
  if (!available) return <ReferralsUnavailable />;
  // Keyed, so a note written about one job is never sent about another.
  return <ReferralRequest key={jobId} jobId={jobId} />;
}

/**
 * Ask for a referral: a note, said up front to be what the poster reads and, if they accept, the chat's first message. A
 * refetch of the job failing in the background keeps the form and the note, and so does one that shows the job no longer
 * takes requests once something is written: it says so above the note, which stays there to copy, and nothing can be sent.
 */
function ReferralRequest({ jobId }: { jobId: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const query = useJob(slug, jobId);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  const error = fatalQueryError(query);
  if (error && !query.data) return <JobUnavailable error={error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Spinner label="Loading job…" />;
  const j = query.data;
  const poster = j.author.fullName;
  if (j.isMine) return <JobUnavailable title="You can't ask yourself" text="This is your own job. Members ask you for referrals on its page." />;
  // Asked already, perhaps on another device: one request at a time about a job, and a decline is final.
  const standing = j.myReferral && j.myReferral.status !== "WITHDRAWN" && j.myReferral.status !== "CLOSED" ? j.myReferral : null;
  // Then what of the member's own stands in the way: asked as many times as they can, or a block they made.
  const refused = error ? jobUnavailableText(error) : !takesReferralRequests(j, now) ? REFERRAL_NOT_TAKING : j.referralAskRefusal ? referralAskRefusalText(j.referralAskRefusal, poster) : null;
  // With nothing written yet there's nothing to keep, so a job that takes no requests just says so.
  if (refused && !standing && note === "") return <JobUnavailable title={refused.heading} text={refused.body} />;

  const submit = async () => {
    if (refused) return;
    setServerError(null);
    const parsed = referralNoteSchema.safeParse(note);
    if (!parsed.success) {
      setNoteError(parsed.error.issues[0]?.message);
      return;
    }
    setNoteError(undefined);
    setBusy(true);
    try {
      await api.jobs.referrals.request(slug, j.id, { note: parsed.data });
      void refreshReferrals(qc, slug);
      leaveGroupNotice("jobs", "Request sent");
      // Down to Referrals at the bottom of this stack, so going back from there never lands on a form that would ask again.
      router.dismissTo(jobsHref(slug, "referrals", "sent"));
    } catch (err) {
      const fieldError = isApiClientError(err) ? err.fieldErrors.note : undefined;
      if (fieldError) setNoteError(fieldError);
      else setServerError(errorMessage(err));
      setBusy(false);
      // The job may have closed, or the poster answered an earlier request: the form says so once it's read again.
      void query.refetch();
    }
  };

  return (
    // As the mentorship request form does, on both platforms: the form shrinks above the keyboard whether or not Android
    // resizes the window for it, so the help, the count and Send request can be scrolled to while typing. The screen starts
    // under the native header, which the keyboard's overlap is measured past.
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48, gap: spacing.lg }}>
        <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md }}>
          <View style={{ gap: 2 }}>
            <Text role="heading" style={{ fontSize: 17, fontWeight: "700", color: colors.text }}>
              {j.title}
            </Text>
            <Text style={{ fontSize: 14, color: "#475569" }}>
              {j.companyName}
              {j.location ? ` · ${j.location}` : ""}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Avatar name={poster} src={j.author.avatarUrl} size={40} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>Posted by {poster}</Text>
              <Text style={{ fontSize: 13, color: "#475569" }}>{memberRoleLine(j.author)}</Text>
            </View>
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.md }}>
            {standing ? (
              <>
                <Text style={{ fontSize: 14, color: "#475569" }}>{myReferralText(standing.status, poster)}</Text>
                <Button title="See your requests" variant="outline" accessibilityRole="link" onPress={() => router.dismissTo(jobsHref(slug, "referrals", "sent"))} />
              </>
            ) : (
              <>
                {refused && (
                  <View role="alert" style={{ borderRadius: radius.md, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", padding: spacing.md, gap: 2 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: "#78350f" }}>{refused.heading}</Text>
                    <Text style={{ fontSize: 14, color: "#78350f" }}>{`${refused.body} Your note is still below, so you can copy it.`}</Text>
                  </View>
                )}
                <View style={{ gap: 4 }}>
                  {/* The asterisk is for the eye: the box's name is the label alone, as on the web app. Off, so the web build's
                      browser doesn't keep what's written here for session restore, where it would outlast sign-out. */}
                  <Input
                    label="Note to the poster *"
                    accessibilityLabel="Note to the poster"
                    accessibilityHint={referralNoteHelp(poster)}
                    value={note}
                    onChangeText={setNote}
                    multiline
                    maxLength={REFERRAL_NOTE_MAX_LENGTH}
                    autoComplete="off"
                    placeholder={REFERRAL_NOTE_PLACEHOLDER}
                    style={[{ minHeight: 140 }, noteError ? { borderColor: colors.danger } : null]}
                  />
                  {/* Laid out here rather than as the field's hint, so the help and the count stay in view beside an error. */}
                  {noteError ? (
                    <Text role="alert" style={{ fontSize: 12, color: colors.danger }}>
                      {noteError}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                    <Text style={{ flex: 1, fontSize: 12, color: colors.muted }}>{referralNoteHelp(poster)}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, fontVariant: ["tabular-nums"] }}>
                      {note.length} / {REFERRAL_NOTE_MAX_LENGTH}
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
    </KeyboardAvoidingView>
  );
}
