import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/**
 * Opened from the confirmation email. Confirms only when the button is pressed (a POST), so mail scanners that open
 * links can't confirm addresses. Works without being signed in.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const qc = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => api.auth.verifyEmail(token),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.myEmail });
    },
  });
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="text-4xl" aria-hidden>
          ✉️
        </div>
        {confirm.isSuccess ? (
          <>
            <h1 className="mt-3 text-xl font-semibold text-slate-900">Email confirmed</h1>
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-medium">{confirm.data.email}</span> is now the email on your Illuminize account. You can change your email preferences in each institution's notification settings.
            </p>
            <Link to="/" className="mt-4 inline-block text-primary underline">
              Continue to Illuminize
            </Link>
          </>
        ) : !token ? (
          <>
            <h1 className="mt-3 text-xl font-semibold text-slate-900">Link incomplete</h1>
            <p className="mt-2 text-sm text-slate-600">Open the link from the confirmation email again, or request a new one from your profile.</p>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-xl font-semibold text-slate-900">Confirm your email address</h1>
            <p className="mt-2 text-sm text-slate-600">Press the button to use this address for your Illuminize account.</p>
            {confirm.isError && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {errorMessage(confirm.error)}
              </p>
            )}
            <Button className="mt-4 w-full" loading={confirm.isPending} onClick={() => confirm.mutate()}>
              Confirm email address
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
