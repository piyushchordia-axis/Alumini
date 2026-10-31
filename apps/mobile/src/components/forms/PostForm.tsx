import { MAX_POST_IMAGES, postCreateSchema, type PostCreateInput, type PostDto } from "@illuminize/shared";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Button, ErrorText, Input, Muted, Row } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { colors } from "@/theme";
import { useFormErrors } from "./useFormErrors";

export function PostForm({ slug, placeholder, initial, submitLabel, note, onSubmit }: { slug: string; placeholder: string; initial?: PostDto; submitLabel: string; note?: string; onSubmit: (v: PostCreateInput) => Promise<void> }) {
  const [body, setBody] = useState(initial?.body ?? "");
  const [images, setImages] = useState<string[]>(initial?.imageUrls ?? []);
  const upload = useImageUpload(slug);
  const { errors, serverError, busy, fromZod, run } = useFormErrors();
  const submit = () =>
    run(async () => {
      const parsed = postCreateSchema.safeParse({ body, imageUrls: images });
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
      {note ? <Muted>{note}</Muted> : null}
      <ErrorText error={serverError} />
      <Button title={submitLabel} onPress={() => void submit()} loading={busy} disabled={!body.trim()} />
    </>
  );
}
