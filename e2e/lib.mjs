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
 * back to the real API. `rewrite(fn)` serves the real answer with its `data` passed through `fn`, worked out afresh for
 * each request (so it can go by the time), and `rewrite(null)` stops. `refetch()` makes the query stale by moving the
 * page's clock, which is all a query looks at (a reload puts it back), then reconnects and waits until the query has given up.
 */
async function scriptGet(page, path, { staleMs, triesOn5xx }) {
  const url = `**/api/v1${path}`;
  let reply = null;
  let edit = null;
  let requests = 0;
  await page.route(url, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    requests += 1;
    if (reply) return fulfillJson(route, reply.status, { error: { code: reply.code, message: `e2e ${reply.code}` } });
    if (!edit) return route.fallback();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = await response.json();
    return route.fulfill({ response, json: { ...body, data: edit(body.data) } });
  });
  return {
    answer: (status, code) => {
      reply = status === null ? null : { status, code };
    },
    rewrite: (fn) => {
      edit = fn;
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

/** Words a requester must never read about their request, which would give a decline or a block away (as chatRequestNotices.test.ts checks). */
export const HINTS_AT_A_DECLINE = /declin|block|reject|ignor|refus|turned down|unavailable/i;

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

/** Answers a list's GETs (`url`, a RegExp) with nothing in it, for an empty box a member who has some can't otherwise reach. */
export async function scriptEmptyList(page, url) {
  await page.route(url, (route) => (route.request().method() === "GET" ? fulfillJson(route, 200, { data: [], nextCursor: null }) : route.fallback()));
  return { stop: () => page.unroute(url) };
}

/**
 * Holds back the API GETs whose address (a `URL`) passes `test`, so a script can see what a page draws while they load,
 * such as a list's skeleton. `asked()` waits until one has been asked for (`seen` counts them); `release()` lets them
 * go on, and any asked for later; `stop()` takes the hold away once the answer it held has come.
 *
 * It hands each request on with `route.fallback()`, never `continue()`, so a scripted answer on the same GET
 * (`scriptNotification`, `scriptEmptyList`) still answers it once released. Playwright tries the newest route first, so
 * the hold must be set up after any such route: set up before it, the scripted answer comes first and nothing is held.
 */
export async function holdGets(page, test) {
  const url = "**/api/v1/**";
  let release = () => {};
  const released = new Promise((resolve) => (release = resolve));
  let seen = 0;
  const handler = async (route) => {
    const request = route.request();
    if (request.method() !== "GET" || !test(new URL(request.url()))) return route.fallback();
    seen += 1;
    await released;
    // The page may have gone on without it meanwhile (a reload, or a step that failed and closed it).
    return route.fallback().catch(() => {});
  };
  await page.route(url, handler);
  return {
    get seen() {
      return seen;
    },
    asked: async () => {
      for (let i = 0; i < 100 && !seen; i++) await page.waitForTimeout(50);
      if (!seen) throw new Error("the page didn't ask for the GET being held");
    },
    release: () => release(),
    stop: () => {
      release();
      return page.unroute(url, handler);
    },
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
 * Fails unless a screen of the phone app's web build fits the phone: the page, and each scrolling area around `content`
 * (something in the screen's body). react-native-web clips a vertical ScrollView's sideways overflow (overflow-x:
 * hidden), so a body too wide for the phone is cut off without ever widening the page: the ScrollView's own width is
 * what shows it.
 */
export async function fitsPhone(where, content) {
  const { overflow, scrollers } = await content.evaluate((el) => {
    const widths = [document.documentElement.scrollWidth - document.documentElement.clientWidth];
    let scrollers = 0;
    for (let box = el.parentElement; box; box = box.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(box);
      if (overflowX !== "hidden" || (overflowY !== "auto" && overflowY !== "scroll")) continue;
      scrollers += 1;
      widths.push(box.scrollWidth - box.clientWidth);
    }
    return { overflow: Math.max(...widths), scrollers };
  });
  if (!scrollers) throw new Error(`found no scrolling area around ${where}'s body to measure`);
  if (overflow > 0) throw new Error(`${where} is wider than the phone by ${overflow}px`);
}

/**
 * Fails if text in `locator`'s elements breaks a word across lines ("Entrepreneurshi p"), as a column too narrow for it
 * does: each run of characters between spaces, hyphens, dashes and slashes, where a line may end, has to lie on one
 * line. Visually hidden text (a screen reader's, one pixel wide) is skipped. Fails too when it finds no words, so a
 * locator matching nothing can't pass.
 */
export async function expectWholeWords(locator, where) {
  const { words, broken } = await locator.evaluateAll((elements) => {
    let words = 0;
    const broken = new Set();
    for (const element of elements) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const box = node.parentElement?.getBoundingClientRect();
        if (!box || box.width <= 1 || box.height <= 1) continue;
        for (const word of node.data.matchAll(/[^\s\-‐–—/]+/g)) {
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          const lines = [...range.getClientRects()].filter((r) => r.width > 0);
          if (!lines.length) continue;
          words += 1;
          const tops = lines.map((r) => r.top);
          // Pieces of one line share a top; the next line starts at least half a line lower.
          if (Math.max(...tops) - Math.min(...tops) > Math.min(...lines.map((r) => r.height)) / 2) broken.add(word[0]);
        }
      }
    }
    return { words, broken: [...broken] };
  });
  if (!words) throw new Error(`found no words to check in ${where}`);
  if (broken.length) throw new Error(`${where} breaks ${broken.map((w) => `"${w}"`).join(", ")} across lines`);
}

/**
 * Fails unless `locator` (one element) is described by exactly `text`: what its aria-describedby points at, which a
 * screen reader reads after its name. The phone app's rows put it there in the browser build, which ignores
 * accessibilityHint.
 */
export async function expectDescription(locator, text, where) {
  const described = await locator.evaluate((el) =>
    (el.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .join(" "),
  );
  if (described !== text) throw new Error(`${where} is described as "${described}", expected "${text}"`);
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
  // Slate-700 is 0.051 and slate-800 0.022: below 0.04 a 16-18px icon reads as black.
  if (luminanceOf(look.icon) < 0.04) throw new Error(`${where} draws its icon near-black (rgb ${look.icon.join(" ")})`);
  const contrast = contrastOf(look.icon, look.chip);
  if (contrast < 3) throw new Error(`${where}'s icon (rgb ${look.icon.join(" ")}) is ${contrast.toFixed(2)}:1 on the chip (rgb ${look.chip.join(" ")}), under 3:1`);
  return { icon: look.icon, chip: look.chip };
}

/** A colour's channels from "r g b", as the helpers here give colours, or from [r, g, b]. */
const channelsOf = (rgb) => (Array.isArray(rgb) ? rgb : rgb.split(" ").map(Number));

/** WCAG 2 relative luminance of a colour ("r g b" or [r, g, b]): 0 for black, 1 for white. */
export function luminanceOf(rgb) {
  const [r, g, b] = channelsOf(rgb).map((c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast of two colours ("r g b" or [r, g, b]), 1 to 21, as the shared contrastRatio gives it. */
export function contrastOf(a, b) {
  const [x, y] = [luminanceOf(a), luminanceOf(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** How many times paintedColour finds an element that a re-render keeps replacing before it gives up. */
const PAINT_ATTEMPTS = 5;

/**
 * What the eye gets from `locator` (one element) once any transition on it or around it ends, each as "r g b": `colour`,
 * the element's `property` ("color" for text, an SVG's "stroke" or "fill", "backgroundColor", "borderTopColor" or
 * another side's, or "outlineColor"), laid over what's behind it; and `behind`, the surface that sits against it. Text
 * and icons sit on the element's own background and those behind it; a background, border or outline sits on what's
 * behind the element (a border over the element's own background, as browsers paint it). The backgrounds are those of
 * the element's boxes, painted from the nearest opaque one (a colour that comes out the same over black and over white)
 * inwards, so translucent washes count. It sees no photo or gradient and not what scrolls under a see-through header,
 * and it refuses a faded element (an opacity under 1, as a disabled control has), whose styles say a darker colour than
 * the eye gets. The one place both apps paint colours this way: build other colour checks on it and contrastOf.
 *
 * Playwright finds the element and then reads it, and a re-render can put a new copy in its place in between (or while
 * a fade settles). A copy that has left the page has no styles at all, which is no reading, so the locator finds the
 * element again and reads that, a few times, before giving up and saying so.
 */
export async function paintedColour(locator, property = "color") {
  let look;
  for (let attempt = 1; attempt <= PAINT_ATTEMPTS; attempt++) {
    look = await paintedColourOnce(locator, property);
    if (!look.gone) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (look.gone) throw new Error(`paintedColour can't read its ${property}: it left the page each of the ${PAINT_ATTEMPTS} times it was found (replaced by a re-render), so there was nothing steady to read`);
  if (look.problem) throw new Error(`paintedColour can't read its ${property}: ${look.problem}`);
  return look;
}

/** One reading for paintedColour: { colour, behind }, { problem } for a real refusal, or { gone } for an element that left the page. */
function paintedColourOnce(locator, property) {
  return locator.evaluate(async (el, property) => {
    // Out of the page, every computed style is "", which would read as an opacity of 0: no reading, not a fade.
    const gone = () => !el.isConnected || getComputedStyle(el).opacity === "";
    if (gone()) return { gone: true };
    const boxes = [];
    for (let box = el; box; box = box.parentElement) boxes.push(box);
    const running = [...el.getAnimations({ subtree: true }), ...boxes.slice(1).flatMap((box) => box.getAnimations())];
    // A spinner's endless animation never finishes, and doesn't change the colours being read.
    await Promise.all(running.filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished));
    // React Native Web animates opacity from JavaScript (a Pressable's press feedback, a sheet fading in), which isn't a
    // Web Animation, so a fade that is still settling gets up to 1.5s. A disabled control stays faded and is refused.
    let faded;
    for (let tries = 0; tries < 30; tries++) {
      if (gone()) return { gone: true };
      faded = boxes.find((box) => Number(getComputedStyle(box).opacity) < 1);
      if (!faded) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (gone()) return { gone: true };
    if (faded) return { problem: `it is faded (opacity ${getComputedStyle(faded).opacity}), so its colours aren't what the eye gets` };
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const paint = (base, colours) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 1, 1);
      for (const c of colours) {
        g.fillStyle = "#010203";
        g.fillStyle = c;
        if (g.fillStyle === "#010203") throw new Error(`the canvas can't read the colour ${c}`);
        g.fillRect(0, 0, 1, 1);
      }
      return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const style = getComputedStyle(el);
    const onOwnBackground = ["color", "stroke", "fill"].includes(property);
    // The boxes behind, nearest first, up to and including the nearest opaque one; the page's white past the last.
    const behind = [];
    for (const box of onOwnBackground ? boxes : boxes.slice(1)) {
      const colour = getComputedStyle(box).backgroundColor;
      behind.unshift(colour);
      if (paint("#000000", [colour]).join() === paint("#ffffff", [colour]).join()) break;
    }
    const surface = paint("#ffffff", behind);
    const value = style[property];
    if (!value || value === "none") return { problem: `it has no ${property}` };
    let colour;
    if (/^border\w*Color$/.test(property)) {
      const width = style[property.replace(/Color$/, "Width")];
      if (!(parseFloat(width) > 0)) return { problem: `it draws no such border (its width is ${width})` };
      colour = paint("#ffffff", [...behind, style.backgroundColor, value]);
    } else if (property === "outlineColor") {
      if (style.outlineStyle === "none" || !(parseFloat(style.outlineWidth) > 0)) return { problem: "it draws no outline" };
      colour = paint("#ffffff", [...behind, value]);
    } else {
      colour = paint("#ffffff", [...behind, value]);
    }
    return { colour: colour.join(" "), behind: surface.join(" ") };
  }, property);
}

/**
 * Fails unless the text of `locator` (one element) reads at `min` contrast (WCAG 1.4.3: 4.5:1, or 3:1 for large text)
 * on what's behind it, as paintedColour sees them. Gives { colour, behind, contrast }.
 */
export async function expectReadable(locator, where, min = 4.5) {
  return expectContrast(locator, "color", where, min, "reads at");
}

/**
 * Fails unless the top border of `locator` (one element), such as a tag's edge, shows at `min` contrast (WCAG 1.4.11:
 * 3:1) on what's behind the element. Gives { colour, behind, contrast }.
 */
export async function expectEdge(locator, where, min = 3) {
  return expectContrast(locator, "borderTopColor", where, min, "has an edge at");
}

/**
 * The seeded institutions' ink, wash, solid 12% tint and edge (3:1 on white: a pinned post's frame) ("r g b"), as
 * brandTones gives them for their colours (Demo University's #1d4ed8 is also both apps' default and the platform
 * console's; color.test.ts pins all four inks and washes) and both apps draw them.
 */
export const BRAND_TONES = {
  demoUniversity: { ink: "29 78 216", wash: "223 230 250", tint: "228 234 250", edge: "120 139 190" },
  demoCollege: { ink: "4 118 86", wash: "220 236 231", tint: "225 239 235", edge: "109 149 143" },
  demoSchool: { ink: "167 78 12", wash: "243 230 221", tint: "246 234 225", edge: "163 135 119" },
  samaj: { ink: "184 62 14", wash: "245 228 221", tint: "248 232 226", edge: "169 130 120" },
};

/**
 * Fails unless `box` (one empty state or chat notice: on the web the h3's parent, on the phone its title's) draws its icon
 * as both apps' EmptyIcon does, and offers what it should. The icon is an SVG, with no emoji in the box, on a badge that
 * isn't white (the brand's wash, not the box), in a colour that shows on it at 3:1 (WCAG 1.4.11: the brand's ink), as
 * paintedColour sees them. `tones` ({ ink, wash }, one of BRAND_TONES) pins them to the institution's own, which a
 * neutral grey badge would pass without. `actions` are names of links or buttons it must hold, and `absent` names of
 * ones it mustn't. Gives { icon, badge, contrast }.
 */
export async function expectEmptyState(box, where, { actions = [], absent = [], tones } = {}) {
  await expectSvgNoEmoji(box, where);
  // The stroke is on the shapes: a phone's SVG root draws none.
  const shape = box.locator("svg").first().locator("path, rect, circle, line, polyline").first();
  let look;
  try {
    look = await paintedColour(shape, "stroke");
  } catch (error) {
    throw new Error(`${where}'s icon: ${error.message}`);
  }
  if (Math.max(...look.behind.split(" ").map((c) => 255 - Number(c))) < 10) throw new Error(`${where} draws its icon on white (rgb ${look.behind}), not on a badge`);
  const contrast = contrastOf(look.colour, look.behind);
  if (contrast < 3) throw new Error(`${where}'s icon (rgb ${look.colour}) is ${contrast.toFixed(2)}:1 on its badge (rgb ${look.behind}), under 3:1`);
  if (tones && look.behind !== tones.wash) throw new Error(`${where}'s badge is rgb ${look.behind}, not the institution's wash (rgb ${tones.wash})`);
  if (tones && look.colour !== tones.ink) throw new Error(`${where}'s icon is rgb ${look.colour}, not the institution's ink (rgb ${tones.ink})`);
  const control = (name) => box.getByRole("link", { name, exact: true }).or(box.getByRole("button", { name, exact: true }));
  for (const name of actions) if (!(await control(name).count())) throw new Error(`${where} doesn't offer "${name}"`);
  for (const name of absent) if (await control(name).count()) throw new Error(`${where} offers "${name}", which it shouldn't`);
  return { icon: look.colour, badge: look.behind, contrast };
}

/**
 * Fails unless `choice` (one checkbox or radio with its label: on the web the <label>, on the phone the element with the
 * role) draws its box as both apps' choices do, in any institution colour, as paintedColour sees it. `boxSelector` finds
 * the box in it (web "input", phone ":scope > div"), and `label` its label's text (by default its last child).
 * - Clear: the box's edge is the meta grey (GREY_TEXT; the secondary one on a web tint, which redraws slate-500) and
 *   shows at 3:1 on the choice (WCAG 1.4.11).
 * - Chosen: the box (a radio's ring) is in a colour that shows at 3:1 on the choice; a checkbox's holds a drawn tick
 *   that reads at 4.5:1 on it, with no "✓" glyph, and a radio's ring a dot in the same colour. A tile (`tile`; the
 *   web's Checkbox is a bare row) is a wash, not white. `tones` ({ ink, wash }, one of BRAND_TONES) pins the box and a
 *   radio's dot to the institution's ink and the tile to its wash.
 * - Either way the label reads at 4.5:1, in the text grey: the box, the wash and the ring show that it's chosen.
 * Not for a disabled choice, whose faded box paintedColour refuses. Gives { box, tile, label }: the box's colour (a
 * clear one's edge), what it sits on, and the label's colour.
 */
export async function expectChoiceLook(choice, boxSelector, where, { checked, tile = true, tones, label = ":scope > :last-child" }) {
  const glyph = (await choice.innerText()).match(/[✓✔]/);
  if (glyph) throw new Error(`${where} draws its tick as the glyph ${glyph[0]}`);
  const text = await expectReadable(choice.locator(label).first(), `${where}'s label`);
  const box = choice.locator(boxSelector).first();
  const look = async (locator, property, part) => {
    try {
      return await paintedColour(locator, property);
    } catch (error) {
      throw new Error(`${where}'s ${part}: ${error.message}`);
    }
  };
  const radio = (await choice.getAttribute("role")) === "radio" || (await box.getAttribute("type")) === "radio";
  const drawn = await look(box, checked && !radio ? "backgroundColor" : "borderTopColor", "box");
  const contrast = contrastOf(drawn.colour, drawn.behind);
  if (contrast < 3) throw new Error(`${where}'s box (rgb ${drawn.colour}) is ${contrast.toFixed(2)}:1 on the choice (rgb ${drawn.behind}), under 3:1`);
  const result = { box: drawn.colour, tile: drawn.behind, label: text.colour };
  if (!checked) {
    // The faint grey, which the clear box used to have, also passes 3:1 on white: only the colour itself tells them apart.
    if (drawn.colour !== GREY_TEXT.plain && drawn.colour !== GREY_TEXT.dim) throw new Error(`${where}'s clear box has an edge of rgb ${drawn.colour}, not the meta grey (rgb ${GREY_TEXT.plain}, or rgb ${GREY_TEXT.dim} on a tint)`);
    return result;
  }
  if (tones && drawn.colour !== tones.ink) throw new Error(`${where}'s box is rgb ${drawn.colour}, not the institution's ink (rgb ${tones.ink})`);
  if (tile && Math.max(...drawn.behind.split(" ").map((c) => 255 - Number(c))) < 20) throw new Error(`${where} is all but white (rgb ${drawn.behind}) once chosen, not a wash`);
  if (tile && tones && drawn.behind !== tones.wash) throw new Error(`${where} is rgb ${drawn.behind} once chosen, not the institution's wash (rgb ${tones.wash})`);
  if (radio) {
    // The dot: on the web the overlay beside the input, on the phone the ring's own child.
    const dot = (await box.evaluate((el) => el.tagName)) === "INPUT" ? box.locator("xpath=following-sibling::*[1]") : box.locator(":scope > *").first();
    if (!(await dot.isVisible())) throw new Error(`${where} draws no dot in its ring`);
    const fill = await look(dot, "backgroundColor", "dot");
    if (fill.colour !== drawn.colour) throw new Error(`${where}'s dot is rgb ${fill.colour}, not its ring's colour (rgb ${drawn.colour})`);
    return result;
  }
  const tick = choice.locator("svg").first();
  if (!(await tick.isVisible())) throw new Error(`${where} draws no tick`);
  const stroke = await look(tick.locator("path").first(), "stroke", "tick");
  const tickContrast = contrastOf(stroke.colour, drawn.colour);
  if (tickContrast < 4.5) throw new Error(`${where}'s tick (rgb ${stroke.colour}) is ${tickContrast.toFixed(2)}:1 on its box (rgb ${drawn.colour}), under 4.5:1`);
  return result;
}

/**
 * Fails unless `chip` (one chip of several that can be chosen together: web ToggleChip, the phone's Chip with `check`)
 * says and draws its state as both apps do, in any institution colour, as paintedColour sees it: aria-pressed is
 * `chosen`, no "✓" glyph, and its label (its last child) reads at 4.5:1 on it.
 * - Chosen: a wash, not white, with a drawn tick that shows at 3:1 on it (WCAG 1.4.11), so it isn't told by colour
 *   alone. `tones` ({ ink, wash }, one of BRAND_TONES) pins the wash to the institution's, and the label and the tick to
 *   its ink.
 * - Not chosen: white, or all but (a hovered one), with no tick.
 * Gives { chip, label }: what the label sits on (the chip as painted) and the label's colour.
 */
export async function expectChipLook(chip, where, { chosen, tones }) {
  const pressed = await chip.getAttribute("aria-pressed");
  if (pressed !== String(chosen)) throw new Error(`${where} is aria-pressed="${pressed}", expected "${chosen}"`);
  const glyph = (await chip.innerText()).match(/[✓✔]/);
  if (glyph) throw new Error(`${where} draws its tick as the glyph ${glyph[0]}`);
  const text = await expectReadable(chip.locator(":scope > :last-child"), `${where}'s label`);
  const result = { chip: text.behind, label: text.colour };
  const fromWhite = Math.max(...text.behind.split(" ").map((c) => 255 - Number(c)));
  const ticks = chip.locator("svg");
  if (!chosen) {
    if (await ticks.count()) throw new Error(`${where} draws a tick, though it isn't chosen`);
    // Slate-50, a hovered one, is 7 from white; the seeded brands' washes are 32 to 35.
    if (fromWhite >= 10) throw new Error(`${where} is rgb ${text.behind} though it isn't chosen, not white`);
    return result;
  }
  if (fromWhite < 20) throw new Error(`${where} is all but white (rgb ${text.behind}) once chosen, not a wash`);
  if (tones && text.behind !== tones.wash) throw new Error(`${where} is rgb ${text.behind} once chosen, not the institution's wash (rgb ${tones.wash})`);
  if (tones && text.colour !== tones.ink) throw new Error(`${where}'s label is rgb ${text.colour} once chosen, not the institution's ink (rgb ${tones.ink})`);
  if ((await ticks.count()) !== 1 || !(await ticks.first().isVisible())) throw new Error(`${where} draws no tick once chosen`);
  let stroke;
  try {
    stroke = await paintedColour(ticks.first().locator("path").first(), "stroke");
  } catch (error) {
    throw new Error(`${where}'s tick: ${error.message}`);
  }
  const contrast = contrastOf(stroke.colour, stroke.behind);
  if (contrast < 3) throw new Error(`${where}'s tick (rgb ${stroke.colour}) is ${contrast.toFixed(2)}:1 on it (rgb ${stroke.behind}), under 3:1`);
  if (tones && stroke.colour !== tones.ink) throw new Error(`${where}'s tick is rgb ${stroke.colour}, not the institution's ink (rgb ${tones.ink})`);
  return result;
}

/**
 * Fails unless the initials `locator` finds (the element holding the letters, as getByText finds it), standing in for a
 * photo, read at 4.5:1 on a circle or tile of their own (rounded itself, or filling a rounded frame of about its size
 * that clips it, as a company's tile fills its bordered frame), so initials that lost their tone and sit on the card
 * can't pass. Gives { colour, behind, contrast }, as expectReadable does.
 */
export async function expectInitials(locator, where) {
  const look = await expectReadable(locator, where);
  const ownCircle = await locator.evaluate((el) => {
    for (let box = el; box; box = box.parentElement) {
      const style = getComputedStyle(box);
      if (style.backgroundColor === "transparent" || /^rgba\(.*,\s*0\)$/.test(style.backgroundColor)) continue;
      const { width, height } = box.getBoundingClientRect();
      if (width > 128 || height > 128) return false;
      for (let frame = box; frame; frame = frame.parentElement) {
        const outer = frame.getBoundingClientRect();
        if (outer.width > width + 4 || outer.height > height + 4) return false;
        const framed = getComputedStyle(frame);
        if (parseFloat(framed.borderTopLeftRadius) > 0 && (frame === box || framed.overflowX !== "visible")) return true;
      }
      return false;
    }
    return false;
  });
  if (!ownCircle) throw new Error(`${where} sit on no circle of their own`);
  return look;
}

/** Fails unless two looks expectInitials gave are the same colours: one member's tone in two places. */
export function expectSameTone(a, b, where) {
  if (a.colour !== b.colour || a.behind !== b.behind) throw new Error(`${where} differ: rgb ${a.colour} on rgb ${a.behind}, then rgb ${b.colour} on rgb ${b.behind}`);
}

/**
 * Institutions' initials as expectInitials reads them: the brand's ink on its solid tint (brandAvatarTone, pinned in
 * avatar.test.ts), for Demo University (#1d4ed8), Demo College (#047857), the Samaj (#c2410c) and the pale yellow both
 * Branding steps type (#fef9c3). No member's tone is any of these.
 */
export const INSTITUTION_INITIALS = {
  demoUniversity: { colour: BRAND_TONES.demoUniversity.ink, behind: BRAND_TONES.demoUniversity.tint },
  demoCollege: { colour: BRAND_TONES.demoCollege.ink, behind: BRAND_TONES.demoCollege.tint },
  samaj: { colour: BRAND_TONES.samaj.ink, behind: BRAND_TONES.samaj.tint },
  paleYellow: { colour: "103 106 98", behind: "255 254 248" },
};

/** Fails unless the initials `locator` finds are `want`, one of INSTITUTION_INITIALS, and read (expectInitials). */
export async function expectInstitutionInitials(locator, want, where) {
  const look = await expectInitials(locator, where);
  if (look.colour !== want.colour || look.behind !== want.behind) throw new Error(`${where} are rgb ${look.colour} on rgb ${look.behind}, not the institution's ink on its tint (rgb ${want.colour} on rgb ${want.behind})`);
  return look;
}

/**
 * The edges of `card` (one element, such as a post card), as paintedColour sees them: `own`, the card's background as
 * the eye gets it ("r g b"), and `top` and `left`, each { colour, width, contrast }: the side's colour, its width in
 * pixels, and its contrast with `own`, the white a card's frame has to show against (WCAG 1.4.11: 3:1) whichever page
 * the member chose. A side with no border fails, as paintedColour does.
 */
export async function cardEdges(card) {
  const { colour: own } = await paintedColour(card, "backgroundColor");
  const side = async (name) => {
    const { colour } = await paintedColour(card, `border${name}Color`);
    const width = await card.evaluate((el, property) => parseFloat(getComputedStyle(el)[property]), `border${name}Width`);
    return { colour, width, contrast: contrastOf(colour, own) };
  };
  return { own, top: await side("Top"), left: await side("Left") };
}

async function expectContrast(locator, property, where, min, says) {
  let look;
  try {
    look = await paintedColour(locator, property);
  } catch (error) {
    throw new Error(`${where}: ${error.message}`);
  }
  const contrast = contrastOf(look.colour, look.behind);
  if (contrast < min) throw new Error(`${where} ${says} ${contrast.toFixed(2)}:1, under ${min}:1 (rgb ${look.colour} on rgb ${look.behind})`);
  return { ...look, contrast };
}

/**
 * Page colours as pageColours gives them: both apps' plain page, and the tints of it that the Institution colour
 * background gives Demo University (#1d4ed8) and Shri Gujarati Samaj (#c2410c): 8% of the brand (pageBackdrop).
 */
export const PAGE_COLOURS = { plain: "241 245 249", demoUniversity: "230 236 249", samaj: "244 235 233" };
/** A card's own background, as pageColours reads it. */
export const WHITE = "255 255 255";
/**
 * Grey text as textColour reads it in both apps, which draw the shared greys (GREYS in lib/tones.ts): the meta grey on
 * the plain page, the secondary grey on a tint or a photo.
 */
export const GREY_TEXT = { plain: "91 107 128", dim: "71 85 105" };

/** The text colour of `locator`, as "r g b" (painted over white and read back, as pageColours does). */
export async function textColour(locator) {
  return locator.evaluate((el) => {
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 1, 1);
    g.fillStyle = getComputedStyle(el).color;
    g.fillRect(0, 0, 1, 1);
    return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(" ");
  });
}

/**
 * The colours around `locator` (one element, such as a card), each as "r g b": `own`, the element's own background, or
 * null when it paints none, so a card that lost its background can't read as white; `surface`, what its content sits
 * on (its own background, or else the nearest box around it that paints one); and `page`, the nearest box around it that
 * paints a background and spans the window's width, so a card or a tray in between doesn't count. Each colour is painted
 * over white and read back, as computed colours come as rgb(), oklch() or color().
 */
export async function pageColours(locator) {
  return locator.evaluate((el) => {
    const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const paint = (colour) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, 1, 1);
      g.fillStyle = colour;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(" ");
    };
    const background = (box) => getComputedStyle(box).backgroundColor;
    const clear = (colour) => colour === "transparent" || /^rgba\(.*,\s*0\)$/.test(colour);
    const width = document.documentElement.clientWidth;
    let surface = el;
    while (surface && clear(background(surface))) surface = surface.parentElement;
    let page = el.parentElement;
    while (page && (clear(background(page)) || page.getBoundingClientRect().width < width - 1)) page = page.parentElement;
    return {
      own: clear(background(el)) ? null : paint(background(el)),
      surface: surface ? paint(background(surface)) : null,
      page: page ? paint(background(page)) : null,
    };
  });
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
