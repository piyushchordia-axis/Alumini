import { MAX_POLL_OPTIONS, MAX_POST_IMAGES, postCreateSchema, type PostCreateInput, type PostDto } from "@illuminize/shared";
import { useState } from "react";
import { Image, Pressable, Switch, Text, View } from "react-native";
import { Button, ChipSelect, ErrorText, Input, Muted, Row } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { colors } from "@/theme";
import { useFormErrors } from "./useFormErrors";

export function PostForm({ slug, placeholder, initial, submitLabel, note, onSubmit }: { slug: string; placeholder: string; initial?: PostDto; submitLabel: string; note?: string; onSubmit: (v: PostCreateInput) => Promise<void> }) {
  const [body, setBody] = useState(initial?.body ?? "");
  const [images, setImages] = useState<string[]>(initial?.imageUrls ?? []);
  // Polls are added when posting; editing a post keeps its poll as it was.
  const [poll, setPoll] = useState<{ options: string[]; allowsMultiple: boolean; closesInDays: "" | "1" | "3" | "7" } | null>(null);
  const upload = useImageUpload(slug);
  const { errors, serverError, busy, fromZod, run } = useFormErrors();
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
      });
      if (!parsed.success) return fromZod(parsed.error);
      await onSubmit(parsed.data);
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
            title="📷 Add image"
            variant="outline"
            loading={upload.busy}
            onPress={async () => {
              const url = await upload.pickAndUpload();
              if (url) setImages((i) => [...i, url].slice(0, MAX_POST_IMAGES));
            }}
          />
        )}
      </Row>
      {!initial && !poll && <Button title="📊 Add a poll" variant="ghost" onPress={() => setPoll({ options: ["", ""], allowsMultiple: false, closesInDays: "" })} />}
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
      {note ? <Muted>{note}</Muted> : null}
      <ErrorText error={serverError} />
      <Button title={submitLabel} onPress={() => void submit()} loading={busy} disabled={!body.trim() || (!!poll && poll.options.filter((o) => o.trim()).length < 2)} />
    </>
  );
}
