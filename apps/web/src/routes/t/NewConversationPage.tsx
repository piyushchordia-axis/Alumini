import { chatKeys, newClientKey, unsentRemainder } from "@illuminize/shared/chat";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatPane, ChatPaneHeader } from "@/components/chat/ChatPane";
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
  const existing = useQuery({ queryKey: chatKeys.direct(slug, to), queryFn: () => api.chat.directThread(slug, to), enabled: valid });

  const dk = draftKey(slug, `new:${to}`);
  const setDraft = useChatStore((s) => s.setDraft);
  // Made at the first attempt and kept for every retry, so a send whose answer was lost can't arrive twice.
  const clientKey = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  const name = profile.data?.fullName ?? "this member";
  const unavailable = !valid || profile.data?.canMessage === false || (profile.error && isApiClientError(profile.error) && profile.error.status === 404);
  if (unavailable) {
    return (
      <ChatPane>
        {() => (
          <>
            <ChatPaneHeader backTo={inbox} title="New message" />
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-base font-semibold text-slate-800">You can't message this member</p>
              <p className="max-w-sm text-sm text-slate-500">They can't be contacted here at the moment.</p>
              <Link to={inbox} className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                Back to messages
              </Link>
            </div>
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
      setNotice(isApiClientError(err) && err.code === "RATE_LIMITED" ? "You're sending messages quickly. Wait a moment, then send again." : errorMessage(err));
      setSending(false);
    }
  };

  const waiting = existing.isLoading || profile.isLoading;
  return (
    <ChatPane>
      {(keyboardOpen) => (
        <>
          <ChatPaneHeader backTo={inbox} title={profile.data?.fullName ?? "New message"} member={profile.data} profileHref={profile.data ? `/t/${slug}/app/directory/${to}` : null} subtitle="New conversation" />
          {waiting ? (
            <div className="flex-1">
              <Loading />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
              <div className="max-w-sm rounded-xl bg-slate-50 px-5 py-4 text-sm text-slate-600">
                <p className="font-semibold text-slate-800">Your first message is a request</p>
                <p className="mt-1">{name} can accept or decline it. You can't send more until they accept.</p>
              </div>
            </div>
          )}
          {!waiting && <ChatComposer draftKey={dk} onSend={(text) => void send(text)} sending={sending} notice={notice} keyboardOpen={keyboardOpen} autoFocus />}
        </>
      )}
    </ChatPane>
  );
}
