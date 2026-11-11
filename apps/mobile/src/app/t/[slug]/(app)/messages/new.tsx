import { memberYearsLine } from "@illuminize/shared";
import { chatKeys, composerAttachCaption, firstMessageNotice, newClientKey, sendLimitNotice, unsentRemainder } from "@illuminize/shared/chat";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatHeader, ChatNotice, ChatOff, ChatScreen, useLeaveChatScreen } from "@/components/chat/ChatFrame";
import { FirstMessageNote } from "@/components/chat/RequestNotes";
import { IconMessages } from "@/components/icons";
import { Button, PageSkeleton } from "@/components/ui";
import { useChatEnabled } from "@/hooks/useChat";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { draftKey, useChatStore } from "@/stores/chatStore";
import { spacing } from "@/theme";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function NewConversationScreen() {
  const enabled = useChatEnabled();
  const { tenant } = useMembership();
  const { to = "" } = useLocalSearchParams<{ to?: string }>();
  // Messages can be open for groups alone, with direct messages off: then there's nobody to write to here.
  if (!enabled || !tenant.settings.features.messaging) return <ChatOff />;
  return <NewConversation key={to} to={to} />;
}

/**
 * Writing to a member with no thread yet. Nothing exists until the first message goes, which opens the conversation as a
 * request, and the screen then becomes that thread. A thread the member already has opens instead.
 */
function NewConversation({ to }: { to: string }) {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const valid = UUID.test(to) && to !== membership.id;
  const qc = useQueryClient();
  const router = useRouter();
  const leave = useLeaveChatScreen();

  const profile = useQuery({ queryKey: qk.member(slug, to), queryFn: () => api.directory.profile(slug, to), enabled: valid && tenant.settings.features.directory });
  const existing = useQuery({ queryKey: chatKeys.direct(slug, to), queryFn: () => api.chat.directThread(slug, to), enabled: valid });

  const dk = draftKey(slug, `new:${to}`);
  const setDraft = useChatStore((s) => s.setDraft);
  // Made at the first attempt and kept for every retry, so a send whose answer was lost can't arrive twice.
  const clientKey = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A send can answer after the member has gone back or elsewhere. Replacing then would swap out whatever screen is on top.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

  const existingId = existing.data?.conversationId;
  if (existingId) return <Redirect href={`/t/${slug}/messages/${existingId}`} />;

  const unavailable = !valid || profile.data?.canMessage === false || (isApiClientError(profile.error) && profile.error.status === 404);
  if (unavailable) {
    return (
      <ChatScreen>
        <ChatHeader title="New message" />
        <ChatNotice icon={<IconMessages />} title="You can't message this member" text="They can't be contacted here at the moment.">
          <Button title="Go back" onPress={leave} />
        </ChatNotice>
      </ChatScreen>
    );
  }

  const send = async (text: string) => {
    setSending(true);
    setNotice(null);
    clientKey.current ??= newClientKey();
    try {
      const result = await api.chat.direct(slug, { membershipId: to, body: text, clientKey: clientKey.current });
      const id = result.conversation.id;
      qc.setQueryData(chatKeys.conversation(slug, id), result.conversation);
      void qc.invalidateQueries({ queryKey: chatKeys.direct(slug, to) });
      void qc.invalidateQueries({ queryKey: chatKeys.lists(slug) });
      // Anything typed while it was sending goes with them into the thread, rather than being cleared with what went.
      const rest = unsentRemainder(useChatStore.getState().drafts[dk] ?? "", text);
      setDraft(dk, "");
      if (rest) setDraft(draftKey(slug, id), rest);
      if (focused.current) router.replace(`/t/${slug}/messages/${id}`);
    } catch (err) {
      // The words stay in the box, and the same key goes with the next try.
      setNotice(sendLimitNotice(isApiClientError(err) ? err.code : null) ?? errorMessage(err));
      setSending(false);
    }
  };

  const waiting = existing.isLoading || profile.isLoading;
  return (
    <ChatScreen>
      <ChatHeader title={profile.data?.fullName ?? "New message"} member={profile.data ?? undefined} subtitle={memberYearsLine(profile.data ?? {}, "New conversation")} />
      {waiting ? (
        <View style={{ flex: 1 }}>
          <PageSkeleton shape="thread" />
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl }}>
          <FirstMessageNote notice={firstMessageNotice(profile.data?.fullName)} />
        </ScrollView>
      )}
      {!waiting && (
        <ChatComposer
          draftKey={dk}
          onSend={(text) => void send(text)}
          sending={sending}
          notice={notice}
          // A first message goes as a request, which carries words only.
          attachCaption={composerAttachCaption(null, tenant.settings.features, profile.data?.fullName)}
        />
      )}
    </ChatScreen>
  );
}
