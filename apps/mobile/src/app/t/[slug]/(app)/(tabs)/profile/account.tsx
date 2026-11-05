import { formatPhone, type EmailStatusDto } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Card, ErrorText, Input, Muted, Screen, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/stores/authStore";
import { colors } from "@/theme";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Account settings: the email used for the digest and announcements (confirmed by a link). */
export default function AccountScreen() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const status = useQuery({ queryKey: qk.myEmail, queryFn: () => api.me.email.get() });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const done = (data: EmailStatusDto) => {
    qc.setQueryData(qk.myEmail, data);
    void qc.invalidateQueries({ queryKey: qk.me });
  };
  const send = useMutation({
    mutationFn: (email: string) => api.me.email.set(email),
    onSuccess: (data) => {
      done(data);
      setEditing(false);
      setValue("");
      if (data.pending) Alert.alert("Check your inbox", `We sent a confirmation link to ${data.pending.email}.`);
    },
    onError: (e) => {
      if (isApiClientError(e) && e.fieldErrors.email) setFieldError(e.fieldErrors.email);
      else Alert.alert("Could not send the link", errorMessage(e));
    },
  });
  const remove = useMutation({ mutationFn: () => api.me.email.remove(), onSuccess: done, onError: (e) => Alert.alert("Could not remove the email", errorMessage(e)) });

  const d = status.data;
  const showForm = editing || (d && !d.email && !d.pending);
  return (
    <Screen title="Email & account">
      <Card>
        <Text style={{ fontWeight: "700", color: colors.text }}>Email</Text>
        <Muted size={13}>For the weekly digest and announcements. Never shown to other members; shared by all your institutions.</Muted>
        {status.isLoading ? (
          <Spinner />
        ) : status.error ? (
          <ErrorText error={status.error} />
        ) : (
          <View style={{ gap: 10 }}>
            {d?.email && (
              <Text style={{ color: colors.text }}>
                <Text style={{ fontWeight: "600" }}>{d.email}</Text> <Text style={{ color: "#15803d" }}>· confirmed</Text>
              </Text>
            )}
            {d?.pending && (
              <View accessibilityRole="summary" style={{ backgroundColor: "#fffbeb", borderRadius: 8, padding: 10, gap: 6 }}>
                <Text style={{ color: "#78350f" }}>
                  We sent a confirmation link to <Text style={{ fontWeight: "600" }}>{d.pending.email}</Text>. Open it before {when(d.pending.expiresAt)}
                  {d.email ? ` — until then we keep using ${d.email}.` : "."}
                </Text>
                <Button title="Send the link again" variant="ghost" loading={send.isPending} onPress={() => send.mutate(d.pending!.email)} />
              </View>
            )}
            {showForm ? (
              <View style={{ gap: 8 }}>
                <Input
                  label={d?.email ? "New email address" : "Email address"}
                  value={value}
                  onChangeText={(t) => {
                    setValue(t);
                    setFieldError(undefined);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  placeholder="you@example.com"
                  error={fieldError}
                />
                <Button title="Send confirmation link" loading={send.isPending} disabled={!value.trim()} onPress={() => send.mutate(value)} />
                {editing && <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} />}
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Button title={d?.email ? "Change email" : "Use a different email"} variant="outline" onPress={() => setEditing(true)} />
                {(d?.email || d?.pending) && (
                  <Button
                    title="Remove email"
                    variant="ghost"
                    loading={remove.isPending}
                    onPress={() =>
                      Alert.alert("Remove your email?", "You'll stop getting the digest and announcement emails.", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
                      ])
                    }
                  />
                )}
              </View>
            )}
          </View>
        )}
      </Card>
      <Card>
        <Text style={{ fontWeight: "700", color: colors.text }}>Phone</Text>
        <Muted size={13}>{formatPhone(user?.phone)} · used to sign in</Muted>
      </Card>
    </Screen>
  );
}
