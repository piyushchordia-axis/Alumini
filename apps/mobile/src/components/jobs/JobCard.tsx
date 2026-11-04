import { CAN_REFER_BADGE, JOB_TYPE_LABELS, MODERATION_STATUS_LABELS, experienceLabel, jobPlaceLabel, jobSalaryText, type JobCardDto } from "@illuminize/shared";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { IconClock, IconJobs, IconWallet, type IconProps } from "@/components/icons";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { Badge, Card, Muted } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { jobHref } from "@/lib/referrals";
import { colors, radius, spacing } from "@/theme";

const SHOWN_SKILLS = 3;

function Meta({ Icon, text }: { Icon: (p: IconProps) => ReactElement; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" }}>
      <Icon size={14} color={colors.faint} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: "#475569" }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * A job in a list (the Jobs tab and My posts), as on the web app. The title comes first, so it starts the card's name; the
 * logo (hidden from screen readers) comes after it and is drawn on the left. A removed job's page 404s even for its poster,
 * so that card opens nothing.
 */
export function JobCard({ slug, job }: { slug: string; job: JobCardDto }) {
  const router = useRouter();
  const place = jobPlaceLabel(job);
  const where = `${job.companyName}${place ? ` · ${place}` : ""}`;
  const pay = jobSalaryText(job) ?? job.salaryNote;
  const experience = experienceLabel(job.experienceMin, job.experienceMax);
  const more = job.skills.length - SHOWN_SKILLS;
  // A closed job takes no requests, whatever its poster offered.
  const referable = job.canRefer && !job.isClosed;
  const status = job.moderationStatus === "APPROVED" ? null : MODERATION_STATUS_LABELS[job.moderationStatus];
  const note = job.moderationNote && (job.moderationStatus === "REJECTED" || job.moderationStatus === "REMOVED") ? `Admin note: ${job.moderationNote}` : null;
  const skills = job.skills.length ? `Skills: ${[...job.skills.slice(0, SHOWN_SKILLS), ...(more > 0 ? [`${more} more`] : [])].join(", ")}` : null;
  const posted = `Posted by ${job.author.fullName} (batch of ${job.author.batchYear}) · ${timeAgo(job.createdAt)}`;
  // The card's name stands in for everything inside it, so it says all the card shows, in its order, title first.
  const name = [job.title, where, referable && CAN_REFER_BADGE, job.isClosed && "Closed", status, JOB_TYPE_LABELS[job.jobType], experience, pay, note, job.summary, skills, posted]
    .filter(Boolean)
    .join(", ");
  return (
    <Card onPress={job.moderationStatus === "REMOVED" ? undefined : () => router.push(jobHref(slug, job.id))} accessibilityLabel={name}>
      <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }} numberOfLines={2}>
            {job.title}
          </Text>
          <Text style={{ fontSize: 13, color: "#475569" }} numberOfLines={1}>
            {where}
          </Text>
          {/* The badges have a line of their own, so a long title keeps the width. */}
          {(referable || job.isClosed || status) && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {referable && <Badge label={CAN_REFER_BADGE} tone="success" />}
              {job.isClosed && <Badge label="Closed" />}
              <ModerationBadge status={job.moderationStatus} />
            </View>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.md, rowGap: 2 }}>
            <Meta Icon={IconJobs} text={JOB_TYPE_LABELS[job.jobType]} />
            {experience && <Meta Icon={IconClock} text={experience} />}
            {pay && <Meta Icon={IconWallet} text={pay} />}
          </View>
        </View>
        <CompanyLogo name={job.companyName} src={job.companyLogoUrl} size="sm" />
      </View>
      <ModerationNote status={job.moderationStatus} note={job.moderationNote} />
      {!!job.summary && (
        <Text numberOfLines={2} style={{ fontSize: 14, color: "#475569" }}>
          {job.summary}
        </Text>
      )}
      {job.skills.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {job.skills.slice(0, SHOWN_SKILLS).map((skill) => (
            <View key={skill} style={{ maxWidth: "100%", borderRadius: radius.full, backgroundColor: "#f1f5f9", paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text numberOfLines={1} style={{ fontSize: 12, color: "#334155" }}>
                {skill}
              </Text>
            </View>
          ))}
          {more > 0 && <Text style={{ fontSize: 12, color: colors.muted }}>+{more} more</Text>}
        </View>
      )}
      <Muted>{posted}</Muted>
    </Card>
  );
}
