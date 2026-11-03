import type { ChatInbox } from "@illuminize/shared";
import clsx from "clsx";
import { Outlet, useMatch, useSearchParams } from "react-router-dom";
import { ConversationList } from "@/components/chat/ConversationList";
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

  // Messages are off and this is Blocked members, the one part still open (see RequireChat): no inbox beside it.
  if (!tenant.settings.features.messaging) {
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
        <ConversationList slug={slug} inbox={inbox} onInboxChange={changeInbox} directoryOn={tenant.settings.features.directory} />
      </section>
      <div className={clsx("min-h-0 min-w-0 flex-1 flex-col", onInbox ? "hidden md:flex" : "flex")}>
        <Outlet />
      </div>
    </div>
  );
}

/** The right-hand pane with nothing open. Phones never show it. */
export function NoConversationPane() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <div className="mb-3 text-4xl" aria-hidden>
        💬
      </div>
      <p className="text-base font-semibold text-slate-800">Choose a conversation</p>
      <p className="mt-1 max-w-sm text-balance text-sm text-slate-500">Messages are private between the two of you. Admins only ever see a message that someone reports, with a few around it.</p>
    </div>
  );
}
