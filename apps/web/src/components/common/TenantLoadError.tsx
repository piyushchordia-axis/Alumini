import { Link } from "react-router-dom";
import { Button, Card, ErrorBox } from "@/components/ui";

/** Shown when an institution or the viewer's membership cannot be loaded; offers a retry and a way out. */
export function TenantLoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="mx-auto max-w-md p-6">
      <Card className="space-y-4 p-5">
        <ErrorBox error={error} />
        <div className="flex flex-wrap gap-2">
          {onRetry && <Button onClick={onRetry}>Try again</Button>}
          <Link to="/?switch=1" className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Choose another institution
          </Link>
        </div>
      </Card>
    </div>
  );
}
