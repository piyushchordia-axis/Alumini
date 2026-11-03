import { mentorshipAvailable } from "@illuminize/shared";
import { errorMessage, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { useRouter } from "expo-router";
import { ChatHeader, ChatNotice, ChatScreen, useLeaveChatScreen } from "@/components/chat/ChatFrame";
import { Button } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { mentorsHref } from "@/lib/mentors";

/** Mentorship is switched on here, with messaging, and this member isn't a current pupil. */
export function useMentorsEnabled(): boolean {
  const { tenant, membership } = useMembership();
  return mentorshipAvailable(tenant.settings.features, membership.chatEligible);
}

/**
 * Mentorship is off, or this member is a current pupil. A mentor's page and the request form check this themselves, because
 * they sit above the tabs, and make no calls when it's shown.
 */
export function MentorsOff({ title = "Mentors" }: { title?: string }) {
  const { tenant } = useMembership();
  const leave = useLeaveChatScreen();
  return (
    <ChatScreen>
      <ChatHeader title={title} />
      <ChatNotice icon="🔒" title="Mentors aren't available" text={`Mentorship isn't open to your account at ${tenant.shortName ?? tenant.name}.`}>
        <Button title="Go back" onPress={leave} />
      </ChatNotice>
    </ChatScreen>
  );
}

/** Why a mentor can't be shown, in plain words. One who stopped mentoring, one the viewer blocked and a wrong link read the same, as the API answers them. */
export function mentorUnavailableText(error?: unknown): { heading: string; body: string } {
  const answered = isApiClientError(error) && !isTransientError(error);
  const off = isApiClientError(error) && error.code === "FEATURE_DISABLED";
  return {
    heading: off ? "Mentors aren't available" : answered || !error ? "This mentor isn't available" : "This mentor couldn't be opened",
    body: off ? errorMessage(error) : answered || !error ? "They may have stopped mentoring, or the link may be wrong." : "Check your connection, then try again.",
  };
}

/** A mentor who can't be shown says why in plain words and offers a way back, and never blanks the app. */
export function MentorUnavailable({ header, error, title, text, onRetry }: { header: string; error?: unknown; title?: string; text?: string; onRetry?: () => void }) {
  const { tenant } = useMembership();
  const router = useRouter();
  const answered = isApiClientError(error) && !isTransientError(error);
  const said = mentorUnavailableText(error);
  const heading = title ?? said.heading;
  const body = text ?? said.body;
  return (
    <ChatScreen>
      <ChatHeader title={header} />
      <ChatNotice icon="🧭" title={heading} text={body}>
        {error !== undefined && !answered && onRetry && <Button title="Retry loading" variant="outline" onPress={onRetry} />}
        {/* Down to the Mentors tab under this screen, rather than a second copy of it on top. */}
        <Button title="Back to mentors" accessibilityRole="link" onPress={() => router.dismissTo(mentorsHref(tenant.slug))} />
      </ChatNotice>
    </ChatScreen>
  );
}
