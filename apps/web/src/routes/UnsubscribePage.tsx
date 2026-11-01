import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, Loading } from "@/components/ui";
import { api } from "@/lib/api";

const WHAT = { digest: "the weekly digest email", announcements: "announcements by email and WhatsApp" } as const;

/** Opened from an email footer. Shows what will be turned off, then confirms with a POST (no sign-in needed). */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const info = useQuery({ queryKey: ["unsubscribe", token], queryFn: () => api.unsubscribe.info(token), enabled: !!token, retry: false });
  const confirm = useMutation({ mutationFn: () => api.unsubscribe.confirm(token) });
  const done = confirm.data ?? (info.data?.unsubscribed ? info.data : null);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md p-6 text-center">
        {!token || info.isError ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">Link not valid</h1>
            <p className="mt-2 text-sm text-slate-600">{info.error ? errorMessage(info.error) : "This unsubscribe link is incomplete."} You can change email settings in the app under Notifications → Settings.</p>
          </>
        ) : info.isLoading ? (
          <Loading />
        ) : done ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">You're unsubscribed</h1>
            <p className="mt-2 text-sm text-slate-600">
              You won't get {WHAT[done.scope]} from {done.tenantName}. You can turn it back on any time in the app under Notifications → Settings.
            </p>
            <Link to="/" className="mt-4 inline-block text-primary underline">
              Open Illuminize
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-900">Unsubscribe?</h1>
            <p className="mt-2 text-sm text-slate-600">
              Stop {WHAT[info.data!.scope]} from <span className="font-medium">{info.data!.tenantName}</span>.
            </p>
            {confirm.isError && <p className="mt-3 text-sm text-red-600">{errorMessage(confirm.error)}</p>}
            <Button className="mt-4 w-full" loading={confirm.isPending} onClick={() => confirm.mutate()}>
              Unsubscribe
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
