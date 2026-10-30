import { MAX_POST_IMAGES } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { Button, Input, Muted, Row, Screen } from "@/components/ui";
import { useImageUpload } from "@/hooks/useImagePicker";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { colors } from "@/theme";

export default function NewPostScreen() {
  const { tenant, membership } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const upload = useImageUpload(tenant.slug);
  const create = useMutation({
    mutationFn: () => api.posts.create(tenant.slug, { body: body.trim(), imageUrls: images }),
    onSuccess: (post) => {
      void qc.invalidateQueries({ queryKey: ["posts", tenant.slug] });
      Alert.alert(post.moderationStatus === "PENDING" ? "Posted — awaiting admin approval" : "Posted!");
      router.back();
    },
    onError: (e) => Alert.alert("Could not post", errorMessage(e)),
  });
  return (
    <Screen>
      <Input placeholder={`Share something with ${tenant.shortName ?? "the network"}…`} value={body} onChangeText={setBody} multiline maxLength={5000} style={{ minHeight: 140 }} autoFocus />
      <Row>
        {images.map((u) => (
          <View key={u}>
            <Image source={{ uri: u }} style={{ width: 72, height: 72, borderRadius: 8 }} />
            <Pressable onPress={() => setImages(images.filter((x) => x !== u))} style={{ position: "absolute", top: -6, right: -6, backgroundColor: colors.text, borderRadius: 10, paddingHorizontal: 5 }}>
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
              if (url) setImages((i) => [...i, url]);
            }}
          />
        )}
      </Row>
      {membership.role !== "TENANT_ADMIN" && <Muted>Posts are subject to this institution&apos;s moderation settings.</Muted>}
      <Button title="Post" onPress={() => create.mutate()} loading={create.isPending} disabled={!body.trim()} />
    </Screen>
  );
}
