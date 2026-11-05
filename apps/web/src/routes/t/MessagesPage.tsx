import { chatAvailable, type ChatInbox } from "@illuminize/shared";
import clsx from "clsx";
import { Outlet, useMatch, useSearchParams } from "react-router-dom";
import { ChatNotice } from "@/components/chat/ChatPane";
import { ConversationList } from "@/components/chat/ConversationList";
import { IconMessages } from "@/components/icons";
import { useMembership } from "@/hooks/useMembership";
import { inboxFromParams } from "@/lib/chat";

/**
 * Messages: the inbox beside whatever is open, filling the window. Phones show one pane at a time, the inbox on
 * /messages and the open thread (or the blocked list) anywhere below it.
 */
export function MessagesPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const onInbox = !!useMatch("/t/:slug/app/messages");
  const [params, setParams] = useSearchParams();
  const inbox = inboxFromParams(params);
  const changeInbox = (next: ChatInbox) => setParams(next === "REQUESTS" ? { tab: "requests" } : {}, { replace: true });

  // Messages and groups are off and this is Blocked members, the one part still open (see RequireChat): no inbox beside it.
  if (!chatAvailable(tenant.settings.features, true)) {
    return (
      <div className="flex min-h-0 flex-1 bg-white md:overflow-hidden md:rounded-xl md:border md:border-slate-200 md:shadow-sm">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 bg-white md:overflow-hidden md:rounded-xl md:border md:border-slate-200 md:shadow-sm">
      <section aria-label="Conversations" className={clsx("min-h-0 w-full flex-col md:flex md:w-80 md:shrink-0 md:border-r md:border-slate-200", onInbox ? "flex" : "hidden")}>
        <ConversationList slug={slug} inbox={inbox} onInboxChange={changeInbox} features={tenant.settings.features} />
      </section>
      <div className={clsx("min-h-0 min-w-0 flex-1 flex-col", onInbox ? "hidden md:flex" : "flex")}>
        <Outlet />
      </div>
    </div>
  );
}

/** The right-hand pane with nothing open. Phones never show it. */
export function NoConversationPane() {
  return <ChatNotice icon={<IconMessages size={32} />} title="Choose a conversation" text="Messages are private to the people in each conversation. Admins only ever see a message that someone reports, with a few around it." />;
}
