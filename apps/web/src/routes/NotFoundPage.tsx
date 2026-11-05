import { Link } from "react-router-dom";
import { IconSearch } from "@/components/icons";

export function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center p-8 text-center">
      <IconSearch size={48} className="text-slate-400" />
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Page not found</h1>
      <Link to="/" className="mt-3 text-primary underline">
        Back to start
      </Link>
    </div>
  );
}
