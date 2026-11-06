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
`MOBILE_WEB_URL` (default `http://localhost:8081`) and `SHOTS` (where screenshots go, default `e2e/screenshots`). A step
that fails leaves a full-page `FAILED-<step name>.png` of the script's main page there, and
`FAILED-<step name>-page<n>.png` of each other page still open (a step that signs in a second member drives two), and
the results give each page's address.

### The sign-in budget

The API allows 20 code requests per IP address an hour, and each phone waits a minute between codes. A full run of all
three scripts uses exactly 20: `pnpm e2e:web` 8, `pnpm e2e:admin` 4 and `pnpm e2e:mobile-web` 8. So:

- `lib.mjs` signs each phone in once per run (`apiSession`) and hands the tokens to every browser context that needs
  them (`signedInContext`, `signedInMobileContext`). A new journey should reuse a member already signed in rather than
  add a login.
- `pnpm e2e:mobile-web`'s third sign-in through the screens is the Shri Gujarati Samaj admin (`+91 90000 00004`): the
  next person after the forced sign-out, who then walks the admin console. No other script signs him in, so the console
  costs no code of its own; its steps run on that one session, in order, and need the Samaj demo data as
  `pnpm db:reset` leaves it.
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

- tenant picker → landing → phone + OTP → registration in three steps → auto-approved feed: "Signed in as" with the
  number on Basics, and one Back on every step; Back on an untouched Basics leaving for the landing page, which offers
  Join DemoU (not the sign-in button) instead of sending them back into the form; a photo on Basics, Continue refusing a
  missing name and focusing it, the Work step's heading taking focus, the step bar, Back and the browser's Back going to
  the step before with nothing lost, the browser's Back and Back on a Basics with something typed asking "Leave
  registration?" and Cancel staying, Skip for now putting Work back as it was last accepted, the profile question on
  About you, a server error sending the member back to Work with the headline focused, and the photo arriving with the
  profile;
- the feed's "Complete your profile" card: a section, not a post, scoring 55, its three heaviest missing items linking
  to their sections of My profile, and Not now leaving focus on the note in its place and the card gone after a reload;
- post, react (the theme writing Demo University's tones; the chosen chip their wash, apart from its tray and from
  white, with its icon filled in their ink at 3:1 or more on it, which the pointer still resting on it doesn't repaint,
  and the count in that ink), comment and edit; the live bell (a second member's reaction arrives with no reload); a pinned
  announcement and a poll vote; a poll with several choices, its drawn boxes saying which are chosen (`aria-pressed`)
  before the vote; the celebrations card and wishes; the weekly digest (run through the platform job endpoint, see
  `lib.mjs`);
- jobs: seeded cards with pay, experience and "+1 more" skills; the Work mode and experience filters behind More
  filters, checked once the list has loaded, and Clear filters; at a phone's width, the Backend Engineer page offering
  a member with no skills "Add your skills to see which you match" in place of a count, its link landing on My
  profile's Work (`#work`) near the top of the screen; posting a job with work mode, seniority, experience, skills
  (Enter adding one without posting the form), pay previewed as it will show, bullet points, a How to apply address and
  an Apply link opening in a new tab with noopener, its page offering its poster nothing to match; an edit of the title
  alone keeping every other field; Mark closed swapping the contacts and How to apply for "Applications closed"; a new
  job at the same company, typed in lower case with a double space, offered Use details from your last job at Smoke
  Labs, filling the website; deleting a job through the confirm dialog;
- rich text: the seeded meetup's bullets, its link opening in a new tab, and its email opening in place with nofollow;
  the Zylo Labs listing's bullets as one list with no dash left, its link, and a numbered list keeping its start;
- an RSVP; the directory: a search by a seeded skill finding Sneha with her Open to badge, the Open to filter behind
  More filters leaving Priya out, and Priya's card with her headline, then her profile: headline, skills, her current
  role before her past one, studies here and elsewhere, and a LinkedIn link with the right target and rel;
- businesses: search and filters, contact details only on a listing's own page; add (its logo a 4000 × 3000 photo of
  over 5 MB, made smaller in the browser before it goes up), edit, find it in My posts and delete it;
- My profile: the photo picker refusing a text file beside it, Cancel upload pressed while a photo is still being
  prepared sending nothing, a saved photo served as a 512-pixel square JPEG, and initials when a photo can't load; a
  headline, skills, a GitHub handle turned into its address and a past role, saved together, with an end year before
  the start refused in its row and a server error on `experiences.0.endYear` shown there; the meter moving to 75 with
  four skills, a link and a past role saved, asking for neither skills nor a link,
  and its bio item linking to About you; `#work` landing on Work on a phone with no sideways scrolling; and all of it
  on the profile other members open, found by the new headline; Delete account's confirm dialog, saying a suspension
  or blocks come back with the number, cancelled with the account still there;
- matching skills at a phone's width, with "typescript, aws" among the skills just saved: the Backend Engineer card
  showing TypeScript and AWS first, each with a check, then Node.js and "+1 more" on one line, its link's name saying
  "(you have this)" after each; its page keeping the job's order, the same two checked, and "You have 2 of 4 skills";
  "You have 0 of 4 skills" and no marks on Associate Product Manager; and the member's own job, asking for TypeScript
  among skills too long for one line, unmarked on its page and on its My posts card, whose chips shorten to fit;
- joining Demo College as that member (nothing sent): its landing page offering Join DCE and "Signed in as" rather than
  sending them into the form, and forgetting Demo College as the institution to start at, so Choose a different
  institution opens the list; the name from the account, Use a different number with a city typed asking first and
  Cancel staying, Use details from Demo University keeping that city, Undo keeping a headline changed after the copy,
  with focus back on Use details, and Back on Basics asking "Leave registration?", whose Leave goes to the landing page;
  re-applying after a rejection (answered by the script) prefilling every step, with the reason on each and no Use
  details offer;
- the phone layout: every section opens its own page, the More sheet, its active state, sections the institution has
  switched off, and the guards keeping the open screen when a refetch fails (the registration form keeping what's
  typed, even when the account details fail too);
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
  Mentor badge in the directory and on the new mentor's own profile;
- referrals: a job offered for referral, the Can refer filter, a request reported, one accepted into a live chat that
  opens with the note, closing a job closing a waiting request, and the bell;
- a chat notice in the bell opening its thread; notification settings, through a Settings link named by its word
  alone (its icon is silent); sign out;
- an ADMIN_APPROVAL tenant: Submit for approval, with the note that an admin will review the profile, landing on the
  pending screen; and a forced sign-out leaving nothing cached.

## Web (tenant admin + platform console)

```bash
pnpm e2e:admin
```

Covers:

- the tenant admin dashboard; approving and rejecting members, each toast naming the member; Approve all asking first
  (opened and cancelled, sending nothing); approving Pooja Bhatt from her new-member notice (answered by the script: its
  Approve and Reject 44px tall beside the link to her page, never inside it; an open Reject closing with a toast that
  says where she stands once the API's live notice of a change refetches the list showing her decided elsewhere, and
  not opening again by itself when she waits again; Approve sending the status the notice showed, and the notice then
  showing Approved); a member's page showing Kiran Joshi's whole profile (headline, skills, past role, studies
  elsewhere, Open to), and Make admin and Remove admin role each asking first (Cancel sending nothing), each toast
  naming Kiran, and both changes in the recent activity by the admin's name; his answers' Cancel putting back the
  saved ones, and the admin's own page, with its answers being edited, linking from its recent activity to Kiran's
  page, held from the visit before, which opens with no editor; approving a pending job after its full preview (the
  Robotics Intern's stipend, with its title an h2 and its parts h3s under the page's h1, and its skills compared with
  nothing of the admin's), and a pending business listing whose contact details show only once opened; a group waiting
  (answered by the script) approved in two presses, the first opening its name and description beside what members see
  until then and sending nothing, the second sending what was shown, refused as changed meanwhile and fetched again,
  then, with the preview showing the owner's new name, a press sending nothing and asking to check it again, and the
  next sending the new name; resolving the spam report by removing content;
- settings, saving only the switches that changed: unchecking Messaging unchecks Mentorship, and both come back on;
  Branding with Demo College's green chosen among the suggested colours (a drawn tick), a near-white colour typed
  showing the contrast warning with Save branding still enabled, and Save held, saying why, while the script holds a
  large logo's preparation, then free once the logo is in, with nothing saved;
- the Profile fields page saying degree and field of study are built in, and adding a profile question (Add field and
  the move arrows drawn as icons, the directory filter box disabled for short text and saying why), moving it up (in its
  new place while the script holds the move, with the arrows waiting until it's saved), and archiving it after the
  confirm dialog (Cancel first); importing an invitation CSV (once the profile questions are in) and joining through
  its link in a second browser, with the name filled in and the three steps; another invitation revoked through its
  confirm dialog (Cancel first sends nothing); an announcement that also goes by email, asked first in the app's dialog
  with the email box's count and the billing line, Cancel posting nothing, then Post and send; Demo University's Send
  pending asking first in a dialog that says it's billed (Cancel sends nothing), a refusal (answered by the script, as
  for a plan that stopped sending) closing the dialog and saying why, then a send (answered by the script, so nothing
  is billed);
- the reported business listing in Demo University's reports;
- chat reports: the dashboard tile and nav entry, the queue showing no message until an admin chooses to view it, the
  Open tab counting the open report (1, then 0 once it's resolved), a note typed and cancelled gone from the next
  view's dialog after Hide, the audit row the view writes, the audit log's Chat reports chip showing only that family
  and the console's Audit log link then showing the whole log again, with no filter written back, the messages
  discarded on leaving the page, a report another admin just handled, removing the reported message, and the page on a
  phone;
- analytics: the headline figures' changes (the period before scripted, so each direction shows) in words beside SVG
  arrows, never text arrows; the New members chart's weeks day first ("2 Nov") in an en-US browser; its Table switch
  keeping its name, pressed, with a row a week in place of the chart; "Updating…" with the 12 weeks' charts still up
  while the script holds the 26 weeks' answer; and the members CSV, with the profile's own columns after "Last active"
  and Rahul's seeded headline and skills in them;
- at a phone's width: the app header's Admin link (its icon alone, a 44px target, named with the work waiting as the
  console's dashboard counts it, the count in amber, and the sidebar's row named the same on a wider screen), and
  every admin page with no sideways scrolling: each section in the console's nav, the Members, Moderation and Reports
  status tabs, a member's page and the Branding tab;
- Appearance on My profile, as the Demo University admin: Plain chosen and no Cover tile without a cover; Institution
  colour saved and tinting the page (Demo University's tint) with its grey text a shade darker, on the feed after a
  reload too, with post cards painting their own white; the console's dashboard and Branding tab staying on the plain
  page; and Plain putting the page and its grey text back;
- the platform console: login, onboarding an institution with its first admin, a billing plan and usage, stats and
  user search, the institution comparison and its CSV, the chat reports list showing only escalated reports (and rows
  on a phone: the nav item's open count, why each is staff's, "About an admin" or "No other admin", and reports another
  member of staff must handle, or that no member of staff may take yet, or that are closed, each with its note and no
  link), opening an institution's admin console without being a member, a school's settings starting with Messaging,
  Groups and Mentorship off and saying why, and the admin console stacking on a phone.

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

- tenant picker → landing → login → OTP → registration in three steps → feed, as on the web: each step's button on the
  screen once, Back included; "Signed in as" with the number on Basics, and Back there (untouched, so nothing holds
  the page) leaving for the landing screen, which offers Join DemoU instead of sending them back into the form; with a
  name typed, the page held, Use a different number asking first and Cancel staying signed in, and Back asking "Leave
  registration?", Cancel staying with the name and Leave going to the landing screen; the step bar going back with
  Work kept, Skip for now putting Work back as it was last accepted, Back from About you and from Work, a server error
  sending the member back to Work with the page still held, and Join the network leaving the screen (it isn't held)
  with nothing holding the feed;
- the "Complete your profile" card: 0 for a name and a batch, its three heaviest missing items, Write a headline
  opening Edit profile at Work with Back going to My profile and then the feed, and Not now leaving focus on its note
  and the card gone after a reload;
- a post with a photo (the member's form offering no Announce), editing it, a Like on it (the chosen chip Demo
  University's wash, apart from its tray and from white, with a filled icon in their ink at 3:1 or more on it) and
  taking it back, the celebrations card and a poll vote; a poll with several choices, its drawn boxes saying which are
  chosen (`aria-checked`) before the vote;
- Edit profile: Cancel upload pressed while a photo is still being prepared freeing the picker at once and sending
  nothing, then a photo through the round picker, saved as a 512-pixel square JPEG; a headline, three skills and a past
  role in their sections, Done refusing an end year before the start, a server error on `experiences.0.endYear` in its
  row with "Check the details marked in Work." by the button, then all of it on My profile, the meter at 50 with what's
  still to add, skills no longer among it, and `?section=about` scrolling About you into view; Delete my account's
  confirm sheet, saying a suspension or blocks come back with the number, cancelled with the account still there;
- every section opening its own screen, with Events, Groups, Mentors and Funding behind More; My posts from the More
  hub, its tabs scrolling rather than truncating;
- jobs: seeded cards with place, pay, experience and "+1 more" skills; the Work mode and experience filters behind
  Filters, and Clear filters; the Backend Engineer page, its title the only heading holding it, with its facts, section
  headings, About the company, a How to apply link opening in a new tab with noopener, and Apply;
- matching skills: before the member has any, the Backend Engineer card marking none and its page offering "Add your
  skills to see which you match" in place of a count, the link bringing back the Edit profile left open and unsaved on
  the Profile tab, at Work with its draft, rather than stacking a second editor; once "typescript, aws" are saved,
  TypeScript and AWS first on that card, each with a check, then Node.js and "+1 more" on one line, with "(you have
  this)" after each in the card's name; its page keeping the job's order, the same two checked, and "You have 2 of 4
  skills"; and "You have 0 of 4 skills" with no marks on Associate Product Manager;
- an RSVP, with the description's bullets, link and mail link as on the web;
- the directory: a search by a seeded skill finding Sneha, her Open to badge short on the card and in full in its
  name, the Investing filter leaving Priya out, and Priya's full profile with her roles in order and a LinkedIn link
  with the right target and rel;
- businesses behind More: search, filters and contact details only on a listing's own page; the description's bullets
  as one list with the bullet marks hidden from screen readers, its numbered steps read out from 1 with the numbers on
  the left, and its link; add (its logo changed to a 4000 × 3000 photo of over 5 MB, made smaller before it goes up),
  edit, My posts and delete through the confirm sheet;
- notification settings persisting, opened from a Settings button named by its word alone; nested screens opened cold,
  and a notification tap landing on its target;
- direct messages between two seeded members (Arjun and Vikram), as on the web, including a report from tapping a
  message, a block, a cold start on a thread, and a lost socket frame recovered by the gap fill;
- groups, mentorship and referrals, as on the web, between two generated members and a member the run registers;
- the job form along the way: work mode, the last Seniority chip (Executive), skills (two too long for one line of a
  card), experience, pay previewed as it will show, a pay note, Responsibilities, a website, an industry chosen from a
  list and a contact email; the job's facts after posting and after an edit of the title alone, its page comparing
  nothing with its poster's skills; the edit form opening with Executive, last in its row, drawn on the screen; the
  poster's own card on Jobs unmarked though they have TypeScript, its long skills cut short with an ellipsis to stay on
  one line; a second job at the same company filling the website and industry from Use details from your last job at
  Smoke Labs; and "Applications closed", with the email gone, once the job is closed;
- a current pupil seeing none of them; sections switched off; the guards (the registration form keeping what's typed,
  even when the account details fail too); re-applying after a rejection (answered by the script) prefilling every step
  with the reason on each; joining Demo College from its landing screen's Join DCE (it doesn't send a signed-in
  non-member into the form, and forgets Demo College as the institution to start at, so Choose a different institution
  opens the list), with Use details from Demo University and Undo keeping a headline changed after it, then Submit for
  approval with its note, landing on the pending screen; switching institution and signing out from the More hub; a
  forced sign-out leaving nothing cached;
- the admin console, as the Samaj admin: More's row named "Admin console, 2 waiting", and My profile's link; the
  console's home with no tab bar and no sideways scrolling, its "Pending members, 2" tile in amber and "Content to
  review, 0" not, no report tiles with none open, the four figures at a glance, the Growth and activity charts link,
  the approval sentence, and a row for every section, Analytics first, with nothing left for the web console; Back to
  More and to My profile; a chat report's notice tapped in Notifications opening the
  open chat reports (saying the report isn't there, as Samaj has none), with Back returning to the list;
  Appearance from My profile (a 44px link with an SVG icon; Plain chosen, no Cover
  tile, each tile 44px), Institution colour saved and tinting the screen (the Samaj's tint) with `Muted` text a shade
  darker, and the feed after a reload with its post cards painting their own white, the console's home staying on the
  plain page, and Plain putting the page and its grey text back; the console's Settings, reached from the approval
  sentence's 44px Settings link (and later from the section's row), saying the plan has no messaging, a blank batch year
  refused under its box with nothing sent, a save refused while another admin's change comes back (both answered by the
  script) starting the form again from the stored settings and still saying "Couldn't save: …", Messaging off clearing
  Mentorship and holding it with "Needs Messaging", and Funding saved off (sending only that switch) with More dropping
  it at once, then back on;
  Branding, from Settings' 44px row: the Samaj's orange chosen among the suggested colours, the tagline saved with the
  preview following it, Save held (saying why) while the script holds a large logo's preparation and free again once
  it's cancelled, with nothing uploaded, a near-white colour showing the contrast warning without holding Save, "#12"
  refused under its box (and by Save) with nothing sent, Teal (a 44px radio) chosen and saved, the screen's and
  Settings' buttons taking it at once, and the Samaj's colour and tagline put back;
  Profile fields, adding "Seva team …" in the modal editor (the key following the question,
  options added by Return and by Add, the directory filter box disabled for short text and for admin-only answers),
  moving it up (in its new place, said, with the arrows waiting, while the script holds the move) and down, a move the
  script refuses put back with "Couldn't move it" while the list's refetch is held, archiving it after the confirm sheet
  (Cancel first), and Show archived listing it to restore, after a reload too; and, with the role taken away (answered
  by the script), the console leaving for the feed with one set of tabs, More dropping its row, and the console opened
  cold doing the same;
- the console's members list, as the Samaj admin: the Pending tile opening Pending with its count, Parth Joshi and Diya
  Raval with their details line and 44px actions named for them, no sideways scrolling, and Approve all asking first
  (Cancel sends nothing); Parth approved from his new-member notice (answered by the script) after its confirmation,
  its Reject opening the reason sheet first, an open reason sheet closing and saying where he stands once the API's
  live notice of a change refetches the list showing him decided elsewhere (and not opening again by itself when he
  waits again), Approve sending the status the notice showed, the same notice then refused as "already approved",
  showing Approved or "No longer waiting" once dealt with, and its text opening his page in the console with Back
  returning; Diya rejected through the reason sheet, its Reject held under 3 characters, a server failure (answered by
  the script) keeping the sheet open with the error and the reason typed, and a refusal saying she was already
  rejected closing it, saying so and refreshing the list; then listed under Rejected with her reason, where a refusal
  (answered by the script) says she has already been approved, the Approve sent the status her row showed, and the list
  refreshes; the Approved tab, its answer held back by the script, showing a spinner and none of Rejected's rows or
  buttons until its own arrive; searching for Nisha, and for Jignesh, whose own row says "You" with no actions; and a
  second page (answered by the script) loading on scroll, a row repeated across the pages shown once;
- a member's page and the audit log, as the Samaj admin: Nisha Modi opened from her row in the members list, with her
  facts (her phone as the console writes it, her place by name, what she does), her mentor profile listed in Mentors
  with its areas and availability, no sideways scrolling, and Remove as mentor asking first (Cancel sends nothing); her
  answers edited, Chapter saved as Diaspora ("Answers saved"), then Surat chosen and cancelled, the saved answer
  standing and the next edit starting from it; View profile in the app leaving the console for her profile, back on the
  tabs; an admin-managed question (added by the script) given to the admin as a text box, saying only admins see the
  answer, and sent by Save; Parth Joshi made an admin and the role taken away again, each through its confirmation
  (Cancel first sends nothing), the Admin badge following, and his recent activity naming Jignesh Patel with the changes
  made; the audit log from the console's home, opening on All, its Members chip showing Diya's rejection with its
  reason, a prefix typed by hand that is no chip's ("membership.app") leaving none chosen, and one that is
  ("chat_report.") choosing that chip and finding nothing, Clear choosing All again, a membership row opening Diya's
  page with Back keeping the filter, and a row carrying a phone hash (answered by the script) showing its other details
  and never the hash;
- the console's moderation and reports queues, as the Samaj admin: Moderation from the console's sections, opening on
  Awaiting approval with its count, All types chosen, "Nothing is waiting for review." and no sideways scrolling; a
  group waiting (answered by the script) approved in two presses, the first opening it (Hide says it's expanded) with
  what members see until then and the note that chat messages are never shown, sending nothing, the second sending the
  name and description shown, refused in its row as changed meanwhile, and the group fetched again, then, with the
  preview showing the owner's new name, a press sending nothing and asking in the row to check it again, and the next
  sending the new name; Hetal's job under Published and Job, its preview with the title an h2 and "About the role" an
  h3, the apply link as text, no link but the row's Open in app, no Apply and no skills compared, and Kiran's closed job
  showing its closed line and "No apply link, email or phone."; Nisha's post removed through the reason sheet, Cancel
  keeping the note for next time, then restored from Removed; Hetal's post pinned and unpinned, the button's SVG icon
  and its label following; a link with `item=` opening that post's preview, and a content notice (answered by the
  script) opening Awaiting approval with Post chosen, saying the item isn't waiting any more, Back returning to
  Notifications, and the notice tapped again once the script lists the post as waiting, the queue cached by the first
  visit fetched again rather than taken for the answer, so the post opens with no "isn't waiting" line; Open in app
  leaving the console for the post's own page with one tab bar; Hetal's post reported from the feed, then the console's
  "Open reports, 1" tile opening Reports on Open with its count, the row labelled Spam, Post and Published (never the
  raw status), with the reporter, the details and the post's words; Dismiss refused (answered by the script) as already
  handled, closing the sheet, saying so and refetching the list; Resolve, keep content with a note, then "No open
  reports" and the note under Resolved; and a report notice (answered by the script) for it saying it has already been
  handled, then, tapped again once the script lists it as open, the Open list fetched again and the report shown with no
  "already handled" line;
- chat reports in the console, as the Samaj admin, the list and every view answered by the script (so no view writes an
  audit row) and each view the app asks for counted: the tile and the row with the open count, the Open tab with it, the
  privacy lines, and who reported whom and why with no words anywhere in the page until View messages; the thread
  oldest first with the reporter's note, "System message", "Reported message" and "Removed", 44px actions, the link to
  the reported member's page, no sideways scrolling, and Hide taking the words away; the words gone from the page (where
  hidden screens stay) with that member's page opened over them and after Back, after a tab change, and with the page
  hidden as when the app goes to the background, each View asked for once; a request report's note with Resolve and no
  Remove message, while a message's view held back by the script lands after it and is dropped; a view refused by the
  hourly limit said in its row, one refused as out of date said under the tabs with the list fetched again, and one
  refused only after another report was opened said nowhere and fetching nothing; the words going when the list's next
  answer leaves the report out, and not coming back when it returns; a note typed in the Remove sheet kept through
  Cancel, gone with the sheet when the app goes to the background, and not in the next view's sheet; Remove message
  with a note refused as already handled, closing the sheet, saying so and fetching the list again; Remove failing
  after the app went to the background took its sheet, said under the tabs; Dismiss sending its note, saying so, and
  the report leaving the list and the count; and a chat report's notice opening the list scrolled to its report
  (twelfth in the list) without opening it, then View there scrolling the row up so its words, down to Hide, are on
  screen;
- Announce in the post form: not offered to platform staff who are only members of the Samaj (the API's answers with
  `isPlatformAdmin` and a member's role, which the app counts as an admin), as the API refuses them; as the Samaj
  admin, the audience not asked for until Announce is pressed (its SVG icon, then "Undo announce" pressed), every
  member's count, no channel boxes and the line saying the plan has none, Pin on to start with and toggling, Post
  announcement sending it pinned with no channels and no sheet, and the feed showing it first, above the Samaj's pinned
  welcome, with its Announcement and Pinned badges drawn with SVG icons; on a plan with WhatsApp and email (the audience
  and the post answered by the script, so nothing is billed or stored), both boxes with their counts and the line saying
  each member still gets one message, email alone asking first in a sheet with its count and "Messages are billed to
  your institution.", Cancel sending nothing and keeping the text, then both asking "by WhatsApp or email?" with one
  message each to every member, by email only when WhatsApp can't be sent, and Post and send sending it pinned with both
  channels and going back to the feed; then the console's queue listing the real one with both badges, and Unpin there
  leaving it an announcement on the feed, no longer pinned;
- the console's invitations, as the Samaj admin: none yet, Can send today read as none and no Send pending on a plan
  that sends nothing, no sideways scrolling; the import modal's Template downloading invitations-template.csv with its
  byte order mark, the questions' keys as columns and the example phone unguarded; a two-row CSV picked through the file
  chooser (the document picker's web input), previewed with the columns used and ignored, Send now disabled, imported
  ("2 new, 0 updated, 0 skipped.") after the script has held the request long enough to see "Importing 0 of 2…" and
  "Keep this screen open…" and the bar's Back leave the screen where it is, and Done saying "2 invited, 0 updated" on
  the list; Copy link read back from the clipboard; WhatsApp opening a new tab at wa.me with the number and the Samaj's
  message (answered by the script); a search kept in the address; Revoke through its sheet (Cancel first), the row then
  Revoked, listed under the Revoked tab, which a reload keeps; and, with the plan said to send by WhatsApp (answered by
  the script, so nothing is billed), Send 1 pending asking first and saying it's billed (Cancel sends nothing), a
  refusal (as for a plan that stopped sending) closing the sheet and saying why on the list, then "Sending 1
  invitation", and a row's Send saying "Invitation sent";
- the console's analytics, as the Samaj admin: opened from the console's Analytics row on the last 12 weeks, the
  compared headline tiles (the period before scripted, so each direction shows) named with their change ("New members,
  12. +20% vs the previous 12 weeks (10)") and drawing it as an SVG arrow beside the words, never a text arrow; the New
  members chart a slider named by its summary whose value is the latest week's readout ("Week of …, N approved"), the
  left arrow key stepping it a week back; "Last 6 months" putting `weeks=26` in the address and asking the API for 26
  weeks, the 12 weeks' charts staying up with "Updating…" while the script holds the answer, and the headline figures
  then compared with "the previous 6 months"; the New members card's Table switch keeping its name, pressed, and listing
  27 rows (its header and 26 weeks) in place of the chart; the invitations funnel's table saying Imported 2; Activity's
  table with its five headers whole on one line and every row's figures right under them; no sideways scrolling; the
  members CSV saying "Preparing…" while the script holds it, with Activity CSV disabled until it's saved (one export
  at a time), then downloaded as shri-gujarati-samaj-members-<date>.csv with one byte order mark and the Samaj's
  Chapter among its columns; and a reload keeping 6 months.

Note: on the web export, screens underneath stay mounted (React Navigation keeps inactive tab stacks and stacked
screens), so the script picks the last visible match and dispatches clicks directly in a few places. On iOS and
Android the native navigation doesn't have this quirk.

Not covered by any script: reporting a declined, withdrawn or closed mentorship or referral request's note, and the
admin's view of a note report from the API (**View request** in Chat reports; the phone journey's is answered by the
script). The API tests cover them. Nor is the last registration
step's **Join the network** for an invitation at an institution that approves members automatically but has invitation
auto-approve off, as no seeded institution is set up that way.

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

- [ ] On the feed, press and hold a reaction on a post: the chip shrinks a little while held. Once chosen it is a light
      brand tint with a thin ring and a filled icon, and the count beside it turns the brand colour; Like again takes it
      back. Check it at Demo University (blue), and at Shri Gujarati Samaj (orange) as Hetal (`+91 91000 00031`).
- [ ] TalkBack or VoiceOver reads the chosen reaction as selected and the other three as not.
- [ ] Add a business: the form opens as a modal and closes cleanly, and choosing a logo opens the phone's own photo
      picker and shows the logo once it's uploaded.
- [ ] Tab labels on screens with tabs (My posts, Jobs, Mentors, Groups) aren't clipped.
- [ ] TalkBack or VoiceOver, on Zylo Labs in Businesses: the contact buttons read "Website" (with a hint that it opens
      in the browser), "Email hello@zylolabs.example" and "Call +91 22 5550 0101", with no symbol names. As Rahul, edit
      his Zylo Labs listing in Funding to add an email address and a phone number: its buttons read "Website", "Get in
      touch" and "Call …" the same way.
- [ ] TalkBack or VoiceOver, on the waiting screen: sign one phone out, join Demo College with a number that isn't in
      the demo data, and submit for approval. The screen reads "Awaiting approval" and its text, with nothing read for
      the icon above them. Sign Rahul back in afterwards.

**Photos**

Every photo is prepared on the phone before it goes up (README → Photos and uploads). Take the photos below with the
phone's own camera first, so they are in its library. Each one should upload, with no message under the button, and
show in its preview and, once saved, on its card or page the right way up.

- [ ] iPhone, with Settings → Camera → Formats → High Efficiency on (photos saved as HEIC): a photo as a post's image,
      an event's cover, a business's logo and a job's logo.
- [ ] iPhone 15 Pro or later, a 48-megapixel photo (Settings → Camera → Formats → Resolution Control on, then 48 MP in
      the Camera app), or a panorama: as a profile photo (the system editor crops it, then the round preview shows it)
      and as a post's image.
- [ ] Android: a HEIF photo (on a Samsung, Camera settings → Picture formats → High efficiency pictures; or a .heic
      sent from an iPhone and saved to the gallery) and a full-resolution photo of 50 megapixels or more, each as a
      post's image. On a phone with little memory, the app doesn't close while preparing it.
- [ ] A PNG logo and a GIF logo with see-through backgrounds (save them from a browser to the library), and a large
      cut-out PNG (a 3000 × 3000 photo of a person on a clear background) as a post's image: on the business's card
      and page and in the post, the background stays see-through, not black or white.
- [ ] Pick a large photo as a profile photo and choose Cancel upload at once, while it is still being prepared: the
      button goes back to Add photo with "Upload cancelled." read out, and nothing is uploaded (no photo appears).
- [ ] The web app in iPhone Safari: a HEIC photo as a post's image uploads and shows, the right way up.

**Profiles and registration**

For the registration checks, sign one phone out (More → Sign out) and join Demo University with a number that isn't in
the demo data, then sign Rahul back in. For the copy banner, Rahul opens Demo College under More → Switch institution:
leave without sending, or he'll be waiting for approval there.

- [ ] On "Step 1 of 3 · Basics", choose Add photo: the first time, the phone asks for access to your photos. Allow it
      and pick a photo: the system editor crops it square, and the round preview shows it once it's uploaded. On the
      other phone, deny access (or turn it off in Settings first): "Allow photo access to choose an image." shows under
      the buttons.
- [ ] Disconnect the computer running the API from the network, so the upload hangs, and pick a photo: Cancel upload
      stops it, the button goes back to Add photo, and focus stays there. Pick again and wait: after 90 seconds, "The
      upload is taking too long. Check your connection and try again." shows. Reconnect, and Add photo works again.
- [ ] On each registration step, tap the last box: it and the step's buttons (Continue, Skip for now, Back, Join the
      network) stay above the keyboard, with nothing hidden behind it. On Work, choose Add a past role and type in each
      of its boxes, the years too: Done and Remove stay reachable. Do the same on My profile → Edit profile, down to the
      links in About you, and in Add a place of study.
- [ ] Android especially: the long forms (Edit profile, Post a job, Add a business, Plan a gathering, New post) move up
      with the keyboard, so the box being typed in and the button at the bottom can be reached, with no blank band
      above the keyboard and nothing hidden under it. Closing the keyboard puts the form back, with no gap left at the
      bottom. These screens now make room for the keyboard on Android too, as the chats do, since an edge-to-edge window
      no longer shrinks for it.
- [ ] Android's back button and the iPhone's swipe from the left edge: on Work and About you they go to the step before,
      keeping what was typed (on the iPhone the screen springs back into place, with no flicker of the screen under
      it). On an untouched Basics they leave for the institution's landing screen, which shows Join and "Use a different
      number", not a fresh form. On Basics with a name typed, "Leave registration?" asks first: Cancel (and Android's
      back button on the sheet) stays with the name kept, and Leave goes to the landing screen. While Join the network
      is spinning (turn on airplane mode first, so it fails), they do nothing; the failure leaves them on About you with
      everything kept, and back works again. When the profile is sent, Join the network goes straight to the feed.
- [ ] Android, with registration the only screen: force-quit the app, open a link to `/t/<slug>/register` (or, as a
      member, be removed by an admin while the app is closed, then open it), fill in Basics, Continue, and press the
      back button: it goes to Basics, not out of the app. Back on Basics with a name typed asks "Leave registration?",
      and Leave opens the landing screen.
- [ ] Signed in at an institution they aren't a member of, whose landing screen is the one the app opened (as after
      being removed): Choose a different institution opens the list of institutions, not the same landing screen again.
- [ ] TalkBack or VoiceOver, on Basics: Back is read as a button on every step, and "Signed in as" and the number are
      read before "Use a different number", a button. With a name typed, Use a different number opens the sheet, read as
      an alert named "Use a different number?", and Cancel (or Android's back button) closes it, still signed in.
- [ ] TalkBack or VoiceOver, in Edit profile: Remove on a past role says "Removed" and its name, and focus moves to
      Add a past role; Done folds a row and moves focus to its Edit button; Done on a row whose end year is before its
      start says the problem and moves focus to that year.
- [ ] TalkBack or VoiceOver, on Rahul's registration at Demo College: Use details from Demo University reads out what
      it filled in and moves focus to Undo. Type a batch, Continue, change the headline on Work, go back to Basics and
      choose Undo: it reads out what it kept, and focus goes back to Use details from Demo University.
- [ ] My profile → Or edit → About you opens Edit profile scrolled to the About you heading, and Work to the Work
      heading. This checks the scroll to a section (`measureLayout`) on the new architecture.
- [ ] TalkBack or VoiceOver, on Rahul's feed: Not now on "Complete your profile" moves focus to "Hidden for 14 days. My
      profile always shows what's left to add." The card stays away on the other phone and after restarting the app.
- [ ] TalkBack or VoiceOver, on Rahul's My profile: Delete my account opens the confirm sheet (it used to be a system
      alert). It's read as an alert named "Delete your account?", then the whole explanation, including "If you were
      suspended at an institution, or members there had blocked you, that still applies if you join again with this
      number.", then Delete account and Cancel, and focus stays in the sheet until it closes. Cancel (and Android's
      back button) closes it and leaves the account. Don't confirm it as Rahul.
- [ ] Links open the phone's browser, and coming back finds the app where it was: LinkedIn on Priya's profile
      (Directory), Apply and the address in How to apply on "Backend Engineer (Node.js)", its website under About the
      company, and the map link in the Mumbai alumni coffee meetup. The meetup's email address opens the mail app.

**Jobs**

- [ ] On Post a job, the chip rows too wide for the screen (Type, Seniority, Currency and Company size, at least)
      scroll sideways. Tapping a chip partly off the screen scrolls its row until the chip is whole on the screen, and
      a row whose choice is already in view stays where you left it. Post a job with Executive seniority and a company
      size of 5,001+, then Edit it: the form opens with both chips on the screen, though each is last in its row.
- [ ] TalkBack or VoiceOver, with one phone signed in as Vikram (`+91 91000 00005`), whose profile lists SQL: on Jobs,
      the card for Priya's "Associate Product Manager" is read in full, title first, with its skills as "SQL (you have
      this), Product management, A/B testing, 1 more". On its page, the SQL chip is one stop read as "SQL (you have
      this)", the other skills are read by name alone, and "You have 1 of 4 skills" follows them.
- [ ] Sign in with a number that isn't in the demo data and join with Skip for now on Work, as in the registration
      checks above, so the profile lists no skills. On My profile choose Edit profile and type a headline without
      saving, then open Jobs → "Backend Engineer (Node.js)" and choose Add your skills to see which you match. The
      Profile tab comes back with that same editor, scrolled to Work and the headline still typed, and Back (and, on
      the iPhone, the swipe back) goes to My profile, never to a second editor.

**Admin console**

For these, sign one phone in to Shri Gujarati Samaj as its admin, Jignesh Patel (`+91 90000 00004`), who has two members
waiting for approval. Sign Rahul back in afterwards.

- [ ] More shows Admin console with an amber 2, and TalkBack or VoiceOver reads the row as "Admin console, 2 waiting".
      My profile has an Admin console link too. Each opens the console, with no tab bar, and Back (and, on the iPhone,
      the swipe back; on Android, the back button) returns to where it was opened.
- [ ] TalkBack or VoiceOver, on the console's home: each tile is one stop, read as its label and count ("Pending
      members, 2"), then its hint; "Needs you", "At a glance" and "Sections" are read as headings; and the sections'
      icons are silent.
- [ ] Pulling the console's home down refreshes it.
- [ ] With the app closed, have a new member ask to join: on a computer, join Shri Gujarati Samaj in the web app with a
      number that isn't in the demo data and submit for approval. Tap the push on the phone: the app opens on the new
      member's page in the console, with the console's home under it. Back (and the iPhone's swipe back) goes to the
      console's home, then to the Samaj feed, with one tab bar, never a blank screen; on Android one more Back leaves
      the app rather than showing the Samaj feed again (the phone remembers the Samaj, so the start screen redirects
      there as the push opens: one Samaj, not two). Do it again with the app open on another tab: Back returns there, by
      way of the console's home. Then once more with the console's home already open: the push opens the member's page
      above it, and a single Back returns to the console's home.
- [ ] In Notifications, that member's notice has Approve and Reject under its text, and TalkBack or VoiceOver reads
      them with the member's name ("Approve …", "Reject …"). Approve asks first; Cancel. Tapping the notice's text opens
      the member's page, and Back returns to Notifications.
- [ ] On the members list, choose Reject on that member: with the keyboard up, the reason box and the sheet's Reject
      and Cancel stay above it on both phones, and Reject stays disabled until the reason has 3 characters. On Android
      the back button closes the sheet (the keyboard first, if it's up), and opening Reject again still shows what was
      typed. Reject with a reason: the line above the list says so, and TalkBack or VoiceOver reads it out without
      moving focus.
- [ ] TalkBack or VoiceOver on the members list: the status tabs are read as tabs with their counts, and each row's
      buttons with the member's name ("Approve Parth Joshi", "Reject Parth Joshi"), so one row's can't be mistaken for
      the next's. The admin's own row (search Jignesh under Approved) says "You" and has no buttons.
- [ ] Open Nisha Modi from the members list (Approved) and choose Edit answers under Profile questions: the editor
      scrolls into view. On a small phone, pick a Chapter and type in any text or number question: with the keyboard up,
      the field being typed in, Save answers and Cancel can all be reached by scrolling, on both phones. Cancel puts the
      saved answers back; Save says "Answers saved" and shows them.
- [ ] On that page, TalkBack or VoiceOver reads the facts as label then value ("Phone", "+91 91000 00036"), and a
      long press on the phone number offers Copy. Make admin and Remove as mentor each open a confirmation; on Android
      the back button closes it, and on both phones Cancel changes nothing.
- [ ] Moderation → Published → Post, Remove on a post, on the smallest phone you have: with the keyboard up, the note
      box and the sheet's Remove and Cancel stay above it. On Android the back button closes the sheet (the keyboard
      first), and Remove again still shows the note. Cancel it, so nothing is removed.
- [ ] Moderation → Published → Job, View full content on "Export Documentation Executive" and on a long job: the
      preview fits the screen with nothing cut off at the sides, the apply link can be selected but not tapped, and on a
      low-end Android a long preview scrolls smoothly. A post with photos (post one from Rahul's phone first) shows them
      as small thumbnails that load.
- [ ] New post, as the Samaj admin: TalkBack or VoiceOver reads Announce as a button, not selected, and once pressed
      as "Undo announce", selected; Pin to the top of the feed as a checked checkbox, and the line saying the plan has no
      channels.
      Post announcement goes back to the feed with "Announcement posted; members are being notified", the post first
      with its Announcement and Pinned badges. A member's phone gets the push. Unpin it from the console's Moderation
      afterwards. (On Demo University, whose plan includes email, as `+91 90000 00001`: ticking Also email it and posting
      asks first in a sheet; Cancel it.)
- [ ] TalkBack or VoiceOver on a queue row: its badges are read as words ("Announcement", "Pinned", "1 report"), View
      full content says whether it's expanded, and each Approve, Remove or Pin is followed by the item's opening words,
      so one row's can't be mistaken for the next's. Open in app says it leaves the admin console, and does: the post
      opens with one tab bar, and More → Admin console returns.
- [ ] Report a post from the feed, then open the push or the notice: Reports opens on Open with that report, and
      Resolve, keep content with a note says "Report resolved" in the line above the list, read out without moving focus.
- [ ] Settings: tap "Earliest batch year". The number pad comes up with the box still in view above it, on the iPhone
      and on Android, and only digits go in (four at most). Scroll down with the keyboard up: Save settings can be
      reached. TalkBack or VoiceOver reads Mentorship, with Messaging off, as a dimmed (disabled) checkbox and then
      "Needs Messaging".
- [ ] Settings: switch Funding off and save. With VoiceOver on, "Settings saved" is read out once (not again when the
      form starts over from the saved settings). Back to More: Funding has gone without a pull to refresh. Switch it back
      on. (Signed in as the demo-school admin, `+91 90000 00003`, the last paragraph under the switches reads
      "Messaging, Groups and Mentorship start off for schools…" on the phone as on the web.)
- [ ] Settings → Branding, on the smallest phone you have: tap each box down the form in turn (Tagline, Welcome
      message, Website, City, the colour codes). Each stays in view above the keyboard while you type, Website brings up
      the keyboard for web addresses, and Save branding can be reached with the keyboard up. Country and Time zone open
      their lists over the form, and closing one leaves the form where it was.
- [ ] Branding's logo and cover: on the iPhone a HEIC photo (Settings → Camera → Formats → High Efficiency), on Android
      a full-resolution photo of 50 megapixels or more, first as the logo, then as the cover. Each uploads with no
      message under its button and shows in its preview the right way up (the logo round, the cover wide). While one is
      going up, Save branding is dimmed with "Save waits for the upload to finish." above it. Cancel upload while a
      large one is still being prepared: "Upload cancelled." is read out and nothing changes. Don't save: leave with
      Back, and the logo and cover stay as they were (the Samaj has none).
- [ ] Branding: choose Teal among the suggested colours and save. The console's buttons take it at once, and Back to
      More, the tab bar's chosen tab and the buttons and links in the app have it too, without restarting the app or
      pulling to refresh, and the status bar stays readable. Choose Orange (the Samaj's own) and save to put it back.
- [ ] Branding, TalkBack or VoiceOver: the preview is read once, as "Preview, Shri Gujarati Samaj, …" with the tagline;
      the suggested colours as radio buttons by name and code ("Teal, #0f766e"), saying which is checked. Type #fef9c3
      in Primary colour: the warning under it is read when you reach it, and Save branding stays enabled (leave with
      Back, without saving).
- [ ] Profile fields → Add field: the editor opens as a modal sheet (swiping it down, on the iPhone, closes it and
      keeps nothing). Type a question: the box stays above the keyboard and the key fills in. Choose "Choose one" in
      Answer type (its list opens over the sheet). In "Add an option…", type an option and press Return: it's added,
      the box stays focused and the keyboard stays up; add a second the same way, then remove it with its cross.
      Scroll to Add field with the keyboard up and save.
- [ ] Profile fields, TalkBack or VoiceOver: the arrows are read as "Move … up" and "Move … down", the first field's up
      and the last's down as dimmed; after a move the new place is read out ("… moved up: 2 of 3"), and focus stays
      on the arrow pressed.
- [ ] Audit log (from the console's home): the chips scroll sideways and each is read as a button with its state;
      Members fills the field with "membership." and TalkBack or VoiceOver reads each row's action, time, who acted and
      its details. A row's "membership …" link opens that member's page, and Back returns to the log with Members still
      chosen. Scroll fast to the end: more rows load with no repeats, and the line under them counts what's shown.
- [ ] Chat reports, signed in as Demo University's admin (`+91 90000 00001`), which has a seeded open report: the row
      says who reported whom and why, and no words. View messages, then open the app switcher (iPhone: swipe up and
      hold; Android: Recents): the app's picture there shows no message text, and back in the app the report is closed
      again (View messages). Do the same by switching to another app and back. Until this passes on both phones,
      README only says the app means to keep the text out of that picture.
- [ ] The same with the note sheet open: View messages, Remove message, type a note, then open the app switcher or
      Recents at once: the picture shows neither the note nor the messages, not even part way through the sheet sliding
      away. If it does, the sheet has to close without its animation when the app goes inactive. Back in the app, the
      report is closed, and View messages then Remove message opens an empty note.
- [ ] With the messages open, VoiceOver or TalkBack reads each message's sender and time, "Reported message" on the
      reported one, then its words; a long press on the words offers no Copy.
- [ ] From an open report, open "…'s member page", then go back (iPhone swipe back, Android back button): the report
      is closed, with no words. Remove message: with the keyboard up, the note box and Remove stay above it on both
      phones; on Android the back button closes the sheet. Cancel, and Hide.
- [ ] Invitations → Import a list → Choose CSV file: on the iPhone pick a CSV from Files (On My iPhone, then iCloud
      Drive), on Android from Downloads and then from Google Drive. Each shows its first rows and the columns used. A
      CSV that Excel saved with ";" between the columns reads the same, and one saved as "CSV UTF-8" with Gujarati
      names shows them correctly in the preview and, once imported, on the list.
- [ ] Import's Template opens the share sheet with invitations-template.csv (not .csv.csv). Save it to Files (iPhone) or
      Drive or Downloads (Android). Opened in a text editor (Files' preview, or Notes), the example row's phone reads
      +919876543210 with no ' in front, and the Samaj's question keys are columns. Opened in Excel or Google Sheets, the
      header row reads the same, but the example phone shows as a number (9.19876E+11 in Excel, 919876543210 in
      Sheets), as both read a leading + as a sign: so the import's hint says to format the phone column as Text before
      typing numbers. Do that in Excel, type +919876543210, save as CSV UTF-8 and import it: the row is new, not refused
      as scientific notation.
- [ ] Import a long list (a few thousand rows): while "Importing … of …" counts up, the bar's Back, the iPhone's swipe
      down and Android's back button leave the screen where it is, and "Keep this screen open until the import
      finishes." shows (VoiceOver or TalkBack says it on a blocked Back). Done then returns to the list, which says how
      many were invited.
- [ ] Copy link on a row, then paste it into WhatsApp or Notes: the whole link. WhatsApp on a row opens WhatsApp at
      that number with the invitation written in; with WhatsApp not installed, the wa.me page in the browser.
- [ ] TalkBack or VoiceOver on Invitations: each tile is read as its label and count, Can send today as "none" on a plan
      that sends nothing; each row's buttons with the person ("Copy link for …", "Revoke the invitation for …"); Revoke
      asks in a sheet, which Android's back button closes, changing nothing.
- [ ] Analytics (the console's Analytics row), with the phone set to another language and region (Hindi, India, then
      English, United States): the figures are grouped with commas ("1,234"), an axis that reaches 10,000 reads "10K",
      the weeks under the charts read "2 Nov" and the readout "Week of 2 Nov 2026", never "Nov 2" or a date a day out.
      These are written by hand, as Hermes lacks parts of `Intl`.
- [ ] Analytics: drag a finger along New members per week and Activity per week: the line above each chart follows the
      week under the finger, the chosen column stands out (a crosshair and dots on the lines), and the choice stays when
      the finger lifts. A drag up or down that starts on a chart scrolls the page instead, and leaves the week that chart
      had chosen as it was (scroll the whole page with a finger on the charts: no week is chosen in any of them).
- [ ] Analytics, TalkBack or VoiceOver: each week chart is one stop, read as its summary ("New members per week, 3 in
      total"), adjustable, with the latest week's readout as its value; swiping up and down (VoiceOver) or the volume keys
      or swipes TalkBack offers for a slider step a week at a time, reading "Week of …, 1 approved" (each series, by
      name, on Activity). The chart drawings and the line above them aren't read on their own. The headline tiles are
      read as their label and figure, then the change ("+12% vs the previous 12 weeks (10)"), with hints turned off too
      (VoiceOver's Speak Hints, TalkBack's usage hints); Table is read as a button that says whether it's on, its hint
      saying what pressing it does (shows the table, or the chart again), and a bar chart's rows as "Mumbai, 12
      members". Choosing Last 6 months says "Updating…" on both (VoiceOver is told it; TalkBack reads a live region).
- [ ] Analytics: choose Last 12 months and open New members per week's Table: on Android its 53 rows scroll inside
      the card, and the page scrolls once the table reaches its end.
- [ ] Analytics on a narrow phone (320 to 360 points wide), then with the largest text size: Activity per week's
      Table shows every header whole ("Comments" never broken inside the word) with each figure under its header; where
      the five columns don't fit, the table scrolls sideways inside its frame, and the page doesn't.
- [ ] Analytics: Members CSV says "Preparing…" (Activity CSV can't be pressed meanwhile), then opens the share sheet
      with shri-gujarati-samaj-members-<date>.csv (not .csv.csv). Closing the sheet without choosing anything shows no
      error. Save it to Files (iPhone) or Drive or Downloads (Android) and open it in Excel or Google Sheets: the names
      read correctly, Gujarati ones too, and the Chapter column is there. Do the same with Activity CSV.

**Appearance**

On Rahul's phone, under My profile → Appearance. Choose Plain again at the end, so the other checks see the plain page.

- [ ] Choose Your photo and pick a photo (on the iPhone, a HEIC one): it uploads, its tile shows it under the veil, and
      Feed, Jobs, a job's page and My profile show it faintly behind white cards, the right way up. Rahul's web app shows
      the same background after a reload.
- [ ] On a low-end Android, with the photo behind, scroll the feed and a long job's page: scrolling stays smooth, the
      photo stays put while the cards move over it, and opening or closing a screen doesn't flash another background.
- [ ] With the photo behind, grey text written straight on the page (the line at the top of Notification settings)
      reads easily, outdoors too.
- [ ] Choose Change photo and then Cancel upload while a large photo is still being prepared: the background stays as
      it was, and "Upload cancelled." is read out. Remove photo goes back to Plain, and focus moves to the Your photo
      tile.
- [ ] TalkBack or VoiceOver: the tiles are read as radio buttons in a "Background" group, saying which is checked, and
      Your photo, with no photo yet, says it opens your photos.
- [ ] As the Samaj admin (above), with Institution colour chosen: the console's screens stay on the plain page.
