import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  MARITAL_STATUSES,
  MARITAL_STATUS_LABELS,
  OPEN_TO,
  OPEN_TO_LABELS,
  PROFESSION_TYPES,
  PROFESSION_TYPE_LABELS,
  PROFILE_DEGREE_MAX_LENGTH,
  PROFILE_HEADLINE_MAX_LENGTH,
  PROFILE_MAX_SKILLS,
  RICH_TEXT_HINT,
  SKILL_MAX_LENGTH,
  memberEndYearOptions,
  memberStartYearOptions,
  memberYearFields,
  mentorshipAvailable,
  mentorshipKeys,
  socialUrlFromInput,
  type ProfileLinkKey,
} from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { ReactNode, RefObject } from "react";
import { Pressable, StyleSheet, Switch, Text, View, type KeyboardTypeOptions } from "react-native";
import { CountryPicker } from "@/components/CountryPicker";
import { CustomFieldInputs } from "@/components/CustomFieldInputs";
import { DateTimeField } from "@/components/DateTimeField";
import { IconChevronDown } from "@/components/icons";
import { OptionPicker } from "@/components/OptionPicker";
import { AvatarPicker } from "@/components/profile/AvatarPicker";
import { EducationListInput, ExperienceListInput } from "@/components/profile/HistoryListInputs";
import { LINK_KINDS, yearDigits, type ProfileDraftController } from "@/components/profile/useProfileDraft";
import { SkillsInput, type SkillsInputHandle } from "@/components/SkillsInput";
import { Chip, ChipSelect, Input, Muted, Row, headingRole } from "@/components/ui";
import { api } from "@/lib/api";
import { mentorsHref } from "@/lib/mentors";
import { colors, radius, spacing, useTheme } from "@/theme";

const INDUSTRY_OPTIONS = INDUSTRIES.map((i) => ({ value: i, label: INDUSTRY_LABELS[i] }));

function SubHeading({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text {...headingRole(3)} style={styles.subheading}>
        {children}
      </Text>
      {hint ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

/** The years a year box takes, as its hint: "1930 – 2026", from a picker's list, newest first. */
const yearRange = (years: number[]) => (years.length ? `${years[years.length - 1]} – ${years[0]}` : undefined);

/** Photo, name, years here, what they do, date of birth, where they live, and every question registration requires. */
export function ProfileBasicsSection({ form: f }: { form: ProfileDraftController }) {
  const { draft: d, set, errors } = f;
  const years = memberYearFields(f.tenant.type);
  return (
    <View style={styles.stack}>
      <AvatarPicker slug={f.tenant.slug} name={d.fullName} value={d.avatarUrl} error={errors.avatarUrl} onBusyChange={f.setPhotoBusy} onChange={f.setAvatar} />
      <Input label="Full name *" value={d.fullName} onChangeText={(v) => set("fullName", v)} error={errors.fullName} autoComplete="name" />
      <Input
        label={`${years.start.label} *`}
        value={d.startYear}
        onChangeText={(v) => set("startYear", yearDigits(v))}
        keyboardType="number-pad"
        maxLength={4}
        placeholder="Year"
        error={errors.startYear}
        hint={yearRange(memberStartYearOptions())}
      />
      {/* Marked required only where it is: a community's blank "Until" means they still belong. */}
      <Input
        label={years.end.required ? `${years.end.label} *` : years.end.label}
        value={d.batchYear}
        onChangeText={(v) => set("batchYear", yearDigits(v))}
        keyboardType="number-pad"
        maxLength={4}
        placeholder="Year"
        error={errors.batchYear}
        hint={yearRange(memberEndYearOptions(f.tenant))}
      />
      <ChipSelect label="What do you do? *" options={PROFESSION_TYPES.map((p) => ({ value: p, label: PROFESSION_TYPE_LABELS[p] }))} value={d.professionType} onChange={(v) => v && set("professionType", v)} tall />
      <DateTimeField
        label="Date of birth"
        mode="date"
        value={d.dateOfBirth || null}
        onChange={(v) => set("dateOfBirth", v ?? "")}
        maximumDate={new Date(new Date().getFullYear() - 10, 11, 31)}
        minimumDate={new Date(1900, 0, 1)}
        error={errors.dateOfBirth}
        clearable
      />
      <Input label="Current city" value={d.city} onChangeText={(v) => set("city", v)} error={errors.city} />
      <CountryPicker label="Country" value={d.country || null} onChange={(v) => set("country", v ?? "")} clearable error={errors.country} />
      <CustomFieldInputs fields={f.required} values={f.answers} errors={f.answerErrors} onChange={f.setAnswer} />
    </View>
  );
}

/** The headline, the current role, industry, when they started working, skills and past roles. */
export function ProfileWorkSection({ form: f, skillsRef }: { form: ProfileDraftController; skillsRef: RefObject<SkillsInputHandle | null> }) {
  const { draft: d, set, errors } = f;
  const profession = d.professionType;
  return (
    <View style={styles.stack}>
      <Input
        label="Headline"
        value={d.headline}
        onChangeText={(v) => set("headline", v)}
        maxLength={PROFILE_HEADLINE_MAX_LENGTH}
        placeholder="What you do, in a line"
        hint="One line under your name, such as “Product designer at Zylo Labs”."
        error={errors.headline}
      />
      <Input
        label={profession === "STUDENT" ? "Institution" : profession === "EMPLOYED" ? "Company" : "Company / business"}
        value={d.companyName}
        onChangeText={(v) => set("companyName", v)}
        placeholder={profession === "FOUNDER" ? "Your startup" : "Where you work"}
        error={errors.companyName}
      />
      <Input label="Designation / role" value={d.designation} onChangeText={(v) => set("designation", v)} error={errors.designation} />
      <OptionPicker label="Industry" value={d.industry || null} options={INDUSTRY_OPTIONS} onChange={(v) => set("industry", v ?? "")} placeholder="Choose your industry" clearLabel="No industry" error={errors.industry} />
      {/* A student hasn't started working yet; the year stays as it was if they switch back. */}
      {profession !== "STUDENT" && (
        <Input
          label="Year you started working"
          value={d.careerStartYear}
          onChangeText={(v) => set("careerStartYear", yearDigits(v))}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="Year"
          hint="Your profile shows your years of experience from it."
          error={errors.careerStartYear}
        />
      )}
      <SkillsInput
        ref={skillsRef}
        label="Skills"
        value={d.skills}
        onChange={(skills) => set("skills", skills)}
        max={PROFILE_MAX_SKILLS}
        maxLength={SKILL_MAX_LENGTH}
        placeholder="Add a skill"
        hint={`What you're good at professionally, such as SQL, sales or design. Press Enter or type a comma after each, up to ${PROFILE_MAX_SKILLS}.`}
        error={f.listError("skills")}
      />
      <ExperienceListInput form={f} />
    </View>
  );
}

const LINK_FIELDS: { name: ProfileLinkKey; label: string; placeholder: string; keyboardType: KeyboardTypeOptions }[] = [
  { name: "linkedinUrl", label: "LinkedIn", placeholder: "linkedin.com/in/your-name", keyboardType: "url" },
  { name: "websiteUrl", label: "Website", placeholder: "yourname.com", keyboardType: "url" },
  // A handle starts with "@", which a URL keyboard hides.
  { name: "githubUrl", label: "GitHub", placeholder: "@username", keyboardType: "default" },
  { name: "instagramUrl", label: "Instagram", placeholder: "@username", keyboardType: "default" },
  { name: "xUrl", label: "X", placeholder: "@username", keyboardType: "default" },
];

/** "Offer to mentor", for a member who can mentor here and doesn't yet: mentoring is a profile of its own, in Mentors. */
function OfferToMentor({ form: f }: { form: ProfileDraftController }) {
  const router = useRouter();
  const theme = useTheme();
  const slug = f.tenant.slug;
  const available = f.mode === "edit" && mentorshipAvailable(f.tenant.settings.features, f.initial?.chatEligible ?? false);
  const mine = useQuery({ queryKey: mentorshipKeys.me(slug), queryFn: () => api.mentorship.me(slug), enabled: available, staleTime: 60_000 });
  if (!available || !mine.isSuccess || mine.data?.isActive) return null;
  return (
    <Pressable onPress={() => router.push(mentorsHref(slug, "be-a-mentor"))} role="link" style={{ minHeight: 44, justifyContent: "center" }}>
      <Text style={{ fontSize: 13, color: "#475569" }}>
        Happy to guide other members? <Text style={{ color: theme.primary, fontWeight: "600", textDecorationLine: "underline" }}>Offer to mentor</Text>
      </Text>
    </Pressable>
  );
}

/**
 * Bio and interests, studies here and elsewhere, links and Open to (neither for a current pupil), the optional questions,
 * personal details behind a disclosure, and the sharing switches.
 */
export function ProfileAboutSection({ form: f }: { form: ProfileDraftController }) {
  const theme = useTheme();
  const { draft: d, set, errors } = f;
  const school = f.tenant.type === "SCHOOL";
  return (
    <View style={styles.stack}>
      <Input label="Short bio" value={d.bio} onChangeText={(v) => set("bio", v)} multiline maxLength={1000} placeholder="Tell your batchmates what you're up to" hint={RICH_TEXT_HINT} error={errors.bio} />
      <Input
        label="Interests"
        value={d.interests}
        onChangeText={(v) => set("interests", v)}
        placeholder="cricket, startups, travel"
        hint="What you enjoy outside work, such as cricket, startups or travel. Separate them with commas."
        error={f.listError("interests")}
      />

      {!school && (
        <View style={styles.stack}>
          <SubHeading>Your studies at {f.tenant.shortName ?? f.tenant.name}</SubHeading>
          <Input label="Degree" value={d.degree} onChangeText={(v) => set("degree", v)} maxLength={PROFILE_DEGREE_MAX_LENGTH} placeholder="e.g. B.Tech" error={errors.degree} />
          <Input label="Field of study" value={d.fieldOfStudy} onChangeText={(v) => set("fieldOfStudy", v)} maxLength={PROFILE_DEGREE_MAX_LENGTH} placeholder="e.g. Mechanical engineering" error={errors.fieldOfStudy} />
        </View>
      )}

      <EducationListInput form={f} />

      {!f.pupil && (
        <View style={styles.stack}>
          <SubHeading hint="A full address, or for LinkedIn, GitHub, Instagram and X just your user name.">Links</SubHeading>
          {LINK_FIELDS.map((l) => (
            <Input
              key={l.name}
              label={l.label}
              value={d[l.name]}
              onChangeText={(v) => set(l.name, v)}
              // A handle or an address without https:// becomes the full address as they leave the box, and again on saving.
              onBlur={() => {
                const url = socialUrlFromInput(LINK_KINDS[l.name], d[l.name]) ?? "";
                if (url !== d[l.name]) set(l.name, url);
              }}
              placeholder={l.placeholder}
              keyboardType={l.keyboardType}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              error={errors[l.name]}
            />
          ))}
        </View>
      )}

      {!f.pupil && (
        <View role="group" aria-label="Open to" style={{ gap: 6 }}>
          <Text style={styles.label}>Open to</Text>
          <Row>
            {OPEN_TO.map((o) => {
              const on = d.openTo.includes(o);
              return <Chip key={o} label={OPEN_TO_LABELS[o]} active={on} tall color={theme.primary} onPress={() => set("openTo", on ? d.openTo.filter((x) => x !== o) : [...d.openTo, o])} />;
            })}
          </Row>
          <Muted>Shown on your profile and your directory card, where members can filter by it.</Muted>
          <OfferToMentor form={f} />
        </View>
      )}

      {f.optional.length > 0 && <CustomFieldInputs fields={f.optional} values={f.answers} errors={f.answerErrors} onChange={f.setAnswer} />}

      <View style={styles.disclosure}>
        <Pressable onPress={() => f.setPersonalOpen((o) => !o)} accessibilityRole="button" aria-expanded={f.personalOpen} style={styles.disclosureButton}>
          <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: "#334155" }}>Personal</Text>
          <View aria-hidden style={f.personalOpen ? { transform: [{ rotate: "180deg" }] } : null}>
            <IconChevronDown size={18} color={colors.faint} />
          </View>
        </Pressable>
        {f.personalOpen && (
          <View style={[styles.stack, { paddingHorizontal: spacing.md, paddingBottom: spacing.md }]}>
            <Muted>{"Only you and your institution's admins see these."}</Muted>
            <ChipSelect
              label="Marital status"
              options={MARITAL_STATUSES.map((m) => ({ value: m, label: MARITAL_STATUS_LABELS[m] }))}
              value={d.maritalStatus}
              onChange={(v) => set("maritalStatus", v)}
              allowEmpty
              emptyLabel="Prefer not to say"
              tall
            />
            <Input label="Number of kids" value={d.kidsCount} onChangeText={(v) => set("kidsCount", v.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" error={errors.kidsCount} />
          </View>
        )}
      </View>

      <Row style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <Text style={{ color: colors.text, flex: 1 }}>Show my phone number to other members</Text>
        <Switch accessibilityLabel="Show my phone number to other members" value={d.isPhoneVisible} onValueChange={(v) => set("isPhoneVisible", v)} trackColor={{ true: theme.primary }} />
      </Row>
      <Row style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <Text style={{ color: colors.text, flex: 1 }}>Show my birthday on the feed on the day (day and month only)</Text>
        <Switch accessibilityLabel="Show my birthday on the feed" value={d.celebrateBirthday} onValueChange={(v) => set("celebrateBirthday", v)} trackColor={{ true: theme.primary }} />
      </Row>
      <Row style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <Text style={{ color: colors.text, flex: 1 }}>Show my membership anniversary on the feed</Text>
        <Switch accessibilityLabel="Show my membership anniversary on the feed" value={d.celebrateAnniversary} onValueChange={(v) => set("celebrateAnniversary", v)} trackColor={{ true: theme.primary }} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  label: { fontSize: 13, fontWeight: "600", color: "#334155" },
  subheading: { fontSize: 14, fontWeight: "700", color: colors.text },
  disclosure: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  disclosureButton: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md },
});
