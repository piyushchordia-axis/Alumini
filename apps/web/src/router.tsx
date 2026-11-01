import { createBrowserRouter } from "react-router-dom";
import { RequireAuth } from "@/components/guards/RequireAuth";
import { AppHomeRedirect, RequireFeature } from "@/components/guards/RequireFeature";
import { RequireMembership } from "@/components/guards/RequireMembership";
import { HomeLayout } from "@/components/layout/HomeLayout";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { RouteErrorPage } from "@/routes/RouteErrorPage";
import { TenantPickerPage } from "@/routes/TenantPickerPage";
import { VerifyEmailPage } from "@/routes/VerifyEmailPage";
import { DirectoryPage } from "@/routes/t/DirectoryPage";
import { EventDetailPage } from "@/routes/t/EventDetailPage";
import { EventFormPage } from "@/routes/t/EventFormPage";
import { EventsPage } from "@/routes/t/EventsPage";
import { FeedPage } from "@/routes/t/FeedPage";
import { FundingDetailPage } from "@/routes/t/FundingDetailPage";
import { FundingFormPage } from "@/routes/t/FundingFormPage";
import { FundingPage } from "@/routes/t/FundingPage";
import { JobDetailPage } from "@/routes/t/JobDetailPage";
import { JobFormPage } from "@/routes/t/JobFormPage";
import { JobsPage } from "@/routes/t/JobsPage";
import { LandingPage } from "@/routes/t/LandingPage";
import { LoginPage } from "@/routes/t/LoginPage";
import { MemberProfilePage } from "@/routes/t/MemberProfilePage";
import { MyContentPage } from "@/routes/t/MyContentPage";
import { MyProfilePage } from "@/routes/t/MyProfilePage";
import { NotificationsPage } from "@/routes/t/NotificationsPage";
import { PendingApprovalPage } from "@/routes/t/PendingApprovalPage";
import { PostDetailPage } from "@/routes/t/PostDetailPage";
import { RegisterPage } from "@/routes/t/RegisterPage";
import { adminRoutes, platformRoutes } from "@/router.admin";

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/", element: <TenantPickerPage /> },
      { path: "/verify-email", element: <VerifyEmailPage /> },
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
                    ],
                  },
                  {
                    element: <RequireFeature feature="jobs" />,
                    children: [
                      { path: "jobs", element: <JobsPage /> },
                      { path: "jobs/new", element: <JobFormPage /> },
                      { path: "jobs/:jobId", element: <JobDetailPage /> },
                      { path: "jobs/:jobId/edit", element: <JobFormPage /> },
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
