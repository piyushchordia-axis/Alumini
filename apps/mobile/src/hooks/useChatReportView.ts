import { CHAT_REPORT_VIEW_CLOSED, chatReportViewMustClose, chatReportViewStep, type AdminChatReportViewDto, type ChatReportViewEvent, type ChatReportViewState } from "@illuminize/shared";
import { errorMessage, isOutOfDate, type ApiClientError } from "@illuminize/shared/client";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useAppActive } from "@/hooks/useChat";
import { api } from "@/lib/api";

const step = (state: ChatReportViewState<AdminChatReportViewDto>, event: ChatReportViewEvent<AdminChatReportViewDto>) => chatReportViewStep(state, event);

/**
 * The one chat report whose words are open on a screen (CHAT_REPORT_PRIVACY_TEXT says what happens to them). Each view
 * writes an audit row, so its answer lives in this component's state alone: never a query or mutation cache, never
 * fetched again by itself. Only the latest request's answer is shown (chatReportViewStep), and the text goes:
 * - when the screen loses focus: a member page pushed over it keeps it mounted, and the web build keeps it in the page;
 * - when the app stops being active, meant to keep the text out of the app switcher's and the recents screen's picture
 *   of it (whether the system takes that picture first is a device check, e2e/README);
 * - when the report leaves `listed` (the ids of the list's latest answer), as when another admin closed it;
 * - and on unmount, which a tab change is, as the screen keys the list by its tab.
 * `onOutOfDate` hears a view refused because the report was handled or has gone, to refresh the list and say so, only
 * while that view is still the one awaited: a late refusal is dropped like a late answer. Any other failure is said in
 * the report's row (`problem`).
 */
export function useChatReportView(slug: string, { listed, onOutOfDate }: { listed: ReadonlySet<string> | undefined; onOutOfDate: (err: ApiClientError) => void }) {
  const [state, dispatch] = useReducer(step, CHAT_REPORT_VIEW_CLOSED);
  const requests = useRef(0);
  // The request whose answer still counts, for what happens outside the reducer: none once it was answered or closed.
  const awaited = useRef<number | null>(null);
  const active = useAppActive();
  // In render rather than an effect, so no frame after the app has gone inactive still draws the text.
  if (chatReportViewMustClose(state, active, listed)) dispatch({ type: "close" });
  // Follows the reducer, which that close (refs can't be written in render) and an answer change; open and close set it
  // straight away too.
  useEffect(() => {
    awaited.current = state.awaiting?.request ?? null;
  }, [state.awaiting]);

  const close = useCallback(() => {
    awaited.current = null;
    dispatch({ type: "close" });
  }, []);
  // Its cleanup runs on blur and on unmount.
  useFocusEffect(useCallback(() => close, [close]));

  const open = async (reportId: string) => {
    requests.current += 1;
    const request = requests.current;
    awaited.current = request;
    dispatch({ type: "open", request, reportId });
    try {
      dispatch({ type: "answer", request, view: await api.admin.chatReports.view(slug, reportId) });
    } catch (err) {
      const outOfDate = isOutOfDate(err);
      dispatch({ type: "failed", request, text: outOfDate ? null : errorMessage(err) });
      if (outOfDate && awaited.current === request) onOutOfDate(err);
    }
  };

  return {
    /** The open report's id and what its view returned. */
    shown: state.shown,
    /** The report being opened. */
    openingId: state.awaiting?.reportId ?? null,
    problem: state.problem,
    open,
    close,
  };
}
