import type { AuthSessionDto } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useEffect, useState } from "react";
import { Button, ErrorBox, FormField } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { OtpInput } from "./OtpInput";
import { PhoneInput, toE164, type PhoneValue } from "./PhoneInput";

/** Two-step phone → OTP login shared by the tenant and platform login pages. */
export function OtpLoginForm({ onSuccess }: { onSuccess: (session: AuthSessionDto) => void }) {
  const [phone, setPhone] = useState<PhoneValue>({ country: "IN", number: "" });
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState("");
  const [channel, setChannel] = useState<string>("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const e164 = toE164(phone);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.requestOtp(e164);
      setChannel(r.channel);
      setDevCode(r.devCode);
      setCooldown(r.resendAfterSec);
      setStep("code");
      setCode("");
    } catch (err) {
      if (isApiClientError(err) && err.code === "OTP_COOLDOWN") {
        setStep("code");
        setCooldown((err.details as { retryAfterSec?: number })?.retryAfterSec ?? 60);
      } else setError(err);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await api.auth.verifyOtp(e164, code);
      setSession(session);
      onSuccess(session);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (step === "phone") {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void request();
        }}
      >
        <FormField label="Mobile number" hint="We'll send a one-time code on WhatsApp (SMS fallback).">
          <PhoneInput value={phone} onChange={setPhone} autoFocus />
        </FormField>
        {error ? <ErrorBox error={error} /> : null}
        <Button type="submit" block loading={busy} disabled={phone.number.replace(/\D/g, "").length < 6}>
          Send code
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      <p className="text-sm text-slate-600">
        Enter the code sent to <span className="font-medium text-slate-900">{e164}</span>
        {channel === "whatsapp" ? " on WhatsApp" : channel === "sms" ? " by SMS" : ""}.{" "}
        <button type="button" className="text-primary underline" onClick={() => setStep("phone")}>
          Change number
        </button>
      </p>
      {devCode && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Development mode: your code is <span className="font-mono font-semibold">{devCode}</span>
        </p>
      )}
      <OtpInput value={code} onChange={setCode} autoFocus />
      {error ? <ErrorBox error={errorMessage(error)} /> : null}
      <Button type="submit" block loading={busy} disabled={code.length < 6}>
        Verify and continue
      </Button>
      <div className="text-center text-sm text-slate-500">
        {cooldown > 0 ? (
          <span>Resend code in {cooldown}s</span>
        ) : (
          <button type="button" className="text-primary underline" onClick={() => void request()} disabled={busy}>
            Resend code
          </button>
        )}
      </div>
    </form>
  );
}
