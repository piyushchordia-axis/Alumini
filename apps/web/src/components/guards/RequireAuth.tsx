import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useIsAuthenticated } from "@/stores/authStore";

export function RequireAuth({ loginPath }: { loginPath?: string }) {
  const authed = useIsAuthenticated();
  const location = useLocation();
  const { slug } = useParams();
  if (!authed) {
    const target = loginPath ?? (slug ? `/t/${slug}/login` : "/");
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`${target}?next=${next}`} replace />;
  }
  return <Outlet />;
}
