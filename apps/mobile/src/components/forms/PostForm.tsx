import { MAX_POLL_OPTIONS, MAX_POST_IMAGES, announcementConfirmCopy, postCreateSchema, type AnnouncementOptions, type PostCreateInput, type PostDto } from "@illuminize/shared";
import { useState } from "react";
import { Image, Pressable, Switch, Text, View } from "react-native";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { IconAnnounce, IconImage, IconPoll } from "@/components/icons";
import { Button, ChipSelect, ErrorText, Input, Muted, Row, toggleState } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { colors } from "@/theme";
import { AnnouncementPanel, useAnnouncementAudience } from "./AnnouncementPanel";
import { useFormErrors } from "./useFormErrors";

/**
 * `canAnnounce` offers Announce, for a new post by the institution's own admin: the API refuses anyone else, platform
 * staff included.
 */
export function PostForm({
  slug,
  placeholder,
  initial,
  submitLabel,
  note,
  canAnnounce = false,
  onSubmit,
}: {
  slug: string;
  placeholder: string;
  initial?: PostDto;
  submitLabel: string;
  note?: string;
  canAnnounce?: boolean;
  onSubmit: (v: PostCreateInput) => Promise<void>;
}) {
  const [body, setBody] = useState(initial?.body ?? "");
  const [images, setImages] = useState<string[]>(initial?.imageUrls ?? []);
  // Polls are added when posting; editing a post keeps its poll as it was.
  const [poll, setPoll] = useState<{ options: string[]; allowsMultiple: boolean; closesInDays: "" | "1" | "3" | "7" } | null>(null);
  const [announceChoice, setAnnounce] = useState<AnnouncementOptions | null>(null);
  // Only while the form may offer it: an admin who loses the role mid-post (the membership refetched) is left with a
  // normal post they can still send, not an announcement the API refuses and no button to undo it.
  const announce = canAnnounce ? announceChoice : null;
  const audience = useAnnouncementAudience(slug, !!announce);
  // What was checked and is waiting for the admin to confirm the billed channels.
  const [confirming, setConfirming] = useState<PostCreateInput | null>(null);
  const billed = announce ? announcementConfirmCopy(audience.data, announce.channels) : null;
  const upload = useImageUpload(slug);
  const { errors, serverError, busy, fromZod, run } = useFormErrors();
  const send = async (input: PostCreateInput) => {
    await run(() => onSubmit(input));
    setConfirming(null);
  };
  const submit = () =>
    run(async () => {
      const parsed = postCreateSchema.safeParse({
        body,
        imageUrls: images,
        ...(poll
          ? {
              poll: {
                options: poll.options.map((o) => o.trim()).filter(Boolean),
                allowsMultiple: poll.allowsMultiple,
                closesAt: poll.closesInDays ? new Date(Date.now() + Number(poll.closesInDays) * 86_400_000).toISOString() : null,
              },
            }
          : {}),
        ...(announce ? { announcement: announce } : {}),
      });
      if (!parsed.success) return fromZod(parsed.error);
      if (billed) setConfirming(parsed.data);
      else await onSubmit(parsed.data);
    });
  return (
    <>
      <Input accessibilityLabel="Post text" placeholder={placeholder} value={body} onChangeText={setBody} multiline maxLength={5000} style={{ minHeight: 140 }} autoFocus={!initial} error={errors.body} />
      <Row>
        {images.map((u) => (
          <View key={u}>
            <Image source={{ uri: u }} style={{ width: 72, height: 72, borderRadius: 8 }} accessibilityIgnoresInvertColors />
            <Pressable onPress={() => setImages(images.filter((x) => x !== u))} accessibilityRole="button" accessibilityLabel="Remove image" hitSlop={8} style={{ position: "absolute", top: -6, right: -6, backgroundColor: colors.text, borderRadius: 10, paddingHorizontal: 5 }}>
              <Text style={{ color: "#fff", fontSize: 11 }}>✕</Text>
            </Pressable>
          </View>
        ))}
        {images.length < MAX_POST_IMAGES && (
          <Button
            title="Add image"
            icon={(c) => <IconImage size={18} color={c} />}
            variant="outline"
            loading={upload.busy}
            onPress={async () => {
              const url = await upload.pickAndUpload();
              if (url) setImages((i) => [...i, url].slice(0, MAX_POST_IMAGES));
            }}
          />
        )}
      </Row>
      <ErrorText error={upload.error} />
      {!initial && (!poll || canAnnounce) && (
        <Row>
          {!poll && <Button title="Add a poll" icon={(c) => <IconPoll size={18} color={c} />} variant="ghost" onPress={() => setPoll({ options: ["", ""], allowsMultiple: false, closesInDays: "" })} />}
          {canAnnounce && <Button title={announce ? "Undo announce" : "Announce"} icon={(c) => <IconAnnounce size={18} color={c} />} variant="ghost" {...toggleState(!!announce)} onPress={() => setAnnounce(announce ? null : { pin: true, channels: [] })} />}
        </Row>
      )}
      {poll && (
        <View style={{ gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontWeight: "700", color: colors.text }}>Poll options</Text>
          {poll.options.map((o, i) => (
            <Row key={i}>
              <View style={{ flex: 1 }}>
                <Input accessibilityLabel={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} value={o} maxLength={80} onChangeText={(t) => setPoll({ ...poll, options: poll.options.map((x, j) => (j === i ? t : x)) })} />
              </View>
              {poll.options.length > 2 && (
                <Pressable onPress={() => setPoll({ ...poll, options: poll.options.filter((_, j) => j !== i) })} accessibilityRole="button" accessibilityLabel={`Remove option ${i + 1}`} hitSlop={8}>
                  <Text style={{ color: colors.muted }}>✕</Text>
                </Pressable>
              )}
            </Row>
          ))}
          {poll.options.length < MAX_POLL_OPTIONS && <Button title="+ Add option" variant="ghost" onPress={() => setPoll({ ...poll, options: [...poll.options, ""] })} />}
          <Row style={{ justifyContent: "space-between" }}>
            <Text style={{ color: colors.text }}>Allow several choices</Text>
            <Switch value={poll.allowsMultiple} onValueChange={(v) => setPoll({ ...poll, allowsMultiple: v })} />
          </Row>
          <ChipSelect
            label="Closes"
            options={[
              { value: "1", label: "In 1 day" },
              { value: "3", label: "In 3 days" },
              { value: "7", label: "In a week" },
            ]}
            value={poll.closesInDays}
            onChange={(v) => setPoll({ ...poll, closesInDays: v })}
            allowEmpty
          />
          {errors.poll ? <Text style={{ color: colors.danger, fontSize: 12 }}>{errors.poll}</Text> : null}
          <Button title="Remove poll" variant="ghost" onPress={() => setPoll(null)} />
        </View>
      )}
      {announce && <AnnouncementPanel value={announce} onChange={setAnnounce} audience={audience.data} error={errors.announcement} />}
      {note ? <Muted>{note}</Muted> : null}
      <ErrorText error={serverError} />
      <Button title={announce ? "Post announcement" : submitLabel} onPress={() => void submit()} loading={busy} disabled={!body.trim() || (!!poll && poll.options.filter((o) => o.trim()).length < 2)} />
      {billed && (
        <ConfirmSheet
          open={!!confirming}
          title={billed.title}
          body={billed.body}
          confirmLabel={billed.confirm}
          busy={busy}
          onConfirm={() => {
            if (confirming) void send(confirming);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
