# End-to-end smoke tests

Plain Playwright scripts that drive the real apps against a running API with the demo seed loaded.
They are deliberately simple (no test runner) so they double as a walkthrough of the product.

## Prerequisites

```bash
pnpm install
pnpm exec playwright install chromium    # once (or set PLAYWRIGHT_CHROMIUM_PATH to an existing Chromium binary)
pnpm db:reset                            # fresh schema + demo data (pending members, open reports, chats, …)
pnpm api                                 # http://localhost:4000, OTP_PROVIDER=console
```

Run `pnpm db:reset` before every run of the three scripts. They change the demo data as they go (the admin script
approves the pending fixtures and removes the reported chat message; the member scripts open chats between seeded
members), and a second run would find those states gone.

The scripts read `API_URL` (default `http://localhost:4000`), `WEB_URL` (default `http://localhost:5173`),
`MOBILE_WEB_URL` (default `http://localhost:8081`) and `SHOTS` (where screenshots go, default `e2e/screenshots`).

### The sign-in budget

The API allows 20 code requests per IP address an hour, and each phone waits a minute between codes. A full run of all
three scripts uses exactly 20: `pnpm e2e:web` 8, `pnpm e2e:admin` 4 and `pnpm e2e:mobile-web` 8. So:

- `lib.mjs` signs each phone in once per run (`apiSession`) and hands the tokens to every browser context that needs
  them (`signedInContext`, `signedInMobileContext`). A new journey should reuse a member already signed in rather than
  add a login.
- A request refused because the phone asked less than a minute ago still counts. `lib.mjs` waits and asks again, so
  running the scripts straight after one another, when some phones sign in in more than one of them (the pupil, the
  platform admin), can need 21 and stop the last sign-in.
- If a script stops with "Too many requests" (`RATE_LIMITED`), the machine has used its 20; "Too many codes requested
  for this number" means one phone has used its 5. Either way, run `pnpm db:reset`, which clears Redis and with it the
  counters.
- `pnpm demo` and the scripts share these counters, so signing in by hand during a run uses up codes too.

## Web (member journey)

```bash
pnpm web                                 # http://localhost:5173 (proxies /api to the API)
pnpm e2e:web                             # screenshots go to e2e/screenshots (or set SHOTS)
```

Covers:

- tenant picker → landing → phone + OTP → registration (with a profile question) → auto-approved feed;
- post, react, comment and edit; the live bell (a second member's reaction arrives with no reload); a pinned
  announcement and a poll vote; the celebrations card and wishes; the weekly digest (run through the platform job
  endpoint, see `lib.mjs`);
- post a job and delete it through the confirm dialog; RSVP; directory search and a profile;
- businesses: search and filters, contact details only on a listing's own page; add, edit, find it in My posts and
  delete it;
- the phone layout: every section opens its own page, the More sheet, its active state, sections the institution has
  switched off, and the guards keeping the open screen when a refetch fails;
- direct messages between two seeded members (Meera and Sneha): a request, accepted live, replies both ways with
  exactly one bubble each, a thread in a background tab not marking anything read, Try again reusing the client key, a
  refusal for sending too fast, a draft surviving a failed refetch, a report (and a second one), a block (the blocked
  member's messages never arrive, even after the unblock), a lost socket frame recovered by the gap fill, and the
  thread on a phone;
- a current pupil (Naina, Demo School) seeing no Messages, Groups, Mentors or referrals, with all of them switched on;
- groups: an open group found in Discover and joined, live messages both ways, an invite-only group's invitation
  accepted from Invitations (with the history before it hidden), leaving, archiving and My posts;
- mentorship: offering to mentor, finding a mentor by name, area and availability, a request reported, a request
  with the longest note accepted into a live chat that opens with the note, ending it read-only, the bell, and the
  Mentor badge in the directory;
- referrals: a job offered for referral, the Can refer filter, a request reported, one accepted into a live chat that
  opens with the note, closing a job closing a waiting request, and the bell;
- a chat notice in the bell opening its thread; notification settings; sign out;
- an ADMIN_APPROVAL tenant landing on the pending screen, and a forced sign-out leaving nothing cached.

## Web (tenant admin + platform console)

```bash
pnpm e2e:admin
```

Covers:

- the tenant admin dashboard; approving and rejecting members; approving a pending job, and a pending business listing
  whose contact details show only once opened; resolving the spam report by removing content;
- settings, saving only the switches that changed: unchecking Messaging unchecks Mentorship, and both come back on;
- adding a profile question; importing an invitation CSV and joining through its link in a second browser; an
  announcement that also goes by email;
- the reported business listing in Demo University's reports;
- chat reports: the dashboard tile and nav entry, the queue showing no message until an admin chooses to view it, the
  audit row the view writes, the messages discarded on leaving the page, a report another admin just handled, removing
  the reported message, and the page on a phone;
- analytics charts and the members CSV;
- the platform console: login, onboarding an institution with its first admin, a billing plan and usage, stats and
  user search, the institution comparison and its CSV, the chat reports list showing only escalated reports (and a row
  on a phone), opening an institution's admin console without being a member, a school's settings starting with
  Messaging, Groups and Mentorship off and saying why, and the admin console stacking on a phone.

## Mobile (Expo app exported for the web)

The Expo app can be exported with Metro and driven in a browser, which is a cheap way to exercise the screens without a
device. The API must allow the origin (`CORS_ORIGINS` includes `http://localhost:8081` in `.env.example`).

```bash
pnpm e2e:mobile:export        # Expo web export pointed at http://localhost:4000 (EXPO_PUBLIC_API_URL to change it)
pnpm e2e:mobile:serve         # in a second terminal: serves it on http://localhost:8081
pnpm e2e:mobile-web
```

If an Expo dev server already has port 8081, serve the export elsewhere with `node e2e/spa-server.cjs e2e/.expo-web
8082`, set `MOBILE_WEB_URL` to `http://localhost:8082` (PowerShell: `$env:MOBILE_WEB_URL="http://localhost:8082"`) and
add that origin to `CORS_ORIGINS`.

Covers:

- tenant picker → landing → login → OTP → register → feed; a post with a photo, editing it, the celebrations card and
  a poll vote;
- every section opening its own screen, with Events, Groups, Mentors and Funding behind More; My posts from the More
  hub, its tabs scrolling rather than truncating;
- jobs, an RSVP, directory search and a member profile;
- businesses behind More: search, filters and contact details only on a listing's own page; add, edit, My posts and
  delete through the confirm sheet;
- notification settings persisting; nested screens opened cold, and a notification tap landing on its target;
- direct messages between two seeded members (Arjun and Vikram), as on the web, including a report from tapping a
  message, a block, a cold start on a thread, and a lost socket frame recovered by the gap fill;
- groups, mentorship and referrals, as on the web, between two generated members and a member the run registers;
- a current pupil seeing none of them; sections switched off; the guards; the pending screen; switching institution and
  signing out from the More hub; a forced sign-out leaving nothing cached.

Note: on the web export, screens underneath stay mounted (React Navigation keeps inactive tab stacks and stacked
screens), so the script picks the last visible match and dispatches clicks directly in a few places. On iOS and
Android the native navigation doesn't have this quirk.

Not covered by any script: reporting a declined, withdrawn or closed mentorship or referral request's note, and the
admin's view of a note report (**View request** in Chat reports). The API tests cover them.

## Checks that need a real phone

Everything below has only run on the web export or in unit tests, so nobody has seen it on a device yet. Work through
it on one Android phone and one iPhone, and do each check on both unless it says otherwise.

**Getting set up**

1. With the phones on the same Wi-Fi as this computer, run `node scripts/setup-local.mjs --lan` so they reach the API
   here, then `pnpm db:reset` and `pnpm demo`. `pnpm demo` starts the API and the web app, not the phone app's Expo
   server: the next step starts that.
2. Install a development build on each phone, as Expo Go can't receive pushes or open `illuminize://` links. First
   create the Expo project (README → Mobile → Push notifications), or no pushes arrive. Then, in a second terminal,
   `cd apps/mobile` and:
   - Android, plugged in with USB debugging on: `npx expo run:android`.
   - iPhone, on a Mac with Xcode: `npx expo run:ios --device`. Without a Mac, use EAS Build, which needs a paid Apple
     developer account: the repo has no `eas.json` yet, so run `npx expo install expo-dev-client` and
     `eas build:configure` once, register the iPhone with `eas device:create`, then
     `eas build --profile development --platform ios` and install what it gives you.

   `expo run` starts the Expo server when it's done. Another day, start it with `pnpm mobile`. If you use Expo Go
   instead, run `pnpm mobile` and scan its QR code: everything works except pushes and the link checks.
3. Allow notifications when the app asks.
4. On each phone, sign in to Demo University as Rahul (`+91 91000 00001`). On a computer, open the web app as Priya
   (`+91 91000 00002`) to send messages to the phones, and in a private window as the Demo University admin
   (`+91 90000 00001`) for the admin steps.
5. Turn on TalkBack (Android) or VoiceOver (iPhone) only for the checks that ask for it.
6. A push about a chat comes 5 to 10 seconds after the message, and one about a group 30 to 60 seconds after. After a
   push, that chat sends you no other for 2 minutes (a group for 10) unless you open it or write in it, so wait between
   checks that need one.

**Messages**

- [ ] Open Rahul's chat with Priya and tap the message box. The box and the newest message stay above the keyboard,
      with no gap and nothing hidden behind it, and closing the keyboard puts the screen back.
- [ ] Type several lines. The box grows to its limit and then scrolls inside itself, and Send stays reachable.
- [ ] In a long thread (send 30 messages from the browser), scroll up to load older messages: what you're reading
      doesn't jump. While you're scrolled up, a new message from the browser doesn't drag you down: a New messages
      button appears, and tapping it takes you to the newest. In "London & UK alumni", each run of messages shows the
      sender's name.
- [ ] With the chat with Priya open and the phone unlocked, a message from her in "London & UK alumni" shows a banner
      (up to a minute later).
- [ ] A push for the chat on screen shows no banner. The API sends none while you're reading the chat, so send one
      yourself. The phones' tokens are what
      `docker compose exec postgres psql -U postgres -d illuminize -c "select platform, token from push_tokens"` lists,
      and the chat's id is the end of its address when Priya opens it in the web app. With that chat open on the
      phone, send its token a push from Expo's push tool (expo.dev/notifications) with the data
      `{"type": "CHAT_MESSAGE", "tenantSlug": "demo-university", "conversationId": "<the id>"}`: no banner. Go back to
      Messages and send it again: the banner shows.
- [ ] Force-quit the app, send a message from the browser, and tap the push. The app opens on that chat, and Back
      goes to Messages.
- [ ] With the chat with Priya open, put the app in the background, have Priya send a message, and tap its push. The
      app comes back on that chat, with no second copy of it: Back goes straight to Messages (and so does the iPhone's
      swipe back).
- [ ] Put the app in the background for a minute while Priya sends two messages, then bring it back. They appear
      without pulling to refresh, and new ones keep arriving live.
- [ ] Sign Rahul in on the web app too. On the phone, open the chat with Priya and put the app in the background, then
      send to that chat as Priya. The phone gets a push, and Rahul's web app counts the chat unread until the phone is
      back in front on that chat, which marks it read.
- [ ] Lock-screen text: a message from Priya shows "New message from Priya Nair"; a first message from someone with no
      chat with Rahul (sign in on the web as Sneha, `+91 91000 00006`) shows only "New message request". No message
      text appears anywhere on the lock screen.
- [ ] Turn on flight mode and send a message: it offers Try again. Turn flight mode off and tap Try again: it arrives
      once.
- [ ] Disconnect the computer running the API from the network, so the phone's request hangs instead of failing, and
      send a message: after about 20 seconds it offers Try again. Reconnect and tap Try again: it arrives once. (On
      Android this checks that the app's fetch honours its abort signal.)
- [ ] The message box and the search boxes offer no saved passwords or autofill suggestions on either keyboard.
- [ ] Tap one of Priya's messages and choose Report message: the sheet opens. In Conversation options, choose Block
      member: the confirm sheet opens once the first one has closed (iPhone especially). Unblock her afterwards under
      Messages → Blocked members.
- [ ] As the admin, remove a message the phone member sent (Admin → Chat reports, after reporting it from the
      browser). The push says only "A message you sent was removed", and the admin's note shows only in the app.

**Navigation**

- [ ] The tab bar fits Feed, Messages, Jobs, Directory and More, with a number on Messages, on the narrowest phone
      you have and with the largest text size. No label is cut off.
- [ ] Android: Back from a section behind More (Events, Groups, Mentors, Businesses, Funding) returns to the More
      hub, not out of the app. Back from a chat returns to Messages.
- [ ] With the app closed, open a job, business or mentor from a push or a link (for example
      `illuminize://t/demo-university/jobs/<id>`, with an id from the web app's address bar). Back (and, on the iPhone,
      the swipe back) goes to that section's list.
- [ ] Open such a link while the app is on another section: Back goes somewhere sensible, never to a duplicate screen.
- [ ] Sign out from More: you land on Demo University's own page, with "Sign in / Join with mobile number".
- [ ] My posts has seven tabs at Demo University (Posts, Jobs, Funding, Businesses, Groups, Events, Past events): they
      scroll sideways, the selected one scrolls into view, and no label is clipped.
- [ ] The web app in iPhone Safari and Android Chrome: open a chat, tap the message box, and the box stays in view
      above the keyboard.
- [ ] Bell notifications of each kind open their screen, a chat message's time and day labels look right, and a group
      whose name starts with an emoji (create "🏃 Morning runners") shows the initials "MR". These check `Object.hasOwn`,
      `Intl` and Unicode handling on Hermes.

**Groups**

- [ ] Create a group and edit it: the keyboard leaves the fields and the save button reachable. The invitation
      sheet's search box does too.
- [ ] TalkBack or VoiceOver reads the open and invite-only choices as radio buttons with their checked state, and a
      disabled choice as disabled.
- [ ] Have Priya create an invite-only group in the browser and invite Rahul. With the invitation waiting, More reads
      "Groups, 1 invitation" with TalkBack or VoiceOver, and long group names on cards are read in full.
- [ ] Android: Back from Groups (behind More), from a group's details and from its chat goes one step back each time.
- [ ] In "Batch of 2012 reunion committee", which Rahul owns, open Group details, tap Aisha Qureshi and choose Remove
      from group, then tap Priya and choose Block member. Each confirm sheet opens once the member's sheet has closed
      (iPhone especially). Cancel both, so the checks below still work.

In the next four checks, each button opens its screen once: Back (and, on the iPhone, the swipe back) never leads to a
second copy of a screen, or back to the page the button was on.

- [ ] Open a group's chat, then Group details, and choose Open chat: you're back on the chat, and Back goes to where
      you opened the chat from. On a member's sheet in Group details, View profile opens their profile in Directory.
- [ ] Have Priya create an open group in the browser. On the phone, find it in Groups → Discover, open it and choose
      Join group: its chat opens in place of the group's page, and Back goes to Discover.
- [ ] Before accepting the invitation from Priya (above), open `illuminize://t/demo-university/messages/<id>`, with
      the id from the end of that group's address in Priya's browser. The app offers See invitation, which opens
      Groups → Invitations.
- [ ] In Groups → Invitations, tap that group's name to open its page, and choose Accept invitation there: its chat
      opens in place of the group's page, and Back goes to Groups.
- [ ] Tap an invitation push (Priya invites Rahul again, to another new group), with the app closed and with it open:
      it opens Groups → Invitations, and Back works. With the app open, the invitation shows a banner.
- [ ] A push about a group's moderation opens My posts → Groups: have the phone member create a group, and the admin
      remove it under Admin → Moderation → Published.

**Mentorship**

- [ ] The request note and the Be a mentor fields stay above the keyboard.
- [ ] TalkBack or VoiceOver: a request row's name link is easy to hit, and after Accept, Decline or Withdraw the row's
      new status is announced.
- [ ] Android: Back from Mentors (behind More) and from a mentor's page and request form.
- [ ] Sign one phone in as Arjun (`+91 91000 00003`), who has no mentorship or request. Have the admin switch
      Mentorship off under Admin → Settings, then reopen the app: Mentors has gone from More. Switch it back on and it
      returns. Rahul, who has a mentorship under way, keeps Mentors behind More while it's off.
- [ ] Mentorship pushes. Have Priya ask Rahul for mentoring from the browser: tapping the push opens Mentors →
      Requests. Then have Sneha (`+91 91000 00006`, in the browser) offer to mentor under Be a mentor, ask her from the
      phone, and accept in the browser: tapping that push opens the chat.
- [ ] Sending a request (to Sneha, above) lands on Mentors → Requests → Sent, and going back never returns to the form
      or her page. While it waits, See your request on her page does the same. View full profile on a mentor's page
      opens their profile in Directory, and Edit mentor profile on Rahul's own mentor page opens Be a mentor, each once.
      Rahul's own page is `illuminize://t/demo-university/mentors/<id>`, with the id from the end of his profile's
      address in the web app's Directory.

**Referrals**

- [ ] On a job that takes referrals, Ask for a referral: the note field stays above the keyboard under the header
      (Android draws edge to edge on SDK 58), and on the iPhone dragging the page down closes the keyboard.
- [ ] Type a long note: the box grows and nothing is cut off.
- [ ] Have Priya ask for a referral on Rahul's "Backend Engineer (Node.js)" from the browser, with the app closed:
      tapping the push opens Jobs → Referrals. With the app open, referral pushes show a banner.
- [ ] Android: Back from the request form returns to the job.
- [ ] Sending a request (on Priya's "Associate Product Manager") lands on Jobs → Referrals → Sent, and Back doesn't go
      back to the form or the job. Back on the job, See your requests does the same.
- [ ] TalkBack or VoiceOver reads the "I can refer people for this job" checkbox with its state and its hint.

**Businesses and shared screens**

- [ ] Add a business: the form opens as a modal and closes cleanly, and choosing a logo opens the phone's own photo
      picker and shows the picked image.
- [ ] Tab labels on screens with tabs (My posts, Jobs, Mentors, Groups) aren't clipped.
