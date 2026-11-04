import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useState } from "react";
import type { ZodError } from "zod";

/** Field + form error state shared by the mobile forms (client-side zod issues and API field errors). */
export function useFormErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fromZod = (e: ZodError) => {
    const next: Record<string, string> = {};
    for (const i of e.issues) next[String(i.path[0] ?? "form")] ??= i.message;
    setErrors(next);
  };
  /** Runs a submit: clears errors, maps API field errors onto fields, shows anything else under the form. */
  const run = async (fn: () => Promise<void>) => {
    setErrors({});
    setServerError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      if (isApiClientError(err) && Object.keys(err.fieldErrors).length) {
        // Keyed by field, as fromZod keys them: "skills.3" (one skill too long) is the skills field's error.
        const next: Record<string, string> = {};
        for (const [path, message] of Object.entries(err.fieldErrors)) next[path.split(".")[0]!] ??= message;
        setErrors(next);
      } else setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { errors, setErrors, serverError, busy, fromZod, run };
}
