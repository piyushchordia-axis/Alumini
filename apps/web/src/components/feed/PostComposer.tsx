import { MAX_POST_IMAGES } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ImageUploader } from "@/components/common/ImageUploader";
import { Avatar, Button, Card, Textarea } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { toast } from "@/stores/uiStore";

export function PostComposer() {
  const { tenant, membership } = useMembership();
  const [body, setBody] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.posts.create(tenant.slug, { body: body.trim(), imageUrls: images }),
    onSuccess: (post) => {
      setBody("");
      setImages([]);
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
          <Textarea aria-label="New post" placeholder={`Share something with ${tenant.shortName ?? "the network"}…`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={3} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ImageUploader slug={tenant.slug} urls={images} onChange={setImages} max={MAX_POST_IMAGES} />
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!body.trim()}>
              Post
            </Button>
          </div>
          {membership.role !== "TENANT_ADMIN" && <p className="text-xs text-slate-400">Posts are subject to this institution's moderation settings.</p>}
        </div>
      </div>
    </Card>
  );
}
