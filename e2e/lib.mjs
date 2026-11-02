// Helpers shared by the e2e scripts: direct API calls for set-up that the UI doesn't do (running a scheduled job now),
// and scripted API answers, so a script can reach states the demo data doesn't have.

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

/** What a phone resuming or a network returning does: every stale query refetches. */
export const reconnect = (page) =>
  page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });

const fulfillJson = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });

/**
 * Takes over a GET so a script can test the route guards. `answer(status, code)` makes it fail, and `answer(null)` goes
 * back to the real API. `refetch()` makes the query stale by moving the page's clock, which is all a query looks at (a
 * reload puts it back), then reconnects and waits until the query has given up.
 */
async function scriptGet(page, path, { staleMs, triesOn5xx }) {
  const url = `**/api/v1${path}`;
  let reply = null;
  let requests = 0;
  await page.route(url, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    requests += 1;
    return reply ? fulfillJson(route, reply.status, { error: { code: reply.code, message: `e2e ${reply.code}` } }) : route.fallback();
  });
  return {
    answer: (status, code) => {
      reply = status === null ? null : { status, code };
    },
    refetch: async () => {
      const expected = requests + (reply?.status >= 500 ? triesOn5xx : 1);
      await page.evaluate((ms) => {
        const now = Date.now;
        Date.now = () => now() + ms;
      }, staleMs);
      await reconnect(page);
      for (let i = 0; i < 100 && requests < expected; i++) await page.waitForTimeout(100);
      if (requests < expected) throw new Error(`GET ${path} wasn't retried as expected: ${requests} of ${expected} requests`);
      await page.waitForTimeout(500);
    },
    stop: () => page.unroute(url),
  };
}

/** The member's membership: stale after 30 seconds, and not retried. */
export const scriptMembership = (page, slug) => scriptGet(page, `/t/${slug}/memberships/me`, { staleMs: 31_000, triesOn5xx: 1 });

/** The institution: stale after 5 minutes, and a 5xx is tried three times, about 3 seconds in all. */
export const scriptTenant = (page, slug) => scriptGet(page, `/tenants/${slug}`, { staleMs: 301_000, triesOn5xx: 3 });

/**
 * Serves the institution with only some sections on. No demo institution has one off, and this needs no admin sign-in.
 * Only the app sees this: the API still has everything on. It takes effect on the next page load.
 */
export async function scriptFeatures(page, slug) {
  const tenant = await call("GET", `/tenants/${slug}`);
  const url = `**/api/v1/tenants/${slug}`;
  let features = null;
  await page.route(url, (route) => {
    if (!features || route.request().method() !== "GET") return route.fallback();
    return fulfillJson(route, 200, { data: { ...tenant, settings: { ...tenant.settings, features } } });
  });
  return {
    only: (...on) => {
      features = Object.fromEntries(Object.keys(tenant.settings.features).map((key) => [key, on.includes(key)]));
    },
    stop: () => page.unroute(url),
  };
}

/** Serves one notification, so a script can tap a row without a second member to cause one. Read already, so tapping sends nothing. */
export async function scriptNotification(page, slug, { type, data, title }) {
  const url = new RegExp(`/api/v1/t/${slug}/notifications(\\?|$)`);
  await page.route(url, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const row = { id: "00000000-0000-4000-8000-000000000001", type, title, body: null, data, readAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" };
    return fulfillJson(route, 200, { data: [row], nextCursor: null });
  });
  return { stop: () => page.unroute(url) };
}
