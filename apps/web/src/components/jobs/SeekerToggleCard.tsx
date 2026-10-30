import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card, Checkbox, FormField, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function SeekerToggleCard({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: qk.mySeeker(slug), queryFn: () => api.jobs.seekers.me(slug) });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [roles, setRoles] = useState("");
  const [locations, setLocations] = useState("");
  const [active, setActive] = useState(true);
  const openEditor = () => {
    if (mine.data) {
      setNote(mine.data.note);
      setRoles(mine.data.preferredRoles ?? "");
      setLocations(mine.data.preferredLocations ?? "");
      setActive(mine.data.isActive);
    }
    setOpen((o) => !o);
  };
  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.mySeeker(slug) });
    void qc.invalidateQueries({ queryKey: qk.seekers(slug) });
    void qc.invalidateQueries({ queryKey: ["directory", slug] });
  };
  const save = useMutation({
    mutationFn: () => api.jobs.seekers.upsert(slug, { note: note.trim(), preferredRoles: roles || null, preferredLocations: locations || null, isActive: active }),
    onSuccess: () => {
      done();
      setOpen(false);
      toast.success("Saved");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.jobs.seekers.remove(slug),
    onSuccess: () => {
      done();
      setOpen(false);
      toast.success("Removed");
    },
  });

  return (
    <Card className="border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">{mine.data?.isActive ? "You're open to work ✅" : "Looking for a job?"}</h3>
          <p className="text-sm text-slate-600">Let alumni know what you're looking for; your card shows in the directory with an “open to work” tag.</p>
        </div>
        <Button variant={mine.data?.isActive ? "outline" : "primary"} size="sm" onClick={openEditor}>
          {mine.data ? "Edit" : "I'm looking for work"}
        </Button>
      </div>
      {open && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormField label="What are you looking for?" required>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="e.g. Senior backend roles in fintech, open to relocation" />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Preferred roles">
              <Input value={roles} onChange={(e) => setRoles(e.target.value)} />
            </FormField>
            <FormField label="Preferred locations">
              <Input value={locations} onChange={(e) => setLocations(e.target.value)} />
            </FormField>
          </div>
          <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} label="Show me in the 'looking for work' list" />
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending} disabled={!note.trim()}>
              Save
            </Button>
            {mine.data && (
              <Button type="button" variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
                Remove
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
