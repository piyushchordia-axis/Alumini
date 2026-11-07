import { memberYearsLine } from "@illuminize/shared";
import { chatKeys, firstMessageNotice, newClientKey, sendLimitNotice, unsentRemainder } from "@illuminize/shared/chat";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatNotice, ChatPane, ChatPaneHeader } from "@/components/chat/ChatPane";
import { FirstMessageNote } from "@/components/chat/RequestNotes";
import { IconLock, IconMessages } from "@/components/icons";
import { Loading } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { draftKey, useChatStore } from "@/stores/chatStore";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Writing to a member with no thread yet. Nothing exists until the first message goes, which opens the conversation as a
 * request, and the screen then becomes that thread. A thread the member already has opens instead.
 */
export function NewConversationPage() {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const [params] = useSearchParams();
  const to = params.get("to") ?? "";
  const valid = UUID.test(to) && to !== membership.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const inbox = `/t/${slug}/app/messages`;

  const profile = useQuery({ queryKey: qk.member(slug, to), queryFn: () => api.directory.profile(slug, to), enabled: valid && tenant.settings.features.directory });
  const existing = useQuery({ queryKey: chatKeys.direct(slug, to), queryFn: () => api.chat.directThread(slug, to), enabled: valid && tenant.settings.features.messaging });

  const dk = draftKey(slug, `new:${to}`);
  const setDraft = useChatStore((s) => s.setDraft);
  // Made at the first attempt and kept for every retry, so a send whose answer was lost can't arrive twice.
  const clientKey = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noteId = useId();
  // A send can answer after the member has gone elsewhere, and must not drag them back.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const existingId = existing.data?.conversationId;
  if (existingId) return <Navigate to={`${inbox}/${existingId}`} replace />;

  // Messages can be open for groups alone, with direct messages off: then there's nobody to write to here.
  const directOff = !tenant.settings.features.messaging;
  const unavailable = directOff || !valid || profile.data?.canMessage === false || (profile.error && isApiClientError(profile.error) && profile.error.status === 404);
  if (unavailable) {
    return (
      <ChatPane>
        {() => (
          <>
            <ChatPaneHeader backTo={inbox} title="New message" />
            <ChatNotice
              icon={directOff ? <IconLock /> : <IconMessages />}
              title={directOff ? "Private messages aren't available" : "You can't message this member"}
              text={directOff ? `${tenant.shortName ?? tenant.name} has switched private messages off.` : "They can't be contacted here at the moment."}
            >
              <Link to={inbox} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                Back to messages
              </Link>
            </ChatNotice>
          </>
        )}
      </ChatPane>
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
      if (mounted.current) navigate(`${inbox}/${id}`, { replace: true });
    } catch (err) {
      // The words stay in the box, and the same key goes with the next try.
      setNotice(sendLimitNotice(isApiClientError(err) ? err.code : null) ?? errorMessage(err));
      setSending(false);
    }
  };

  const waiting = existing.isLoading || profile.isLoading;
  return (
    <ChatPane>
      {(keyboardOpen) => (
        <>
          <ChatPaneHeader backTo={inbox} title={profile.data?.fullName ?? "New message"} member={profile.data} profileHref={profile.data ? `/t/${slug}/app/directory/${to}` : null} subtitle={memberYearsLine(profile.data ?? {}, "New conversation")} />
          {waiting ? (
            <div className="flex-1">
              <Loading />
            </div>
          ) : (
            // Centred by its own auto margins, not justify-center, so a phone's keyboard shrinking the pane scrolls it rather than cutting its top off.
            <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6">
              <FirstMessageNote id={noteId} notice={firstMessageNotice(profile.data?.fullName)} className="my-auto" />
            </div>
          )}
          {!waiting && <ChatComposer draftKey={dk} onSend={(text) => void send(text)} sending={sending} notice={notice} describedBy={noteId} keyboardOpen={keyboardOpen} autoFocus />}
        </>
      )}
    </ChatPane>
  );
}
