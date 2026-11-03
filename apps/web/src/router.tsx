import { createBrowserRouter } from "react-router-dom";
import { RequireAuth } from "@/components/guards/RequireAuth";
import { AppHomeRedirect, RequireChat, RequireFeature, RequireGroups, RequireMentors } from "@/components/guards/RequireFeature";
import { RequireMembership } from "@/components/guards/RequireMembership";
import { HomeLayout } from "@/components/layout/HomeLayout";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { RouteErrorPage } from "@/routes/RouteErrorPage";
import { TenantPickerPage } from "@/routes/TenantPickerPage";
import { InvitePage } from "@/routes/InvitePage";
import { UnsubscribePage } from "@/routes/UnsubscribePage";
import { VerifyEmailPage } from "@/routes/VerifyEmailPage";
import { DirectoryPage } from "@/routes/t/DirectoryPage";
import { DigestPage } from "@/routes/t/DigestPage";
import { EventDetailPage } from "@/routes/t/EventDetailPage";
import { BusinessDetailPage } from "@/routes/t/BusinessDetailPage";
import { BusinessesPage } from "@/routes/t/BusinessesPage";
import { BusinessFormPage } from "@/routes/t/BusinessFormPage";
import { EventFormPage } from "@/routes/t/EventFormPage";
import { EventsPage } from "@/routes/t/EventsPage";
import { FeedPage } from "@/routes/t/FeedPage";
import { FundingDetailPage } from "@/routes/t/FundingDetailPage";
import { FundingFormPage } from "@/routes/t/FundingFormPage";
import { FundingPage } from "@/routes/t/FundingPage";
import { GroupDetailRoute } from "@/routes/t/GroupDetailPage";
import { GroupFormPage } from "@/routes/t/GroupFormPage";
import { GroupsPage } from "@/routes/t/GroupsPage";
import { JobDetailRoute } from "@/routes/t/JobDetailPage";
import { JobFormPage } from "@/routes/t/JobFormPage";
import { JobsPage } from "@/routes/t/JobsPage";
import { ReferralRequestRoute } from "@/routes/t/ReferralRequestPage";
import { LandingPage } from "@/routes/t/LandingPage";
import { LoginPage } from "@/routes/t/LoginPage";
import { MentorDetailRoute } from "@/routes/t/MentorDetailPage";
import { MentorRequestRoute } from "@/routes/t/MentorRequestPage";
import { MentorsPage } from "@/routes/t/MentorsPage";
import { BlockedMembersPage } from "@/routes/t/BlockedMembersPage";
import { ChatThreadRoute } from "@/routes/t/ChatThreadPage";
import { MessagesPage, NoConversationPane } from "@/routes/t/MessagesPage";
import { NewConversationPage } from "@/routes/t/NewConversationPage";
import { MemberProfilePage } from "@/routes/t/MemberProfilePage";
import { MyContentPage } from "@/routes/t/MyContentPage";
import { MyProfilePage } from "@/routes/t/MyProfilePage";
import { NotificationSettingsPage } from "@/routes/t/NotificationSettingsPage";
import { NotificationsPage } from "@/routes/t/NotificationsPage";
import { PendingApprovalPage } from "@/routes/t/PendingApprovalPage";
import { PostDetailPage } from "@/routes/t/PostDetailPage";
import { RegisterPage } from "@/routes/t/RegisterPage";
import { adminRoutes, platformRoutes } from "@/router.admin";
import type { AppRouteHandle } from "@/lib/routeHandle";

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/", element: <TenantPickerPage /> },
      { path: "/verify-email", element: <VerifyEmailPage /> },
      { path: "/unsubscribe", element: <UnsubscribePage /> },
      { path: "/i/:token", element: <InvitePage /> },
      { path: "/t/:slug", element: <LandingPage /> },
      { path: "/t/:slug/login", element: <LoginPage /> },
      {
        path: "/t/:slug",
        element: <RequireAuth />,
        children: [
          { path: "register", element: <RegisterPage /> },
          { path: "pending", element: <PendingApprovalPage /> },
          {
            element: <RequireMembership />,
            children: [
              {
                path: "app",
                element: <HomeLayout />,
                children: [
                  { index: true, element: <AppHomeRedirect /> },
                  {
                    element: <RequireFeature feature="feed" />,
                    children: [
                      { path: "feed", element: <FeedPage /> },
                      { path: "feed/:postId", element: <PostDetailPage /> },
                      { path: "digest", element: <DigestPage /> },
                    ],
                  },
                  {
                    element: <RequireChat />,
                    children: [
                      {
                        path: "messages",
                        element: <MessagesPage />,
                        handle: { fullHeight: true } satisfies AppRouteHandle,
                        children: [
                          { index: true, element: <NoConversationPane /> },
                          { path: "new", element: <NewConversationPage />, handle: { immersive: true } satisfies AppRouteHandle },
                          { path: "blocked", element: <BlockedMembersPage /> },
                          { path: ":conversationId", element: <ChatThreadRoute />, handle: { immersive: true } satisfies AppRouteHandle },
                        ],
                      },
                    ],
                  },
                  {
                    element: <RequireGroups />,
                    children: [
                      { path: "groups", element: <GroupsPage /> },
                      { path: "groups/new", element: <GroupFormPage /> },
                      { path: "groups/:groupId", element: <GroupDetailRoute /> },
                      { path: "groups/:groupId/edit", element: <GroupFormPage /> },
                    ],
                  },
                  // Not behind RequireMentors: someone who can't use mentorship now can still leave what they're in from here.
                  { path: "mentors", element: <MentorsPage /> },
                  {
                    element: <RequireMentors />,
                    children: [
                      { path: "mentors/:membershipId", element: <MentorDetailRoute /> },
                      { path: "mentors/:membershipId/request", element: <MentorRequestRoute /> },
                    ],
                  },
                  {
                    // Referral requests live inside Jobs: each referral screen says itself when the member can't use them.
                    element: <RequireFeature feature="jobs" />,
                    children: [
                      { path: "jobs", element: <JobsPage /> },
                      { path: "jobs/new", element: <JobFormPage /> },
                      { path: "jobs/:jobId", element: <JobDetailRoute /> },
                      { path: "jobs/:jobId/edit", element: <JobFormPage /> },
                      { path: "jobs/:jobId/request-referral", element: <ReferralRequestRoute /> },
                    ],
                  },
                  {
                    element: <RequireFeature feature="funding" />,
                    children: [
                      { path: "funding", element: <FundingPage /> },
                      { path: "funding/new", element: <FundingFormPage /> },
                      { path: "funding/:id", element: <FundingDetailPage /> },
                      { path: "funding/:id/edit", element: <FundingFormPage /> },
                    ],
                  },
                  {
                    element: <RequireFeature feature="businesses" />,
                    children: [
                      { path: "businesses", element: <BusinessesPage /> },
                      { path: "businesses/new", element: <BusinessFormPage /> },
                      { path: "businesses/:id", element: <BusinessDetailPage /> },
                      { path: "businesses/:id/edit", element: <BusinessFormPage /> },
                    ],
                  },
                  {
                    element: <RequireFeature feature="events" />,
                    children: [
                      { path: "events", element: <EventsPage /> },
                      { path: "events/new", element: <EventFormPage /> },
                      { path: "events/:id", element: <EventDetailPage /> },
                      { path: "events/:id/edit", element: <EventFormPage /> },
                    ],
                  },
                  {
                    element: <RequireFeature feature="directory" />,
                    children: [
                      { path: "directory", element: <DirectoryPage /> },
                      { path: "directory/:membershipId", element: <MemberProfilePage /> },
                    ],
                  },
                  { path: "profile", element: <MyProfilePage /> },
                  { path: "my-content", element: <MyContentPage /> },
                  { path: "notifications", element: <NotificationsPage /> },
                  { path: "notifications/settings", element: <NotificationSettingsPage /> },
                ],
              },
            ],
          },
          adminRoutes,
        ],
      },
      ...platformRoutes,
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
