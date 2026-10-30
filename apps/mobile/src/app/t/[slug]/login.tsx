import { COUNTRIES } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Button, ChipSelect, ErrorText, Input, Screen, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { toE164 } from "@/lib/format";
import { useAuthStore } from "@/stores/authStore";
import { colors, useTheme } from "@/theme";

const TOP_DIALS = ["+91", "+1", "+44", "+971", "+65", "+61", "+49", "+966"];

export default function LoginScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const theme = useTheme();
  const setSession = useAuthStore((s) => s.setSession);
  const [dial, setDial] = useState<string>("+91");
  const [number, setNumber] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [channel, setChannel] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const phone = toE164(dial, number);

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
      router.replace(!m ? `/t/${slug}/register` : m.status === "APPROVED" ? `/t/${slug}/feed` : `/t/${slug}/pending`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const dials = COUNTRIES.filter((c) => TOP_DIALS.includes(c.dial)).map((c) => ({ value: c.dial, label: `${c.code} ${c.dial}` }));

  return (
    <Screen>
      <Title sub="We'll send a one-time code on WhatsApp (SMS fallback).">Sign in</Title>
      {step === "phone" ? (
        <View style={{ gap: 12 }}>
          <ChipSelect label="Country" options={dials} value={dial} onChange={(v) => setDial(v || "+91")} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {COUNTRIES.filter((c) => !TOP_DIALS.includes(c.dial)).map((c) => (
              <Pressable key={c.code} onPress={() => setDial(c.dial)}>
                <Text style={{ color: dial === c.dial ? theme.primary : colors.faint, fontSize: 12 }}>
                  {c.code} {c.dial}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Input label={`Mobile number (${dial})`} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" value={number} onChangeText={(v) => setNumber(v.replace(/[^\d\s-]/g, ""))} placeholder="98765 43210" autoFocus />
          <ErrorText error={error ? errorMessage(error) : null} />
          <Button title="Send code" onPress={() => void request()} loading={busy} disabled={number.replace(/\D/g, "").length < 6} />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.muted }}>
            Enter the code sent to <Text style={{ fontWeight: "600", color: colors.text }}>{phone}</Text>
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
          <Pressable onPress={() => (cooldown > 0 ? undefined : void request())} disabled={cooldown > 0}>
            <Text style={{ textAlign: "center", color: cooldown > 0 ? colors.faint : theme.primary }}>{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}</Text>
          </Pressable>
          <Pressable onPress={() => setStep("phone")}>
            <Text style={{ textAlign: "center", color: colors.muted, fontSize: 12 }}>Change number</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}
