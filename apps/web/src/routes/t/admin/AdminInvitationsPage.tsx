import {
  INVITATION_CSV_HINT,
  INVITATION_REVOKED_TEXT,
  INVITATION_TABS,
  INVITATION_TEMPLATE_FILE,
  channelsSentence,
  deliveryText,
  formatCount,
  importDoneText,
  importIgnoredText,
  importInChunks,
  importProblems,
  importProgressText,
  importResultText,
  importRowYears,
  importSummaryText,
  invitationActionLabel,
  invitationActionText,
  invitationActions,
  invitationColumnsHint,
  invitationMeta,
  invitationName,
  invitationStatusFilter,
  invitationStatusView,
  invitationTemplateCsv,
  inviteShareText,
  partialImportText,
  readInvitationCsv,
  revokeInvitationCopy,
  rowCountText,
  sendCountText,
  sendNowLabel,
  sendPendingCopy,
  sendPendingDoneText,
  sentText,
  whatsappUrl,
  withBom,
  type ChunkedImportOutcome,
  type InvitationDto,
  type InvitationImportRow,
  type InvitationTab,
  type InviteImportMapping,
  type MessageChannel,
  type ProfileFieldDto,
} from "@illuminize/shared";
import { errorMessage, isApiClientError, isOutOfDate } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { IconCopy, IconDownload, IconExternalLink, IconMail, IconSearch } from "@/components/icons";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Input, Loading, PageHeader, Pagination, Stat, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { useDebounced } from "@/hooks/useDebounced";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { formatDateTime, timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

/**
 * The import: a CSV read in the browser, its first rows and the columns used, then sent in requests of 500 rows. It waits
 * for the institution's questions, as their keys are columns too, so a file picked first can't lose them; if they
 * couldn't be loaded, it says so and offers to try again, as the phone's import does.
 */
function ImportCard({ fieldsQuery, channels, onDone }: { fieldsQuery: UseQueryResult<ProfileFieldDto[]>; channels: MessageChannel[]; onDone: () => void }) {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const fields = fieldsQuery.data;
  const [parsed, setParsed] = useState<{ fileName: string; mapping: InviteImportMapping } | null>(null);
  // Untouched, sending follows the plan once the summary is in: on when it sends.
  const [sendChoice, setSendChoice] = useState<boolean | null>(null);
  const sendNow = (sendChoice ?? channels.length > 0) && channels.length > 0;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<ChunkedImportOutcome | null>(null);
  const run = useMutation({
    mutationFn: ({ rows, send }: { rows: InvitationImportRow[]; send: boolean }) =>
      importInChunks(rows, (chunk) => api.admin.invitations.import(slug, { rows: chunk.rows, send, rowOffset: chunk.rowOffset }), { fields, onProgress: (done, total) => setProgress({ done, total }) }),
    onMutate: ({ rows }) => {
      setOutcome(null);
      setProgress({ done: 0, total: rows.length });
    },
    onSuccess: (o) => {
      setOutcome(o);
      if (o.error) {
        toast.error(errorMessage(o.error));
        return;
      }
      setParsed(null);
      toast.success(importDoneText(o.result));
    },
    // A request that failed after others went still changed the list.
    onSettled: () => {
      setProgress(null);
      onDone();
    },
  });
  const problems = outcome ? importProblems(outcome.result) : [];
  const ignored = parsed ? importIgnoredText(parsed.mapping) : null;
  const partial = outcome?.error ? partialImportText(outcome.imported, outcome.error) : null;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">Import a list</h2>
          <p className="text-sm text-slate-500">{invitationColumnsHint(tenant.type)}</p>
          <p className="mt-1 text-sm text-slate-500">{INVITATION_CSV_HINT}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={!fields}
          onClick={() => fields && saveBlob(new Blob([withBom(invitationTemplateCsv(fields, tenant.type))], { type: "text/csv;charset=utf-8" }), INVITATION_TEMPLATE_FILE)}
        >
          <IconDownload size={16} />
          Template
        </Button>
      </div>
      {fieldsQuery.error && !fields && (
        <div className="flex flex-wrap items-center gap-2">
          <ErrorBox error={`Couldn't load your profile questions: ${errorMessage(fieldsQuery.error)}`} className="flex-1" />
          <Button variant="outline" size="sm" loading={fieldsQuery.isFetching} onClick={() => void fieldsQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        disabled={!fields || run.isPending}
        className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary disabled:opacity-60"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !fields) return;
          setOutcome(null);
          let text: string;
          try {
            text = await file.text();
          } catch {
            toast.error("Couldn't read that file. Save it as CSV and try again.");
            return;
          }
          const read = readInvitationCsv(text, fields);
          if (!read.mapping) {
            setParsed(null);
            toast.error(read.problem);
            return;
          }
          setParsed({ fileName: file.name, mapping: read.mapping });
        }}
      />
      {parsed && (
        <div className="space-y-3 rounded-lg bg-slate-50 p-4 text-sm">
          <p>
            <span className="font-medium">{parsed.fileName}</span>: {importSummaryText(parsed.mapping)}
            {ignored && <span className="text-slate-500"> {ignored}</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Phone</th>
                  <th className="py-1 pr-3">Name</th>
                  <th className="py-1 pr-3">Years</th>
                  <th className="py-1 pr-3">Email</th>
                </tr>
              </thead>
              <tbody>
                {parsed.mapping.rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-slate-200">
                    <td className="py-1 pr-3 font-mono">{r.phone}</td>
                    <td className="py-1 pr-3">{r.name}</td>
                    <td className="py-1 pr-3">{importRowYears(r)}</td>
                    <td className="py-1 pr-3">{r.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.mapping.rows.length > 5 && <p className="mt-1 text-xs text-slate-500">…and {formatCount(parsed.mapping.rows.length - 5)} more</p>}
          </div>
          <Checkbox checked={sendNow} disabled={channels.length === 0 || run.isPending} onChange={(e) => setSendChoice(e.target.checked)} label={sendNowLabel(channels)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => run.mutate({ rows: parsed.mapping.rows, send: sendNow })} loading={run.isPending}>
              {progress ? importProgressText(progress.done, progress.total) : `Import ${rowCountText(parsed.mapping.rows.length)}`}
            </Button>
            <Button variant="ghost" disabled={run.isPending} onClick={() => setParsed(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {outcome && (
        <div className="space-y-2 text-sm" role="status">
          {outcome.error ? (
            <p className="text-red-700">
              {errorMessage(outcome.error)}
              {partial ? ` ${partial}` : ""}
            </p>
          ) : null}
          {(!outcome.error || outcome.imported > 0) && <p className="font-medium text-slate-900">{importResultText(outcome.result)}</p>}
          {problems.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-3 text-xs">
              {problems.map((p) => (
                <li key={p.row}>
                  Line {p.row} <span className="font-mono">{p.phone}</span>: <span className={p.status === "invalid" ? "text-red-700" : "text-slate-600"}>{p.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

export function AdminInvitationsPage() {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const [status, setStatus] = useState<InvitationTab>("ALL");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const [page, setPage] = useState(1);
  const filters = { status: invitationStatusFilter(status), q: search || undefined, page, pageSize: 25 };
  const summary = useQuery({ queryKey: qk.admin.invitationSummary(slug), queryFn: () => api.admin.invitations.summary(slug) });
  const list = useQuery({ queryKey: qk.admin.invitations(slug, filters), queryFn: () => api.admin.invitations.list(slug, filters) });
  const fields = useQuery({ queryKey: qk.admin.profileFields(slug), queryFn: () => api.admin.profileFields.list(slug) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin", slug, "invitations"] });

  const [confirmingPending, setConfirmingPending] = useState(false);
  const sendPending = useMutation({
    mutationFn: () => api.admin.invitations.sendPending(slug),
    onSuccess: (r) => {
      setConfirmingPending(false);
      toast.success(sendPendingDoneText(r.queued));
    },
    // The plan stopped sending since the page was loaded (a 409): the question no longer stands, so the dialog closes
    // and says why. Anything else stays in the dialog, to try again.
    onError: (e) => {
      if (isOutOfDate(e)) {
        setConfirmingPending(false);
        toast.error(errorMessage(e));
      }
    },
    // A refusal means the figures are out of date too.
    onSettled: refresh,
  });
  const resend = useMutation({
    mutationFn: (inv: InvitationDto) => api.admin.invitations.send(slug, [inv.id]),
    onSuccess: (r, inv) => toast[r.queued ? "success" : "info"](sentText(r.queued, inv.sendCount > 0)),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });
  const [revoking, setRevoking] = useState<InvitationDto | null>(null);
  const revoke = useMutation({
    mutationFn: (inv: InvitationDto) => api.admin.invitations.revoke(slug, inv.id),
    onSuccess: () => {
      setRevoking(null);
      toast.success(INVITATION_REVOKED_TEXT);
    },
    // Accepted since the list was loaded: the question no longer stands, so the dialog closes and says why.
    onError: (e) => {
      if (isApiClientError(e) && e.status === 409) {
        setRevoking(null);
        toast.error(errorMessage(e));
      }
    },
    onSettled: refresh,
  });
  const s = summary.data;
  const channels = s?.channels ?? [];
  const pendingCopy = s ? sendPendingCopy(s.pending, channels, s.sendableToday) : null;
  const revokeCopy = revoking ? revokeInvitationCopy(revoking) : null;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Invitations"
        subtitle="Invite alumni by phone. They sign in with that number and join, even when self-registration is closed."
        actions={
          channels.length > 0 && s && s.pending > 0 && pendingCopy ? (
            <Button
              onClick={() => {
                sendPending.reset();
                setConfirmingPending(true);
              }}
            >
              {pendingCopy.label}
            </Button>
          ) : undefined
        }
      />
      {pendingCopy && (
        <ConfirmDialog
          open={confirmingPending}
          title={pendingCopy.title}
          body={pendingCopy.body}
          confirmLabel={pendingCopy.confirm}
          busy={sendPending.isPending}
          error={sendPending.error}
          onConfirm={() => sendPending.mutate()}
          onCancel={() => setConfirmingPending(false)}
        />
      )}
      <ConfirmDialog
        open={!!revoking}
        title={revokeCopy?.title ?? ""}
        body={revokeCopy?.body}
        confirmLabel={revokeCopy?.confirm ?? "Revoke"}
        destructive
        busy={revoke.isPending}
        error={revoke.error}
        onConfirm={() => revoking && revoke.mutate(revoking)}
        onCancel={() => setRevoking(null)}
      />
      {s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Not sent" value={s.pending} />
            <Stat label="Sent" value={s.sent} />
            <Stat label="Joined" value={s.accepted} />
            <Stat label="Expired" value={s.expired} />
            <Stat label="Can send today" value={channels.length ? s.sendableToday : "—"} />
          </div>
          <p className="text-sm text-slate-600">{channelsSentence(channels)}</p>
        </>
      )}
      <ImportCard fieldsQuery={fields} channels={channels} onDone={refresh} />
      <div className="flex flex-wrap items-center gap-3">
        <Tabs<InvitationTab>
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          tabs={[...INVITATION_TABS]}
          className="w-fit"
        />
        <Input
          aria-label="Search invitations"
          placeholder="Name, phone or email"
          value={q}
          maxLength={80}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
      </div>
      {list.isLoading ? (
        <Loading />
      ) : list.error || !list.data ? (
        <ErrorBox error={list.error ?? "Failed"} />
      ) : list.data.data.length === 0 ? (
        search ? (
          <EmptyState icon={<IconSearch size={32} className="text-slate-400" />} title={`No invitations match “${search}”`} description="Search looks at names, phone numbers and email addresses." />
        ) : (
          <EmptyState icon={<IconMail size={32} className="text-slate-400" />} title="No invitations here" description="Import a CSV of alumni phone numbers to invite them." />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Alumnus</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Delivery</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data.data.map((inv) => {
                  const can = invitationActions(inv, channels);
                  const view = invitationStatusView(inv);
                  const times = sendCountText(inv);
                  return (
                    <tr key={inv.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{invitationName(inv)}</div>
                        <div className="font-mono text-xs text-slate-500">{invitationMeta(inv)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={view.tone}>{view.label}</Badge>
                        {inv.acceptedAt && <div className="mt-1 text-xs text-slate-500">{formatDateTime(inv.acceptedAt)}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {deliveryText(inv, timeAgo)}
                        {times && <div className="text-slate-400">{times}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          {can.copy && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1.5"
                              aria-label={invitationActionLabel("copy", inv)}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(inv.link!);
                                  toast.success("Link copied");
                                } catch {
                                  toast.error("Couldn't copy the link");
                                }
                              }}
                            >
                              <IconCopy size={16} />
                              {invitationActionText("copy", inv)}
                            </Button>
                          )}
                          {can.whatsapp && (
                            <a
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-emerald-700 hover:bg-emerald-50"
                              href={whatsappUrl(inv.phone, inviteShareText(tenant.name, inv.link!))}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={invitationActionLabel("whatsapp", inv)}
                            >
                              <IconExternalLink size={16} />
                              {invitationActionText("whatsapp", inv)}
                            </a>
                          )}
                          {can.send && (
                            <Button size="sm" variant="outline" aria-label={invitationActionLabel("send", inv)} loading={resend.isPending && resend.variables?.id === inv.id} onClick={() => resend.mutate(inv)}>
                              {invitationActionText("send", inv)}
                            </Button>
                          )}
                          {can.revoke && (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={invitationActionLabel("revoke", inv)}
                              onClick={() => {
                                revoke.reset();
                                setRevoking(inv);
                              }}
                            >
                              {invitationActionText("revoke", inv)}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
