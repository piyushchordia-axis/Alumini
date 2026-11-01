import { MAX_POLL_OPTIONS, MAX_POST_IMAGES, type PollCreateInput } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ImageUploader } from "@/components/common/ImageUploader";
import { Avatar, Button, Card, Checkbox, Input, Select, Textarea } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { toast } from "@/stores/uiStore";

export function PostComposer() {
  const { tenant, membership } = useMembership();
  const [body, setBody] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [poll, setPoll] = useState<{ options: string[]; allowsMultiple: boolean; closesInDays: string } | null>(null);
  const qc = useQueryClient();
  const pollInput = (): PollCreateInput | undefined =>
    poll
      ? {
          options: poll.options.map((o) => o.trim()).filter(Boolean),
          allowsMultiple: poll.allowsMultiple,
          closesAt: poll.closesInDays ? new Date(Date.now() + Number(poll.closesInDays) * 86_400_000).toISOString() : null,
        }
      : undefined;
  const pollReady = !poll || poll.options.filter((o) => o.trim()).length >= 2;
  const create = useMutation({
    mutationFn: () => api.posts.create(tenant.slug, { body: body.trim(), imageUrls: images, poll: pollInput() }),
    onSuccess: (post) => {
      setBody("");
      setImages([]);
      setPoll(null);
      void qc.invalidateQueries({ queryKey: ["posts", tenant.slug] });
      toast.success(post.moderationStatus === "PENDING" ? "Posted — awaiting admin approval" : "Posted!");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="p-4">
      <div className="flex gap-3">
        <Avatar name={membership.fullName} src={membership.avatarUrl} />
        <div className="flex-1 space-y-3">
          <Textarea
            aria-label="New post"
            placeholder={poll ? "Ask a question…" : `Share something with ${tenant.shortName ?? "the network"}…`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            rows={3}
          />
          {poll && (
            <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium text-slate-700">Poll options</legend>
              {poll.options.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    aria-label={`Option ${i + 1}`}
                    placeholder={`Option ${i + 1}`}
                    value={o}
                    maxLength={80}
                    onChange={(e) => setPoll({ ...poll, options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                  {poll.options.length > 2 && (
                    <Button variant="ghost" aria-label={`Remove option ${i + 1}`} onClick={() => setPoll({ ...poll, options: poll.options.filter((_, j) => j !== i) })}>
                      ✕
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                {poll.options.length < MAX_POLL_OPTIONS && (
                  <Button variant="ghost" size="sm" onClick={() => setPoll({ ...poll, options: [...poll.options, ""] })}>
                    + Add option
                  </Button>
                )}
                <Checkbox label="Allow several choices" checked={poll.allowsMultiple} onChange={(e) => setPoll({ ...poll, allowsMultiple: e.target.checked })} />
                <Select aria-label="Poll closes" value={poll.closesInDays} onChange={(e) => setPoll({ ...poll, closesInDays: e.target.value })} className="w-auto">
                  <option value="">No end date</option>
                  <option value="1">Closes in 1 day</option>
                  <option value="3">Closes in 3 days</option>
                  <option value="7">Closes in a week</option>
                </Select>
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <ImageUploader slug={tenant.slug} urls={images} onChange={setImages} max={MAX_POST_IMAGES} />
              <Button variant="ghost" size="sm" aria-pressed={!!poll} onClick={() => setPoll(poll ? null : { options: ["", ""], allowsMultiple: false, closesInDays: "" })}>
                📊 {poll ? "Remove poll" : "Poll"}
              </Button>
            </div>
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!body.trim() || !pollReady}>
              Post
            </Button>
          </div>
          {membership.role !== "TENANT_ADMIN" && <p className="text-xs text-slate-400">Posts are subject to this institution's moderation settings.</p>}
        </div>
      </div>
    </Card>
  );
}
