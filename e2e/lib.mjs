// Helpers shared by the e2e scripts: direct API calls for set-up that the UI doesn't do (running a scheduled job now).

export const API = process.env.API_URL ?? "http://localhost:4000";
const PLATFORM_ADMIN = process.env.PLATFORM_ADMIN_PHONE ?? "+919999999999";

async function call(method, path, body, token) {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json?.data;
}

let platformToken = null;
/** Signs in as the platform admin through the console OTP (development only: the API returns the code). */
async function platformAdmin() {
  if (platformToken) return platformToken;
  const otp = await call("POST", "/auth/otp/request", { phone: PLATFORM_ADMIN });
  if (!otp.devCode) throw new Error("The API did not return a development OTP; run it with OTP_PROVIDER=console");
  platformToken = (await call("POST", "/auth/otp/verify", { phone: PLATFORM_ADMIN, code: otp.devCode })).accessToken;
  return platformToken;
}

/** Runs a scheduled per-institution job now ("celebrations" or "digest"), as the platform console's job runner does. */
export async function runJob(job, slug) {
  const tenant = await call("GET", `/tenants/${slug}`);
  return call("POST", "/platform/jobs/run", { job, tenantId: tenant.id, force: true }, await platformAdmin());
}
