import { Navigate, type RouteObject } from "react-router-dom";
import { RequireAuth } from "@/components/guards/RequireAuth";
import { RequirePlatformAdmin } from "@/components/guards/RequirePlatformAdmin";
import { RequireTenantAdmin } from "@/components/guards/RequireTenantAdmin";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { PlatformLayout } from "@/components/layout/PlatformLayout";
import { PlatformAuditPage } from "@/routes/platform/PlatformAuditPage";
import { PlatformLoginPage } from "@/routes/platform/PlatformLoginPage";
import { PlatformStatsPage } from "@/routes/platform/PlatformStatsPage";
import { PlatformTenantDetailPage } from "@/routes/platform/PlatformTenantDetailPage";
import { PlatformTenantFormPage } from "@/routes/platform/PlatformTenantFormPage";
import { PlatformTenantsPage } from "@/routes/platform/PlatformTenantsPage";
import { PlatformUsersPage } from "@/routes/platform/PlatformUsersPage";
import { AdminAuditPage } from "@/routes/t/admin/AdminAuditPage";
import { AdminDashboardPage } from "@/routes/t/admin/AdminDashboardPage";
import { AdminMemberDetailPage } from "@/routes/t/admin/AdminMemberDetailPage";
import { AdminMembersPage } from "@/routes/t/admin/AdminMembersPage";
import { AdminModerationPage } from "@/routes/t/admin/AdminModerationPage";
import { AdminProfileFieldsPage } from "@/routes/t/admin/AdminProfileFieldsPage";
import { AdminReportsPage } from "@/routes/t/admin/AdminReportsPage";
import { AdminSettingsPage } from "@/routes/t/admin/AdminSettingsPage";

/** Tenant admin routes, nested under /t/:slug inside RequireAuth (RequireTenantAdmin loads the institution). */
export const adminRoutes: RouteObject = {
  path: "admin",
  element: <RequireTenantAdmin />,
  children: [
    {
      element: <AdminLayout />,
      children: [
        { index: true, element: <Navigate to="dashboard" replace /> },
        { path: "dashboard", element: <AdminDashboardPage /> },
        { path: "members", element: <AdminMembersPage /> },
        { path: "members/:membershipId", element: <AdminMemberDetailPage /> },
        { path: "moderation", element: <AdminModerationPage /> },
        { path: "reports", element: <AdminReportsPage /> },
        { path: "settings", element: <AdminSettingsPage /> },
        { path: "profile-fields", element: <AdminProfileFieldsPage /> },
        { path: "audit", element: <AdminAuditPage /> },
      ],
    },
  ],
};

/** Illuminize staff console. */
export const platformRoutes: RouteObject[] = [
  { path: "/platform/login", element: <PlatformLoginPage /> },
  {
    path: "/platform",
    element: <RequireAuth loginPath="/platform/login" />,
    children: [
      {
        element: <RequirePlatformAdmin />,
        children: [
          {
            element: <PlatformLayout />,
            children: [
              { index: true, element: <Navigate to="tenants" replace /> },
              { path: "tenants", element: <PlatformTenantsPage /> },
              { path: "tenants/new", element: <PlatformTenantFormPage /> },
              { path: "tenants/:tenantId", element: <PlatformTenantDetailPage /> },
              { path: "users", element: <PlatformUsersPage /> },
              { path: "stats", element: <PlatformStatsPage /> },
              { path: "audit", element: <PlatformAuditPage /> },
            ],
          },
        ],
      },
    ],
  },
];
