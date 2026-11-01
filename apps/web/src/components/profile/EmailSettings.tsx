import { isApiClientError, errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, FormField, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

/** The account's email: confirmed address, pending confirmation, and the form to add or change it. */
export function EmailSettings() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: qk.myEmail, queryFn: () => api.me.email.get() });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const onDone = (data: Awaited<ReturnType<typeof api.me.email.get>>) => {
    qc.setQueryData(qk.myEmail, data);
    void qc.invalidateQueries({ queryKey: qk.me });
  };
  const send = useMutation({
    mutationFn: (email: string) => api.me.email.set(email),
    onSuccess: (data) => {
      onDone(data);
      setEditing(false);
      setValue("");
      if (data.pending) toast.success(`Confirmation link sent to ${data.pending.email}`);
    },
    onError: (e) => {
      if (isApiClientError(e) && e.fieldErrors.email) setFieldError(e.fieldErrors.email);
      else toast.error(errorMessage(e));
    },
  });
  const remove = useMutation({ mutationFn: () => api.me.email.remove(), onSuccess: onDone, onError: (e) => toast.error(errorMessage(e)) });

  const d = status.data;
  const showForm = editing || (d && !d.email && !d.pending);
  return (
    <section aria-labelledby="email-heading">
      <h2 id="email-heading" className="font-semibold text-slate-900">
        Email
      </h2>
      <p className="mt-1 text-sm text-slate-500">For the weekly digest and announcements. Never shown to other members; shared by all your institutions.</p>
      {status.isLoading ? (
        <p className="mt-3 text-sm text-slate-400">Loading…</p>
      ) : status.isError ? (
        <p className="mt-3 text-sm text-red-600">{errorMessage(status.error)}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {d?.email && (
            <p className="text-sm">
              <span className="font-medium text-slate-900">{d.email}</span> <span className="text-green-700">· confirmed</span>
            </p>
          )}
          {d?.pending && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
              We sent a confirmation link to <span className="font-medium">{d.pending.email}</span>. Open it before {formatDateTime(d.pending.expiresAt)}
              {d.email ? ` — until then we keep using ${d.email}.` : "."}{" "}
              <button type="button" className="underline" disabled={send.isPending} onClick={() => send.mutate(d.pending!.email)}>
                Send again
              </button>
            </p>
          )}
          {showForm ? (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setFieldError(null);
                send.mutate(value);
              }}
            >
              <div className="flex-1">
                <FormField label={d?.email ? "New email address" : "Email address"} error={fieldError ?? undefined}>
                  <Input type="email" autoComplete="email" value={value} onChange={(e) => setValue(e.target.value)} required placeholder="you@example.com" />
                </FormField>
              </div>
              <Button type="submit" loading={send.isPending}>
                Send confirmation link
              </Button>
              {editing && (
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {d?.email ? "Change email" : "Use a different email"}
              </Button>
              {(d?.email || d?.pending) && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={remove.isPending}
                  onClick={() => {
                    if (confirm("Remove your email? You'll stop getting the digest and announcement emails.")) remove.mutate();
                  }}
                >
                  Remove email
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
