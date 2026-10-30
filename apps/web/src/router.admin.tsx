import type { RouteObject } from "react-router-dom";
import { NotFoundPage } from "@/routes/NotFoundPage";

/** Tenant admin routes, nested under /t/:slug (inside RequireMembership). Implemented in Phase 7. */
export const adminRoutes: RouteObject = { path: "admin/*", element: <NotFoundPage /> };

/** Platform admin routes. Implemented in Phase 7. */
export const platformRoutes: RouteObject[] = [{ path: "/platform/*", element: <NotFoundPage /> }];
