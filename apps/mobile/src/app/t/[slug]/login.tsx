import { countryByCode, defaultFeaturesFor, formatPhone, nationalDigits, phoneCountryNote, phoneEntryToE164, readPhoneEntry, type PhoneEntry } from "@illuminize/shared";
import { errorMessage, GUARD_QUERY_META, isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, Text, View } from "react-native";
import { CountryPicker } from "@/components/CountryPicker";
import { Button, ErrorText, Input, Screen, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { useTenant } from "@/hooks/useTenant";
import { qk } from "@/lib/queryKeys";
import { entryHref, homeHref } from "@/lib/sections";
import { useAuthStore } from "@/stores/authStore";
import { colors, useTheme } from "@/theme";

export default function LoginScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const theme = useTheme();
  const setSession = useAuthStore((s) => s.setSession);
  const tenant = useTenant(slug);
  const [entry, setEntry] = useState<PhoneEntry>({ country: "IN", number: "" });
  const dial = countryByCode(entry.country)?.dial ?? "+91";
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [channel, setChannel] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const phone = phoneEntryToE164(entry);

  // A pasted or autofilled "+44…" moves the picker; say so, since focus stays in the box.
  const changeNumber = (raw: string) => {
    const next = readPhoneEntry(entry.country, raw, entry);
    if (next.country !== entry.country && Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(phoneCountryNote(next.country));
    setEntry(next);
  };

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.requestOtp(phone);
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
      const session = await api.auth.verifyOtp(phone, code);
      setSession(session);
      const m = session.memberships.find((x) => x.tenant.slug === slug);
      if (!m || m.status !== "APPROVED") return router.replace(!m ? `/t/${slug}/register` : `/t/${slug}/pending`);
      // The tenant layout has loaded the institution, so its feature switches are in the query cache.
      const features = tenant.data?.settings.features ?? defaultFeaturesFor(tenant.data?.type ?? "OTHER");
      // The session's summary doesn't say whether the walk-through is owed: the membership does, which the app's guard
      // would fetch next anyway. Without it they go home, and the walk-through waits for the next time they come in.
      const full = await qc.fetchQuery({ queryKey: qk.membership(slug!), queryFn: () => api.membership.me(slug!), staleTime: 0, meta: GUARD_QUERY_META }).catch(() => null);
      router.replace(full ? entryHref(slug!, features, full) : homeHref(slug!, features));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen topInset>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace(`/t/${slug}`))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
        <Text style={{ color: theme.primary, fontSize: 15 }}>‹ Back</Text>
      </Pressable>
      <Title sub="We'll send a one-time code on WhatsApp (SMS fallback).">Sign in</Title>
      {step === "phone" ? (
        <View style={{ gap: 12 }}>
          <CountryPicker
            label="Country code"
            variant="dial"
            value={entry.country}
            onChange={(c) => setEntry((e) => readPhoneEntry(c ?? "IN", e.held ?? e.number))}
          />
          <Input label={`Mobile number (${dial})`} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" value={entry.number} onChangeText={changeNumber} placeholder="98765 43210" autoFocus />
          <ErrorText error={error ? errorMessage(error) : null} />
          <Button title="Send code" onPress={() => void request()} loading={busy} disabled={nationalDigits(entry).length < 6} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.muted }}>
            Enter the code sent to <Text style={{ fontWeight: "600", color: colors.text }}>{formatPhone(phone)}</Text>
            {channel === "whatsapp" ? " on WhatsApp" : channel === "sms" ? " by SMS" : ""}.
          </Text>
          {devCode && (
            <Text style={{ backgroundColor: "#fef3c7", color: "#92400e", padding: 8, borderRadius: 8, fontSize: 12 }}>
              Development mode: your code is <Text style={{ fontWeight: "700" }}>{devCode}</Text>
            </Text>
          )}
          <Input keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ""))} placeholder="••••••" style={{ textAlign: "center", fontSize: 24, letterSpacing: 8 }} autoFocus />
          <ErrorText error={error ? errorMessage(error) : null} />
          <Button title="Verify and continue" onPress={() => void verify()} loading={busy} disabled={code.length < 6} />
          <Pressable onPress={() => (cooldown > 0 ? undefined : void request())} disabled={cooldown > 0} accessibilityRole="button" hitSlop={8}>
            <Text style={{ textAlign: "center", color: cooldown > 0 ? colors.muted : theme.primary }}>{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}</Text>
          </Pressable>
          <Pressable onPress={() => setStep("phone")} accessibilityRole="button" hitSlop={8}>
            <Text style={{ textAlign: "center", color: colors.muted, fontSize: 12 }}>Change number</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}
