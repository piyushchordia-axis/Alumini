import { Navigate, Outlet } from "react-router-dom";
import { Loading } from "@/components/ui";
import { useMe } from "@/hooks/useMe";
import { useAuthStore } from "@/stores/authStore";

export function RequirePlatformAdmin() {
  const me = useMe();
  const user = useAuthStore((s) => s.user);
  if (me.isLoading && !user) return <Loading />;
  if (!user?.isPlatformAdmin) return <Navigate to="/platform/login" replace />;
  return <Outlet />;
}
