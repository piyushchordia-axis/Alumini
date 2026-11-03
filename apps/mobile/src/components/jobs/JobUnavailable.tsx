import { errorMessage, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { ChatNotice } from "@/components/chat/ChatFrame";
import { Button } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { jobsHref } from "@/lib/referrals";
import { colors } from "@/theme";

/** Why a job can't be shown, in plain words. A job removed, hidden or deleted and a wrong link read the same, as the API answers them. */
export function jobUnavailableText(error?: unknown): { heading: string; body: string } {
  const answered = isApiClientError(error) && !isTransientError(error);
  const off = isApiClientError(error) && error.code === "FEATURE_DISABLED";
  return {
    heading: off ? "Jobs aren't available" : answered || !error ? "This job isn't available" : "This job couldn't be opened",
    body: off ? errorMessage(error) : answered || !error ? "It may have been closed or removed, or the link may be wrong." : "Check your connection, then try again.",
  };
}

/** Down to the Jobs list under this screen, rather than a second copy of it on top. */
function BackToJobs() {
  const { tenant } = useMembership();
  const router = useRouter();
  return <Button title="Back to jobs" accessibilityRole="link" onPress={() => router.dismissTo(jobsHref(tenant.slug))} />;
}

/** A job that can't be shown, or a referral that can't be asked for, says why in plain words and offers a way back, and never blanks the app. */
export function JobUnavailable({ error, title, text, onRetry }: { error?: unknown; title?: string; text?: string; onRetry?: () => void }) {
  const answered = isApiClientError(error) && !isTransientError(error);
  const said = jobUnavailableText(error);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ChatNotice icon="💼" title={title ?? said.heading} text={text ?? said.body}>
        {error !== undefined && !answered && onRetry && <Button title="Retry loading" variant="outline" onPress={onRetry} />}
        <BackToJobs />
      </ChatNotice>
    </View>
  );
}

/** What a referral screen says to a member who can't use referrals now and has nothing there to leave. */
export function ReferralsUnavailable({ onBack }: { /** In place of going back down the stack, on the Jobs screen itself. */ onBack?: () => void }) {
  const { tenant } = useMembership();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ChatNotice icon="🔒" title="Referrals aren't available" text={`Referral requests aren't open to your account at ${tenant.shortName ?? tenant.name}.`}>
        {onBack ? <Button title="Back to jobs" accessibilityRole="link" onPress={onBack} /> : <BackToJobs />}
      </ChatNotice>
    </View>
  );
}
