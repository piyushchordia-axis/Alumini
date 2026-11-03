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
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`), { status: res.status, error: json?.error });
  return json?.data;
}

/**
 * Asks for a code. Another script run moments ago may have asked for this phone, which then waits a minute. The refused
 * request issues no code, but it still counts against the API's 20 code requests an hour from this machine.
 */
async function requestOtp(phone) {
  try {
    return await call("POST", "/auth/otp/request", { phone });
  } catch (err) {
    const wait = err.error?.code === "OTP_COOLDOWN" ? Number(err.error.details?.retryAfterSec ?? 60) : 0;
    if (!wait || wait > 90) throw err;
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
    return call("POST", "/auth/otp/request", { phone });
  }
}

const sessions = new Map();
/**
 * Signs someone in through the API with the development OTP, once per run: every code request counts against a limit
 * of 20 an hour for the whole machine, shared by every e2e script, and each phone also waits a minute between codes.
 */
export function apiSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(
      phone,
      (async () => {
        const otp = await requestOtp(phone);
        if (!otp.devCode) throw new Error("The API did not return a development OTP; run it with OTP_PROVIDER=console");
        return call("POST", "/auth/otp/verify", { phone, code: otp.devCode });
      })(),
    );
  }
  return sessions.get(phone);
}

/** Signs in as the platform admin through the console OTP (development only: the API returns the code). */
const platformAdmin = async () => (await apiSession(PLATFORM_ADMIN)).accessToken;

/**
 * A browser context for the web app, already signed in as this member without going through the login screen. Only the
 * first page load reads it, so a reload doesn't undo the app's own token refreshes.
 */
export async function signedInContext(browser, origin, phone, options = {}) {
  const s = await apiSession(phone);
  const auth = { state: { accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user, memberships: s.memberships }, version: 0 };
  return browser.newContext({ ...options, storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: "illuminize.auth", value: JSON.stringify(auth) }] }] } });
}

/**
 * The same for the Expo app's web export, which keeps its session in AsyncStorage, localStorage on the web: the tokens
 * under keys of their own, and who is signed in under illuminize.auth.
 */
export async function signedInMobileContext(browser, origin, phone, options = {}) {
  const s = await apiSession(phone);
  const auth = { state: { isAuthenticated: true, user: s.user, memberships: s.memberships }, version: 0 };
  const localStorage = [
    { name: "illuminize.auth", value: JSON.stringify(auth) },
    { name: "illuminize.access", value: s.accessToken },
    { name: "illuminize.refresh", value: s.refreshToken },
  ];
  return browser.newContext({ ...options, storageState: { cookies: [], origins: [{ origin, localStorage }] } });
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

/** A business listing: stale after 30 seconds, and a 5xx is tried three times, about 3 seconds in all. */
export const scriptBusiness = (page, slug, id) => scriptGet(page, `/t/${slug}/businesses/${id}`, { staleMs: 31_000, triesOn5xx: 3 });

/** A mentor's page, which the request form reads too: stale after 30 seconds, and a 5xx is tried three times. */
export const scriptMentor = (page, slug, membershipId) => scriptGet(page, `/t/${slug}/mentorship/mentors/${membershipId}`, { staleMs: 31_000, triesOn5xx: 3 });

/** A job's page, which the referral request form reads too: stale after 30 seconds, and a 5xx is tried three times. */
export const scriptJob = (page, slug, id) => scriptGet(page, `/t/${slug}/jobs/${id}`, { staleMs: 31_000, triesOn5xx: 3 });

/** A chat thread's details (not its messages): stale after 30 seconds, and a 5xx is tried three times. */
export const scriptConversation = (page, slug, id) => scriptGet(page, `/t/${slug}/chat/conversations/${id}`, { staleMs: 31_000, triesOn5xx: 3 });

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

/**
 * Puts the page's live connection through a proxy that loses any server frame containing `text`, as a flaky network would.
 * Set it up before the page connects (a reload does). `opened()` waits until the connection is up and has had a moment to
 * join its rooms, and `dropped()` says whether a frame was actually lost, so a script can't pass without testing the gap.
 * The proxy stays for the page's life, passing everything else through.
 */
export async function dropFrames(page, text) {
  const url = /\/socket\.io\//;
  let open = false;
  let dropped = 0;
  await page.routeWebSocket(url, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((frame) => {
      if (typeof frame === "string" && frame.startsWith("40")) open = true;
      if (typeof frame === "string" && frame.includes(text)) {
        dropped += 1;
        return;
      }
      ws.send(frame);
    });
  });
  return {
    opened: async () => {
      for (let i = 0; i < 150 && !open; i++) await page.waitForTimeout(100);
      if (!open) throw new Error("the live connection didn't open");
      // The server joins the member's rooms just after the connection opens.
      await page.waitForTimeout(1500);
    },
    dropped: () => dropped > 0,
  };
}
