import type { JobSeekerDto } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Switch, Text } from "react-native";
import { Button, Input, Row, Screen, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { colors, useTheme } from "@/theme";

export default function SeekerScreen() {
  const { tenant } = useMembership();
  const mine = useQuery({ queryKey: qk.mySeeker(tenant.slug), queryFn: () => api.jobs.seekers.me(tenant.slug) });
  if (mine.isLoading) return <Spinner />;
  return <SeekerForm slug={tenant.slug} initial={mine.data ?? null} />;
}

function SeekerForm({ slug, initial }: { slug: string; initial: JobSeekerDto | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const theme = useTheme();
  const [note, setNote] = useState(initial?.note ?? "");
  const [roles, setRoles] = useState(initial?.preferredRoles ?? "");
  const [locations, setLocations] = useState(initial?.preferredLocations ?? "");
  const [active, setActive] = useState(initial?.isActive ?? true);
  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.mySeeker(slug) });
    void qc.invalidateQueries({ queryKey: qk.seekers(slug) });
    void qc.invalidateQueries({ queryKey: ["directory", slug] });
    router.back();
  };
  const save = useMutation({
    mutationFn: () => api.jobs.seekers.upsert(slug, { note: note.trim(), preferredRoles: roles || null, preferredLocations: locations || null, isActive: active }),
    onSuccess: done,
    onError: (e) => Alert.alert("Could not save", errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: () => api.jobs.seekers.remove(slug), onSuccess: done });
  return (
    <Screen>
      <Text style={{ color: colors.muted }}>Let alumni know what you&apos;re looking for. Your directory card gets an “open to work” tag.</Text>
      <Input label="What are you looking for? *" value={note} onChangeText={setNote} multiline maxLength={500} placeholder="e.g. Senior backend roles in fintech, open to relocation" />
      <Input label="Preferred roles" value={roles} onChangeText={setRoles} />
      <Input label="Preferred locations" value={locations} onChangeText={setLocations} />
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={{ color: colors.text }}>Show me in the list</Text>
        <Switch value={active} onValueChange={setActive} trackColor={{ true: theme.primary }} />
      </Row>
      <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={!note.trim()} />
      {initial && <Button title="Remove my listing" variant="ghost" onPress={() => remove.mutate()} loading={remove.isPending} />}
    </Screen>
  );
}
