import { CAN_REFER_BADGE, JOB_TYPE_LABELS, MODERATION_STATUS_LABELS, STATUS_TONES, YOU_HAVE_THIS_TEXT, experienceLabel, jobPlaceLabel, jobSalaryText, nameWithYears, skillMatch, skillsMatchedFirst, type JobCardDto } from "@illuminize/shared";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { IconCheck, IconClock, IconJobs, IconWallet, type IconProps } from "@/components/icons";
import { CompanyLogo } from "@/components/jobs/CompanyLogo";
import { ModerationBadge, ModerationNote } from "@/components/ModerationBadge";
import { Badge, Card, Muted } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { timeAgo } from "@/lib/format";
import { jobHref } from "@/lib/referrals";
import { colors, radius, spacing, useTheme } from "@/theme";

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
 * so that card opens nothing. `kept`: the card is kept from the search before while this one's answer comes (Jobs), so
 * it's said to be busy.
 */
export function JobCard({ slug, job, kept = false }: { slug: string; job: JobCardDto; kept?: boolean }) {
  const router = useRouter();
  const theme = useTheme();
  const { membership } = useMembership();
  const place = jobPlaceLabel(job);
  const where = `${job.companyName}${place ? ` · ${place}` : ""}`;
  const pay = jobSalaryText(job) ?? job.salaryNote;
  const experience = experienceLabel(job.experienceMin, job.experienceMax);
  // The skills the reader has come first, marked as on the job's page, so they're among the few shown. Not on their own jobs.
  const matched = job.isMine ? [] : skillMatch(job.skills, membership.skills).matched;
  const shown = skillsMatchedFirst(job.skills, matched).slice(0, SHOWN_SKILLS);
  const more = job.skills.length - SHOWN_SKILLS;
  // A closed job takes no requests, whatever its poster offered.
  const referable = job.canRefer && !job.isClosed;
  const status = job.moderationStatus === "APPROVED" ? null : MODERATION_STATUS_LABELS[job.moderationStatus];
  const note = job.moderationNote && (job.moderationStatus === "REJECTED" || job.moderationStatus === "REMOVED") ? `Admin note: ${job.moderationNote}` : null;
  const skills = job.skills.length ? `Skills: ${[...shown.map(({ skill, matched: has }) => (has ? `${skill} ${YOU_HAVE_THIS_TEXT}` : skill)), ...(more > 0 ? [`${more} more`] : [])].join(", ")}` : null;
  const posted = `Posted by ${nameWithYears(job.author)} · ${timeAgo(job.createdAt)}`;
  // The card's name stands in for everything inside it, so it says all the card shows, in its order, title first.
  const name = [job.title, where, referable && CAN_REFER_BADGE, job.isClosed && "Closed", status, JOB_TYPE_LABELS[job.jobType], experience, pay, note, job.summary, skills, posted]
    .filter(Boolean)
    .join(", ");
  return (
    <Card onPress={job.moderationStatus === "REMOVED" ? undefined : () => router.push(jobHref(slug, job.id))} accessibilityLabel={name} busy={kept}>
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
        // One line, the chips shortening to fit, so a long skill or a mark never makes the card taller. The card's name
        // says which the reader has.
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {shown.map(({ skill, matched: has }) => (
            <View
              key={skill}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 2,
                flexShrink: 1,
                minWidth: 0,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: has ? theme.primaryEdge : STATUS_TONES.neutral.edge,
                backgroundColor: has ? theme.primarySoft : STATUS_TONES.neutral.fill,
                paddingHorizontal: 7,
                paddingVertical: 1,
              }}
            >
              {has && <IconCheck size={12} strokeWidth={2.5} color={theme.primaryInk} />}
              <Text numberOfLines={1} style={[{ flexShrink: 1, fontSize: 12, color: STATUS_TONES.neutral.ink }, has ? { fontWeight: "600", color: theme.primaryInk } : null]}>
                {skill}
              </Text>
            </View>
          ))}
          {more > 0 && <Text style={{ flexShrink: 0, fontSize: 12, color: colors.muted }}>+{more} more</Text>}
        </View>
      )}
      <Muted>{posted}</Muted>
    </Card>
  );
}
