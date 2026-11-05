import { DELETE_ACCOUNT_CONFIRM, PROFILE_SECTIONS, PROFILE_SECTION_TITLES, formatPhone, profileStrength } from "@illuminize/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { IconBell, IconMail, IconPosts } from "@/components/icons";
import { ProfileDetails, ProfileSummary } from "@/components/profile/ProfileDetails";
import { ProfileStrengthPanel } from "@/components/profile/ProfileStrengthCard";
import { Avatar, Badge, Button, Card, Muted, Row, Screen } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useDeleteAccount, useSignOut } from "@/lib/session";
import { useAuthStore } from "@/stores/authStore";
import { useTenantStore } from "@/stores/tenantStore";
import { colors, radius, spacing, useTheme } from "@/theme";

export default function MyProfileScreen() {
  const { tenant, membership, isTenantAdmin } = useMembership();
  const router = useRouter();
  const qc = useQueryClient();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const setLast = useTenantStore((s) => s.setLastTenantSlug);
  const slug = tenant.slug;
  const signOut = useSignOut();
  const deleteAccount = useDeleteAccount();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  // Mentor and Open to work aren't on the membership: they come with the profile other members open.
  const asOthersSeeIt = useQuery({ queryKey: qk.member(slug, membership.id), queryFn: () => api.directory.profile(slug, membership.id), enabled: tenant.settings.features.directory });
  const summary = { ...membership, isMentor: asOthersSeeIt.data?.isMentor, isOpenToWork: asOthersSeeIt.data?.isOpenToWork };
  // The institution list can change elsewhere (approved, joined on the web), and so can being a mentor or looking for
  // work (below), so refresh them whenever this screen shows.
  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.member(slug, membership.id) });
    }, [qc, slug, membership.id]),
  );
  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleting(false);
    }
  };
  return (
    <Screen title="My profile">
      {/* What's saved, laid out as on the member's own page. A current pupil sees their links here; nobody else does. */}
      <Card style={{ gap: spacing.md }}>
        <ProfileSummary profile={summary} nameExtras={membership.role === "TENANT_ADMIN" && <Badge label="Admin" tone="primary" />}>
          <Muted>Signed in as {formatPhone(user?.phone)}</Muted>
        </ProfileSummary>
        <Button title="Edit profile" variant="outline" onPress={() => router.push(`/t/${slug}/profile/edit`)} />
        <Row gap={6}>
          <Muted size={13}>Or edit</Muted>
          {PROFILE_SECTIONS.map((s) => (
            <Pressable
              key={s}
              onPress={() => router.push(`/t/${slug}/profile/edit?section=${s}`)}
              role="link"
              accessibilityLabel={`Edit ${PROFILE_SECTION_TITLES[s]}`}
              style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.bg : colors.card })}
            >
              <Text style={{ fontSize: 14, fontWeight: "500", color: "#334155" }}>{PROFILE_SECTION_TITLES[s]}</Text>
            </Pressable>
          ))}
        </Row>
        <ProfileDetails profile={membership} tenant={tenant} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.lg, marginTop: spacing.xs }} />
      </Card>
      {/* From what's saved, so it moves when a save lands. */}
      <ProfileStrengthPanel strength={profileStrength(membership, tenant)} slug={slug} />
      <Card>
        <Pressable onPress={() => router.push(`/t/${slug}/profile/my-content`)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 }}>
          <IconPosts size={18} color={theme.primary} />
          <Text style={{ color: theme.primary, fontWeight: "600" }}>My posts & listings</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/t/${slug}/profile/notifications`)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 }}>
          <IconBell size={18} color={theme.primary} />
          <Text style={{ color: theme.primary, fontWeight: "600" }}>Notifications</Text>
        </Pressable>
        <Pressable onPress={() => router.push(`/t/${slug}/profile/account`)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 }}>
          <IconMail size={18} color={theme.primary} />
          <Text style={{ color: theme.primary, fontWeight: "600" }}>Email & account</Text>
        </Pressable>
        {isTenantAdmin && <Muted>Admin tools (approvals, moderation, settings) are available on the web console.</Muted>}
      </Card>
      <Card>
        <Text style={{ fontWeight: "700", color: colors.text }}>Your institutions</Text>
        {memberships.map((m) => (
          <Row key={m.id} style={{ justifyContent: "space-between" }}>
            <Row gap={8}>
              <Avatar name={m.tenant.shortName ?? m.tenant.name} src={m.tenant.logoUrl} size={28} />
              <Text style={{ color: colors.text }}>
                {m.tenant.name} <Muted>· {m.status.toLowerCase()}</Muted>
              </Text>
            </Row>
            {m.tenant.slug !== slug && (
              <Pressable
                onPress={() => {
                  if (m.status === "APPROVED") setLast(m.tenant.slug);
                  router.replace(`/t/${m.tenant.slug}`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${m.tenant.name}`}
                hitSlop={8}
              >
                <Text style={{ color: theme.primary }}>{m.status === "APPROVED" ? "Switch" : "Open"}</Text>
              </Pressable>
            )}
          </Row>
        ))}
        <Pressable
          onPress={() => {
            setLast(null);
            router.replace("/");
          }}
          accessibilityRole="button"
          hitSlop={6}
        >
          <Text style={{ color: theme.primary }}>+ Join another institution</Text>
        </Pressable>
      </Card>
      <Button title="Sign out" variant="outline" onPress={() => void signOut(`/t/${slug}`)} />
      <Button
        title="Delete my account"
        variant="ghost"
        onPress={() => {
          setDeleteError(null);
          setConfirmingDelete(true);
        }}
      />
      <ConfirmSheet
        open={confirmingDelete}
        title={DELETE_ACCOUNT_CONFIRM.title}
        body={DELETE_ACCOUNT_CONFIRM.body}
        confirmLabel={DELETE_ACCOUNT_CONFIRM.confirm}
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Screen>
  );
}
