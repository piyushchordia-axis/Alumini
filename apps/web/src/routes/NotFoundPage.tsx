import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl">🧭</div>
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Page not found</h1>
      <Link to="/" className="mt-3 text-primary underline">
        Back to start
      </Link>
    </div>
  );
}
