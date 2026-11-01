import {
  MAX_INVITE_IMPORT_ROWS,
  csvLine,
  parseCsv,
  type InvitationDto,
  type InvitationImportResultDto,
  type InvitationImportRow,
  type InvitationsQuery,
  type MessageChannel,
  type ProfileFieldDto,
} from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Input, Loading, PageHeader, Pagination, Stat, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

const CHANNEL_LABELS: Record<MessageChannel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "email" };
const PHONE_HEADERS = ["phone", "mobile", "phone_number", "mobile_number", "whatsapp"];
const NAME_HEADERS = ["name", "full_name", "fullname"];
const BATCH_HEADERS = ["batch", "batch_year", "year", "graduation_year"];
const EMAIL_HEADERS = ["email", "email_address", "e_mail"];

type Status = NonNullable<InvitationsQuery["status"]> | "ALL";

/** Turns parsed CSV rows into import rows: known columns by common names, other columns that match a field key. */
function toImportRows(rows: Record<string, string>[], headers: string[], fields: ProfileFieldDto[]) {
  const pick = (names: string[]) => headers.find((h) => names.includes(h));
  const phoneCol = pick(PHONE_HEADERS);
  const nameCol = pick(NAME_HEADERS);
  const batchCol = pick(BATCH_HEADERS);
  const emailCol = pick(EMAIL_HEADERS);
  const fieldCols = fields.filter((f) => headers.includes(f.key));
  const used = new Set([phoneCol, nameCol, batchCol, emailCol, ...fieldCols.map((f) => f.key)]);
  const ignored = headers.filter((h) => h && !used.has(h));
  const out: InvitationImportRow[] = rows.map((r) => ({
    phone: phoneCol ? r[phoneCol]! : "",
    name: nameCol ? r[nameCol] || null : null,
    batchYear: batchCol ? r[batchCol] || null : null,
    email: emailCol ? r[emailCol] || null : null,
    fields: Object.fromEntries(
      fieldCols
        .map((f) => {
          const raw = r[f.key] ?? "";
          if (!raw) return [f.key, null] as const;
          // Several choices are written "a; b" in one cell; yes/no as yes/no/true/false/1/0.
          if (f.type === "MULTI_SELECT") return [f.key, raw.split(/[;|]/).map((s) => s.trim()).filter(Boolean)] as const;
          if (f.type === "BOOLEAN") return [f.key, /^(y|yes|true|1)$/i.test(raw) ? true : /^(n|no|false|0)$/i.test(raw) ? false : raw] as const;
          if (f.type === "NUMBER" && raw.trim() !== "" && Number.isFinite(Number(raw))) return [f.key, Number(raw)] as const;
          return [f.key, raw] as const;
        })
        .filter(([, v]) => v !== null),
    ),
  }));
  return { rows: out, phoneCol, columns: { name: nameCol, batch: batchCol, email: emailCol, fields: fieldCols.map((f) => f.label) }, ignored };
}

function downloadTemplate(fields: ProfileFieldDto[]) {
  const headers = ["phone", "name", "batch", "email", ...fields.map((f) => f.key)];
  const example = ["+919876543210", "Asha Rao", "2012", "asha@example.com", ...fields.map((f) => (f.options[0]?.value ?? ""))];
  const blob = new Blob(["﻿" + csvLine(headers) + csvLine(example).replace(/^'/, "")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: "invitations-template.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

function statusBadge(inv: InvitationDto) {
  if (inv.expired) return <Badge tone="neutral">Expired</Badge>;
  switch (inv.status) {
    case "PENDING":
      return <Badge tone="warning">Not sent</Badge>;
    case "SENT":
      return <Badge tone="info">Sent</Badge>;
    case "ACCEPTED":
      return <Badge tone="success">Joined</Badge>;
    case "REVOKED":
      return <Badge tone="danger">Revoked</Badge>;
  }
}

function deliveryText(inv: InvitationDto) {
  const d = inv.delivery;
  if (!d) return inv.sendCount ? "" : "—";
  const via = d.channel ? ` by ${CHANNEL_LABELS[d.channel]}` : "";
  switch (d.status) {
    case "QUEUED":
    case "SENDING":
      return "Sending…";
    case "SENT":
    case "DELIVERED":
    case "READ":
      return `${d.status === "READ" ? "Read" : d.status === "DELIVERED" ? "Delivered" : "Sent"}${via} · ${timeAgo(d.at)}`;
    case "FAILED":
      return `Failed${via}${d.lastError ? `: ${d.lastError}` : ""}`;
    case "CANCELLED":
      return "Not sent (closed before sending)";
  }
}

function ImportCard({ fields, channels, onDone }: { fields: ProfileFieldDto[]; channels: MessageChannel[]; onDone: () => void }) {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const [parsed, setParsed] = useState<ReturnType<typeof toImportRows> & { fileName: string } | null>(null);
  const [send, setSend] = useState(channels.length > 0);
  const [result, setResult] = useState<InvitationImportResultDto | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      const rows = parsed!.rows;
      const total: InvitationImportResultDto = { created: 0, updated: 0, skipped: 0, queued: 0, results: [] };
      for (let i = 0; i < rows.length; i += MAX_INVITE_IMPORT_ROWS) {
        // Data rows start on line 2 of the file (line 1 is the header).
        const r = await api.admin.invitations.import(slug, { rows: rows.slice(i, i + MAX_INVITE_IMPORT_ROWS), send: send && channels.length > 0, rowOffset: i + 1 });
        total.created += r.created;
        total.updated += r.updated;
        total.skipped += r.skipped;
        total.queued += r.queued;
        total.results.push(...r.results);
      }
      return total;
    },
    onSuccess: (r) => {
      setResult(r);
      setParsed(null);
      onDone();
      toast.success(`${r.created} invited, ${r.updated} updated${r.queued ? `, ${r.queued} sending` : ""}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const problems = result?.results.filter((r) => r.status === "invalid" || r.status === "member") ?? [];
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">Import a list</h2>
          <p className="text-sm text-slate-500">A CSV with a phone column, and optionally name, batch, email and your profile field keys. Numbers without a country code use your institution&apos;s country.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => downloadTemplate(fields)}>
          ⬇ Template
        </Button>
      </div>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setResult(null);
          const csv = parseCsv(await file.text());
          const mapped = toImportRows(csv.rows, csv.headers, fields);
          if (!mapped.phoneCol) {
            toast.error("No phone column found. Name a column \"phone\" (see the template).");
            return;
          }
          setParsed({ ...mapped, fileName: file.name });
        }}
      />
      {parsed && (
        <div className="space-y-3 rounded-lg bg-slate-50 p-4 text-sm">
          <p>
            <span className="font-medium">{parsed.fileName}</span>: {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}. Using phone
            {parsed.columns.name ? ", name" : ""}
            {parsed.columns.batch ? ", batch" : ""}
            {parsed.columns.email ? ", email" : ""}
            {parsed.columns.fields.length ? `, ${parsed.columns.fields.join(", ")}` : ""}.
            {parsed.ignored.length > 0 && <span className="text-slate-500"> Ignoring: {parsed.ignored.join(", ")}.</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Phone</th>
                  <th className="py-1 pr-3">Name</th>
                  <th className="py-1 pr-3">Batch</th>
                  <th className="py-1 pr-3">Email</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-slate-200">
                    <td className="py-1 pr-3 font-mono">{r.phone}</td>
                    <td className="py-1 pr-3">{r.name}</td>
                    <td className="py-1 pr-3">{r.batchYear}</td>
                    <td className="py-1 pr-3">{r.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 5 && <p className="mt-1 text-xs text-slate-500">…and {parsed.rows.length - 5} more</p>}
          </div>
          <Checkbox
            checked={send && channels.length > 0}
            disabled={channels.length === 0}
            onChange={(e) => setSend(e.target.checked)}
            label={channels.length ? `Send the invitations now (by ${channels.map((c) => CHANNEL_LABELS[c]).join(", then ")})` : "Sending isn't included in your plan; you'll share the links yourself"}
          />
          <div className="flex gap-2">
            <Button onClick={() => run.mutate()} loading={run.isPending}>
              Import {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
            </Button>
            <Button variant="ghost" onClick={() => setParsed(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {result && (
        <div className="space-y-2 text-sm" role="status">
          <p>
            <span className="font-medium text-slate-900">{result.created} new</span>, {result.updated} updated, {result.skipped} skipped
            {result.queued ? `, ${result.queued} being sent` : ""}.
          </p>
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
  const [status, setStatus] = useState<Status>("ALL");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const filters = { status: status === "ALL" ? undefined : status, q: q || undefined, page, pageSize: 25 };
  const summary = useQuery({ queryKey: qk.admin.invitationSummary(slug), queryFn: () => api.admin.invitations.summary(slug) });
  const list = useQuery({ queryKey: qk.admin.invitations(slug, filters), queryFn: () => api.admin.invitations.list(slug, filters) });
  const fields = useQuery({ queryKey: qk.admin.profileFields(slug), queryFn: () => api.admin.profileFields.list(slug) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin", slug, "invitations"] });
  const sendPending = useMutation({
    mutationFn: () => api.admin.invitations.sendPending(slug),
    onSuccess: (r) => {
      refresh();
      toast.success(r.queued ? `Sending ${r.queued} invitation${r.queued === 1 ? "" : "s"}` : "Nothing to send");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resend = useMutation({
    mutationFn: (id: string) => api.admin.invitations.send(slug, [id]),
    onSuccess: (r) => {
      refresh();
      toast[r.queued ? "success" : "info"](r.queued ? "Invitation sent again" : "Sent less than a day ago; try again later");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.admin.invitations.revoke(slug, id), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const s = summary.data;
  const channels = s?.channels ?? [];
  const shareText = (inv: InvitationDto) => `You're invited to join the ${tenant.name} alumni network on Illuminize: ${inv.link}`;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Invitations"
        subtitle="Invite alumni by phone. They sign in with that number and join, even when self-registration is closed."
        actions={
          channels.length > 0 && s && s.pending > 0 ? (
            <Button onClick={() => sendPending.mutate()} loading={sendPending.isPending}>
              Send {s.pending} pending
            </Button>
          ) : undefined
        }
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
          <p className="text-sm text-slate-600">
            {channels.length ? (
              <>Your plan sends invitations by {channels.map((c) => CHANNEL_LABELS[c]).join(", then ")}. Each invitation can be resent once a day.</>
            ) : (
              <>Your plan doesn&apos;t include WhatsApp, SMS or email messages: copy an invitation&apos;s link or share it on WhatsApp from your own phone.</>
            )}
          </p>
        </>
      )}
      <ImportCard fields={fields.data ?? []} channels={channels} onDone={refresh} />
      <div className="flex flex-wrap items-center gap-3">
        <Tabs<Status>
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          tabs={[
            { value: "ALL", label: "All" },
            { value: "PENDING", label: "Not sent" },
            { value: "SENT", label: "Sent" },
            { value: "ACCEPTED", label: "Joined" },
            { value: "EXPIRED", label: "Expired" },
            { value: "REVOKED", label: "Revoked" },
          ]}
          className="w-fit"
        />
        <Input
          aria-label="Search invitations"
          placeholder="Name, phone or email"
          value={q}
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
        <EmptyState icon="✉️" title="No invitations here" description="Import a CSV of alumni phone numbers to invite them." />
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
                  const open = (inv.status === "PENDING" || inv.status === "SENT") && !inv.expired;
                  return (
                    <tr key={inv.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{inv.fullName ?? "—"}</div>
                        <div className="font-mono text-xs text-slate-500">
                          {inv.phone}
                          {inv.batchYear ? ` · ${inv.batchYear}` : ""}
                          {inv.email ? ` · ${inv.email}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {statusBadge(inv)}
                        {inv.acceptedAt && <div className="mt-1 text-xs text-slate-500">{formatDateTime(inv.acceptedAt)}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {deliveryText(inv)}
                        {inv.sendCount > 1 && <div className="text-slate-400">sent {inv.sendCount} times</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          {open && inv.link && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  await navigator.clipboard.writeText(inv.link!);
                                  toast.success("Link copied");
                                }}
                              >
                                Copy link
                              </Button>
                              <a
                                className="inline-flex h-8 items-center rounded-lg px-3 text-sm text-emerald-700 hover:bg-emerald-50"
                                href={`https://wa.me/${inv.phone.replace(/\D/g, "")}?text=${encodeURIComponent(shareText(inv))}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                WhatsApp
                              </a>
                            </>
                          )}
                          {open && channels.length > 0 && (
                            <Button size="sm" variant="outline" loading={resend.isPending && resend.variables === inv.id} onClick={() => resend.mutate(inv.id)}>
                              {inv.sendCount ? "Resend" : "Send"}
                            </Button>
                          )}
                          {inv.status !== "ACCEPTED" && inv.status !== "REVOKED" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Revoke the invitation for ${inv.fullName ?? inv.phone}? The link stops working.`)) revoke.mutate(inv.id);
                              }}
                            >
                              Revoke
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
