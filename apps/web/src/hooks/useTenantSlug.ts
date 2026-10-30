import { useParams } from "react-router-dom";

export function useTenantSlug(): string {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) throw new Error("useTenantSlug used outside a /t/:slug route");
  return slug;
}
