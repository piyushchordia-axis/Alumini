import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { IconAlert } from "@/components/icons";
import { NotFoundPage } from "@/routes/NotFoundPage";

/** Router-level error boundary: a render crash or a failed lazy chunk shows this instead of a blank page. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const message = error instanceof Error ? error.message : isRouteErrorResponse(error) ? error.statusText : null;
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="flex min-h-full flex-col items-center justify-center p-8 text-center" role="alert">
      <IconAlert size={48} className="text-slate-400" />
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">The page hit an unexpected error. Reloading usually fixes it; if it keeps happening, let your alumni office know.</p>
      {message && import.meta.env.DEV && <pre className="mt-3 max-w-lg overflow-x-auto rounded bg-slate-100 p-3 text-left text-xs text-slate-600">{message}</pre>}
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
          Reload
        </button>
        <Link to="/" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
          Back to start
        </Link>
      </div>
    </div>
  );
}
