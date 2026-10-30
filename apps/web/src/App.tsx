import { ERROR_CODES } from "@illuminize/shared";

export default function App() {
  return (
    <main className="min-h-full flex items-center justify-center p-6">
      <div className="rounded-xl bg-white shadow p-8 text-center">
        <h1 className="text-2xl font-semibold text-primary">Illuminize</h1>
        <p className="mt-2 text-slate-600">Scaffold ready. {ERROR_CODES.length} error codes shared.</p>
      </div>
    </main>
  );
}
