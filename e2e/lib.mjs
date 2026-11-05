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

/**
 * Serves one notification, so a script can tap a row without a second member to cause one. Read already, so tapping sends
 * nothing. `subject` is what the API adds to an admin's new-member notice (where the request stands now), and
 * `update(fields)` changes the row from the next request on, as when another admin has dealt with it.
 */
export async function scriptNotification(page, slug, { type, data, title, body = null, subject }) {
  const url = new RegExp(`/api/v1/t/${slug}/notifications(\\?|$)`);
  let row = { id: "00000000-0000-4000-8000-000000000001", type, title, body, data, readAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", ...(subject ? { subject } : {}) };
  await page.route(url, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return fulfillJson(route, 200, { data: [row], nextCursor: null });
  });
  return {
    update: (fields) => {
      row = { ...row, ...fields };
    },
    stop: () => page.unroute(url),
  };
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

/**
 * Fails unless `locator` (one element) draws an SVG icon and its text holds no emoji: for chrome where an emoji stood in
 * for an icon. Not for anything holding member text, which may have emoji of its own.
 */
export async function expectSvgNoEmoji(locator, where) {
  const text = await locator.innerText();
  const emoji = text.match(/\p{Extended_Pictographic}/u);
  if (emoji) throw new Error(`${where} shows the emoji ${emoji[0]}: "${text}"`);
  if (!(await locator.locator("svg").count())) throw new Error(`${where} draws no SVG icon`);
}

/**
 * Fails unless `chip`, a chosen toggle in a tray (a reaction), looks chosen once any transition ends: laid over its tray
 * on the white card, it visibly differs from the tray alone and from the white card, and its icon is filled, in a
 * colour that isn't near-black (no seeded institution's colour is) and reads on the chip (3:1, WCAG 1.4.11). A chosen
 * reaction was a white chip on a near-white tray, told apart only by its stroke, which hover repainted slate-800. Gives
 * the colours, each [r, g, b], of the icon and of the chip as painted over its tray.
 */
export async function expectChosenChip(chip, where) {
  const look = await chip.evaluate(async (el) => {
    await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished));
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    // Paints the colours over white, in order, and reads the pixel back: computed colours come as rgb(), oklab() or
    // color(), some see-through, and painting turns them all into what the eye gets.
    const paint = (...colours) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, 1, 1);
      for (const c of colours) {
        g.fillStyle = "#010203";
        g.fillStyle = c;
        if (g.fillStyle === "#010203") throw new Error(`the canvas can't read the colour ${c}`);
        g.fillRect(0, 0, 1, 1);
      }
      return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const tray = getComputedStyle(el.parentElement).backgroundColor;
    const path = getComputedStyle(el.querySelector("svg path"));
    return { tray: paint(tray), chip: paint(tray, getComputedStyle(el).backgroundColor), icon: paint(path.stroke), fill: path.fill };
  });
  const apart = Math.max(...look.chip.map((c, i) => Math.abs(c - look.tray[i])));
  if (apart < 10) throw new Error(`${where} (rgb ${look.chip.join(" ")}) hardly differs from its tray (rgb ${look.tray.join(" ")})`);
  // A white chip is only 10 (web) to 14 (phone) apart from the near-white trays, so it has to differ from white too:
  // the seeded brands' washes are 32 to 35 apart from it.
  if (Math.max(...look.chip.map((c) => 255 - c)) < 20) throw new Error(`${where} (rgb ${look.chip.join(" ")}) is all but white`);
  if (look.fill === "none") throw new Error(`${where} has an unfilled icon`);
  // WCAG relative luminance. Slate-700 is 0.051 and slate-800 0.022: below 0.04 a 16-18px icon reads as black.
  const linear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map(linear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const icon = luminance(look.icon);
  if (icon < 0.04) throw new Error(`${where} draws its icon near-black (rgb ${look.icon.join(" ")})`);
  const chipLuminance = luminance(look.chip);
  const contrast = (Math.max(icon, chipLuminance) + 0.05) / (Math.min(icon, chipLuminance) + 0.05);
  if (contrast < 3) throw new Error(`${where}'s icon (rgb ${look.icon.join(" ")}) is ${contrast.toFixed(2)}:1 on the chip (rgb ${look.chip.join(" ")}), under 3:1`);
  return { icon: look.icon, chip: look.chip };
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const isUpload = (request) => request.method() === "POST" && /\/uploads(\?|$)/.test(request.url());

/** A photo as a camera takes it, too big to upload as it is: a 4000 × 3000 JPEG of over 5 MB, made in the page. */
export async function bigPhoto(page) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4000;
    canvas.height = 3000;
    const g = canvas.getContext("2d");
    const pixels = g.createImageData(canvas.width, canvas.height);
    // Noise, which JPEG can't squeeze, keeps the file over the limit.
    let seed = 1;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const n = seed >>> 24;
      pixels.data[i] = n;
      pixels.data[i + 1] = (n * 7) & 255;
      pixels.data[i + 2] = (n * 13) & 255;
      pixels.data[i + 3] = 255;
    }
    g.putImageData(pixels, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length <= MAX_UPLOAD_BYTES) throw new Error(`the camera-sized photo is only ${buffer.length} bytes, under the upload limit`);
  return { name: "camera.jpg", mimeType: "image/jpeg", buffer };
}

/**
 * Picks a bigPhoto, `pick(file)` choosing it the way the page does, and fails unless the app prepared it before sending
 * it: the request's body (its Content-Length, as Chromium sent it; Playwright's body size leaves out a file part) is
 * under the upload limit, the upload answers 201, and the form shows the stored photo. Gives the stored photo's URL.
 */
export async function pickBigPhoto(page, pick) {
  const file = await bigPhoto(page);
  const request = page.waitForRequest(isUpload);
  await pick(file);
  const sent = await request;
  const answer = await sent.response();
  const length = Number(await sent.headerValue("content-length"));
  if (!(length > 0)) throw new Error("couldn't read the size of the photo's upload");
  if (length >= MAX_UPLOAD_BYTES) throw new Error(`the app sent the photo as it was picked (${length} bytes), not prepared`);
  if (answer?.status() !== 201) throw new Error(`the photo's upload answered ${answer?.status()}: ${await answer?.text()}`);
  const { url } = (await answer.json()).data;
  const preview = page.locator(`img[src="${url}"]`).locator("visible=true").first();
  await preview.waitFor();
  await preview.evaluate((img) => img.decode());
  return url;
}

/**
 * Holds the page's photo decoding (`createImageBitmap`, where preparing a photo starts) so a script can act while a photo
 * is being prepared. `held()` waits until a photo is held, `release()` lets it go on and stops holding, and `uploads()`
 * counts the uploads the page has sent since the hold began.
 */
export async function holdPhotoPreparation(page) {
  await page.evaluate(() => {
    const real = window.createImageBitmap;
    const waiting = [];
    window.__photoHold = { real, waiting };
    window.createImageBitmap = (...args) => new Promise((resolve, reject) => waiting.push(() => real.apply(window, args).then(resolve, reject)));
  });
  let uploads = 0;
  const count = (request) => {
    if (isUpload(request)) uploads += 1;
  };
  page.on("request", count);
  return {
    held: () => page.waitForFunction(() => window.__photoHold.waiting.length > 0),
    release: async () => {
      await page.evaluate(() => {
        const hold = window.__photoHold;
        window.createImageBitmap = hold.real;
        for (const go of hold.waiting.splice(0)) go();
      });
    },
    uploads: () => uploads,
    stop: () => page.off("request", count),
  };
}
