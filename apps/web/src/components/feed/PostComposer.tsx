import {
  ANNOUNCEMENT_NO_CHANNELS,
  ANNOUNCEMENT_ONE_MESSAGE,
  ANNOUNCEMENT_PIN_LABEL,
  MAX_POLL_OPTIONS,
  MAX_POST_IMAGES,
  announcementChannelLabel,
  announcementConfirmCopy,
  announcementReachText,
  postCreatedText,
  type MessageChannel,
  type PollCreateInput,
} from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ImageUploader } from "@/components/common/ImageUploader";
import { IconAnnounce, IconPoll } from "@/components/icons";
import { Avatar, Button, Card, Checkbox, Input, Select, Textarea } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function PostComposer() {
  const { tenant, membership } = useMembership();
  const [body, setBody] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [poll, setPoll] = useState<{ options: string[]; allowsMultiple: boolean; closesInDays: string } | null>(null);
  const isAdmin = membership.role === "TENANT_ADMIN";
  const [announceChoice, setAnnounce] = useState<{ pin: boolean; channels: MessageChannel[] } | null>(null);
  // Only while the composer may offer it: an admin who loses the role mid-post is left with a normal post to send.
  const announce = isAdmin ? announceChoice : null;
  const audience = useQuery({ queryKey: qk.admin.announcementAudience(tenant.slug), queryFn: () => api.admin.announcements.audience(tenant.slug), enabled: !!announce });
  const reach = audience.data;
  const [confirming, setConfirming] = useState(false);
  const billed = announce ? announcementConfirmCopy(reach, announce.channels) : null;
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
    mutationFn: () => api.posts.create(tenant.slug, { body: body.trim(), imageUrls: images, poll: pollInput(), ...(announce ? { announcement: announce } : {}) }),
    onSuccess: (post) => {
      setBody("");
      setImages([]);
      setPoll(null);
      setAnnounce(null);
      void qc.invalidateQueries({ queryKey: ["posts", tenant.slug] });
      toast.success(postCreatedText(post));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card elevation={2} className="overflow-hidden p-0">
      <div className="flex items-start gap-3 p-4 pb-3">
        <Avatar name={membership.fullName} src={membership.avatarUrl} className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-3">
          <Textarea
            aria-label="New post"
            placeholder={poll ? "Ask a question…" : `Share something with ${tenant.shortName ?? "the network"}…`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            rows={3}
            className="border-0 bg-transparent px-0 shadow-none focus:ring-0"
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
          {announce && (
            <fieldset className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <legend className="flex items-center gap-1.5 px-1 font-medium text-slate-800">
                <IconAnnounce size={16} /> Announcement
              </legend>
              <p className="text-slate-600">{announcementReachText(reach)}</p>
              <Checkbox label={ANNOUNCEMENT_PIN_LABEL} checked={announce.pin} onChange={(e) => setAnnounce({ ...announce, pin: e.target.checked })} />
              {reach?.channels.map((c) => (
                <Checkbox
                  key={c}
                  label={announcementChannelLabel(c, reach)}
                  checked={announce.channels.includes(c)}
                  onChange={(e) => setAnnounce({ ...announce, channels: e.target.checked ? [...announce.channels, c] : announce.channels.filter((x) => x !== c) })}
                />
              ))}
              {reach && reach.channels.length > 1 && <p className="text-xs text-slate-500">{ANNOUNCEMENT_ONE_MESSAGE}</p>}
              {reach && reach.channels.length === 0 && <p className="text-xs text-slate-500">{ANNOUNCEMENT_NO_CHANNELS}</p>}
            </fieldset>
          )}
          {images.length > 0 && <ImageUploader slug={tenant.slug} urls={images} onChange={setImages} max={MAX_POST_IMAGES} showTrigger={false} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/80 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <ImageUploader slug={tenant.slug} urls={images} onChange={setImages} max={MAX_POST_IMAGES} showPreviews={false} />
          {isAdmin && (
            <Button variant="ghost" size="sm" aria-pressed={!!announce} className="gap-1.5" onClick={() => setAnnounce(announce ? null : { pin: true, channels: [] })}>
              <IconAnnounce size={16} />
              {announce ? "Undo announce" : "Announce"}
            </Button>
          )}
          <Button variant="ghost" size="sm" aria-pressed={!!poll} className="gap-1.5" onClick={() => setPoll(poll ? null : { options: ["", ""], allowsMultiple: false, closesInDays: "" })}>
            <IconPoll size={16} />
            {poll ? "Remove poll" : "Poll"}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {membership.role !== "TENANT_ADMIN" && <p className="hidden text-xs text-slate-400 sm:block">Subject to moderation</p>}
          <Button
            onClick={() => (billed ? setConfirming(true) : create.mutate())}
            loading={create.isPending}
            disabled={!body.trim() || !pollReady}
          >
            {announce ? "Post announcement" : "Post"}
          </Button>
        </div>
      </div>
      {billed && (
        <ConfirmDialog
          open={confirming}
          title={billed.title}
          body={billed.body}
          confirmLabel={billed.confirm}
          busy={create.isPending}
          onConfirm={() => create.mutate(undefined, { onSettled: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Card>
  );
}
