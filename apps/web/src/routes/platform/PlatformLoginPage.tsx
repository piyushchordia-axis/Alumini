import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { OtpLoginForm } from "@/components/auth/OtpLoginForm";
import { AuthShell } from "@/components/layout/AuthShell";
import { ErrorBox } from "@/components/ui";
import { api } from "@/lib/api";
import { resetTheme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.accessToken);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    resetTheme();
  }, []);
  if (token && user?.isPlatformAdmin) return <Navigate to="/platform" replace />;
  return (
    <AuthShell title="Platform console" subtitle="Illuminize staff only">
      {denied && <ErrorBox error="This number is not a platform administrator." className="mb-4" />}
      <OtpLoginForm
        onSuccess={async (session) => {
          if (session.user.isPlatformAdmin) {
            qc.clear();
            navigate("/platform", { replace: true });
          } else {
            await api.auth.logout(session.refreshToken);
            setDenied(true);
          }
        }}
      />
    </AuthShell>
  );
}
