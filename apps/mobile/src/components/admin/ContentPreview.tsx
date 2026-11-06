import {
  GROUP_APPROVED_BEFORE_TEXT,
  GROUP_PREVIEW_NOTE,
  businessContactLines,
  businessSummaryText,
  contentPreviewKind,
  groupBeingEdited,
  groupSummaryText,
  type BusinessDto,
  type ChatGroupContentDto,
  type ContentDto,
  type ContentType,
  type JobDto,
  type PostDto,
} from "@illuminize/shared";
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { JobApplyArea } from "@/components/jobs/JobApplyArea";
import { AboutCompany, JobDetails } from "@/components/jobs/JobDetails";
import { colors, radius, spacing } from "@/theme";

function GroupPreview({ group }: { group: ChatGroupContentDto }) {
  return (
    <View style={styles.stack}>
      <Text selectable style={styles.name}>
        {group.name}
      </Text>
      <Text style={styles.meta}>{groupSummaryText(group)}</Text>
      {group.description ? (
        <Text selectable style={styles.body}>
          {group.description}
        </Text>
      ) : null}
      {groupBeingEdited(group) && (
        <View style={styles.before}>
          <Text style={styles.beforeLabel}>{GROUP_APPROVED_BEFORE_TEXT}</Text>
          <Text selectable style={styles.name}>
            {group.approvedName}
          </Text>
          {group.approvedDescription ? (
            <Text selectable style={styles.body}>
              {group.approvedDescription}
            </Text>
          ) : null}
        </View>
      )}
      <Text style={styles.note}>{GROUP_PREVIEW_NOTE}</Text>
    </View>
  );
}

/** A listing with what the list doesn't show: its contact details, as text to select, never links. */
function BusinessPreview({ business }: { business: BusinessDto }) {
  return (
    <View style={styles.stack}>
      {business.logoUrl ? <Image source={{ uri: business.logoUrl }} contentFit="cover" accessible={false} alt="" style={styles.logo} /> : null}
      <Text selectable style={styles.name}>
        {business.name}
      </Text>
      <Text style={styles.meta}>{businessSummaryText(business)}</Text>
      <Text selectable style={styles.body}>
        {business.description}
      </Text>
      {businessContactLines(business).map((line) => (
        <Text key={line} selectable style={styles.meta}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** The post's words, and its photos small; screen readers skip the photos, which add nothing to judge by ear. */
function PostPreview({ post }: { post: PostDto }) {
  return (
    <View style={styles.stack}>
      <Text selectable style={styles.body}>
        {post.body}
      </Text>
      {post.imageUrls.length > 0 && (
        <View aria-hidden style={styles.thumbs}>
          {post.imageUrls.map((uri) => (
            <Image key={uri} source={{ uri }} contentFit="cover" accessible={false} alt="" style={styles.thumb} />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * The whole job as its page shows it, with its contacts and website as text and its How to apply even once closed: all
 * of what's approved, and no member's view of it (no skills compared, no admin's note).
 */
function JobPreview({ job }: { job: JobDto }) {
  const [now] = useState(() => Date.now());
  return (
    <View style={{ gap: spacing.md }}>
      <JobDetails job={job} now={now} level={2} showClosedSections apply={<JobApplyArea job={job} now={now} plain />} />
      <AboutCompany job={job} level={2} plain framed={false} />
    </View>
  );
}

/** An item as the admin reviews it, by its type (contentPreviewKind): the web console's preview. */
export function ContentPreview({ type, content }: { type: ContentType; content: ContentDto }) {
  const preview = contentPreviewKind(type, content);
  if (!preview) return null;
  switch (preview.kind) {
    case "group":
      return <GroupPreview group={preview.content} />;
    case "business":
      return <BusinessPreview business={preview.content} />;
    case "post":
      return <PostPreview post={preview.content} />;
    case "job":
      return <JobPreview job={preview.content} />;
    case "text":
      return (
        <Text selectable style={styles.body}>
          {preview.text}
        </Text>
      );
  }
}

const styles = StyleSheet.create({
  stack: { gap: spacing.xs },
  name: { fontSize: 14, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.muted },
  body: { fontSize: 14, lineHeight: 20, color: "#1e293b" },
  note: { fontSize: 12, color: colors.muted, marginTop: spacing.xs },
  before: { gap: spacing.xs, marginTop: spacing.xs, padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  beforeLabel: { fontSize: 12, fontWeight: "600", color: colors.muted },
  logo: { width: 64, height: 64, borderRadius: radius.sm },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  thumb: { width: 80, height: 80, borderRadius: radius.sm, backgroundColor: colors.bg },
});
