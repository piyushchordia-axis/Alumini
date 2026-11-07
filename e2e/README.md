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
members), and a second run would find those states gone. The API may stay up through it: the reset clears Redis again
once the seed is in, so nothing the API cached meanwhile (an empty institution list, asked for between the migration and
the seed, which the picker would show for a minute) outlives it.

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

### Colour checks

- `lib.mjs` reads colours as the eye gets them: `paintedColour(locator, property)` lays an element's text, icon,
  background, border or outline colour over the backgrounds behind it, and `contrastOf` gives their WCAG contrast.
  `expectReadable` (text at 4.5:1), `expectEdge` (an edge at 3:1) and `cardEdges` (a card's own colour and its top
  and left edges: colour, width and contrast with the card) are built on them, and a new colour check should be too.
  They don't see a photo under the page's veil, and they refuse a faded (disabled) element. An element a re-render
  replaced between being found and being read has left the page, which isn't a fade: `paintedColour` finds it again
  and reads that, a few times, before saying it kept leaving.
- `expectEmptyState(box, where, { actions, absent, tones })` checks an empty state or a chat notice, found from its
  title (the web's `h3` directly inside it, the phone's title as a direct child), or the note before a first message
  (the web's `role="note"` named by its title; on the phone the card two levels above the title, which sits in a column
  beside the icon, so the title's parent holds no icon): an SVG icon and no emoji, on a badge that isn't white, at 3:1
  on it, and the links or buttons it should and shouldn't offer. `tones` pins the badge and the icon to the
  institution's own wash and ink (`BRAND_TONES`, the seeded institutions' as `brandTones` gives them), which a grey
  badge would otherwise pass for; every check in the scripts gives them.
- `expectChoiceLook(choice, boxSelector, where, { checked, tile, tones, label })` checks a checkbox or radio as both
  apps draw them (`choice` the web's `<label>` or the phone's element with the role; the box the web's `input`, the
  phone's `:scope > div`): a clear box's edge the meta grey (`GREY_TEXT`) at 3:1; a chosen one in the ink at 3:1 on
  the choice, a checkbox's holding a drawn tick at 4.5:1 and no "✓" and a radio's ring a dot of its colour, on a wash
  that isn't white unless it's a bare row (`tile: false`, as the web's `Checkbox` is); and its label readable at 4.5:1
  either way. `tones` pins the box and the wash to `BRAND_TONES`. A disabled choice's faded box can't be read: check
  its label instead.
- `expectChipLook(chip, where, { chosen, tones })` checks a toggle chip (the web's `ToggleChip`, the phone's `Chip
  check`), a button with no box of its own, which `expectChoiceLook` can't read: its aria-pressed is `chosen`, it
  draws no "✓" or "✔" glyph, and its label (the chip's last child) reads at 4.5:1 on it. Chosen: a wash that isn't
  white and one drawn SVG tick at 3:1 on it. Not chosen: white, or all but (a hovered slate-50), with no tick. `tones`
  pins a chosen chip's wash, label and tick to `BRAND_TONES` (the wash and the ink).
- `fitsPhone(where, content)` fails when a screen of the phone app's web build is wider than the phone: the page, or
  any scrolling area around `content`, which react-native-web clips rather than widening the page.
- `expectWholeWords(locator, where)` fails when text in the elements breaks a word across lines ("Entrepreneurshi p"),
  as a column too narrow for it does: each run between spaces, hyphens, dashes and slashes must lie on one line
  (visually hidden text skipped). It fails too when it finds no words to check.
- `expectInitials` reads a photo's stand-in initials the same way (4.5:1 on a circle or tile of their own, or one
  filling a rounded frame that clips it, as a company's tile does), and `expectSameTone` compares two of them: one
  member's tone in two places. `INSTITUTION_INITIALS` is the seeded institutions' initials (their ink on their tint,
  `brandAvatarTone`, read from `BRAND_TONES`), and the pale yellow both Branding steps type, which
  `expectInstitutionInitials` checks for.
- `GREY_TEXT` is both apps' grey text as `textColour` reads it: the meta grey (`91 107 128`) on the plain page and the
  secondary grey (`71 85 105`) on a tint or a photo.

## Web (member journey)

```bash
pnpm web                                 # http://localhost:5173 (proxies /api to the API)
pnpm e2e:web                             # screenshots go to e2e/screenshots (or set SHOTS)
```

Covers:

- tenant picker → landing (the brand cover's short name and tagline) → phone + OTP → registration in three steps →
  auto-approved → the walk-through → the feed: "Signed in as" with the
  number on Basics, and one Back on every step; Back on an untouched Basics leaving for the landing page, which offers
  Join DemoU (not the sign-in button) instead of sending them back into the form; a photo on Basics, Continue refusing a
  missing name and focusing it, both years starting blank and asked for under the institution's labels ("Year you
  joined", "Year you left (or will leave)"), and an end year before the start refused; the Work step's heading taking
  focus, the step bar, Back and the browser's Back going to the step before with nothing lost, the browser's Back and
  Back on a Basics with something typed asking "Leave registration?" and Cancel staying, Skip for now putting Work back
  as it was last accepted, the profile question on About you, Open to's chips on About you (each 44px tall; Hiring
  chosen on Demo University's wash, in its ink, with a drawn tick, then white again with none, `expectChipLook`), the
  step bar's names at one and a half times the text size ("3 About you" on two lines on a 390px screen, and on 390 and
  320 every word whole and nothing cut short), at twice the text size on 320 "Collaborating" wrapping inside its chip
  and every chip inside the form with no sideways scrolling, a server error sending the member back to Work with the
  headline focused, and the photo arriving with the profile;
- the first-entry walk-through, which the front door opens on a page of its own with no app navigation and no Back on
  its first screen: "Welcome, Smoke" focused and described by "1 of 3", the brand cover's short name, Demo
  University's welcome message and one Skip, with SVG icons and no emoji; "Make your profile stand out" scoring 55,
  "Your photo and headline are in…", and its two links (Add at least 3 skills, Write a short bio) opening `#work` and
  `#about` on My profile, described by "Each opens My profile and ends this welcome."; Back focusing the first title
  again; "Find your people" listing Directory, Mentors, Groups, Messages, Events, Jobs, Businesses and Funding as links
  in a list (never a nav) named by the section alone, each at least 44px with an SVG icon, Directory's described "Find
  people by name or year"; Get started sending `POST …/memberships/me/welcome/done` and opening the feed; and, after a
  reload, the front door and the walk-through's own address both opening the feed. The second member the run
  registers shows it opens only at the front door: a link to the directory opens the directory with the app's
  navigation while it's owed; Skip with the POST refused still opens the feed, and the next entry at the front door
  brings it back; then the Directory row ends it (the POST answered) on the way to the directory;
- the feed's "Complete your profile" card: a section, not a post, scoring 55, its three heaviest missing items linking
  to their sections of My profile, and Not now leaving focus on the note in its place and the card gone after a reload;
- post, react (the theme writing Demo University's tones; the chosen chip their wash, apart from its tray and from
  white, with its icon filled in their ink at 3:1 or more on it, which the pointer still resting on it doesn't repaint,
  and the count in that ink), comment (the new post's "No comments yet" box, its icon in the institution's ink on a
  round wash, inviting the first reply and gone once there is one) and edit; the live bell (a second member's reaction
  arrives with no reload); the pinned strip, a region named "Pinned posts" holding the seeded announcement and welcome, each a white card saying
  Pinned once (an SVG pin, in the ink) above its author and framed 1px in Demo University's edge (3:1 on white,
  `cardEdges`), the announcement with its badge (its ink readable and its edge at 3:1) and a 4px left edge in the ink,
  the welcome with neither (Demo University's ink is its brand blue, so the line's and the edge's classes are checked
  too), the announcement's author's initials in the same tone, readable and not the institution's tint, on the pinned
  welcome post she also wrote, then a readable "Latest posts" heading between the strip and the posts after it, which
  stay in the grey border with no Pinned; a poll vote, marked with a drawn check (read as "your vote") rather than a ✓;
  a poll with several choices, its drawn boxes saying which are chosen (`aria-pressed`) before the vote; the
  celebrations card (a birthday row and an anniversary row with years) and wishes; the weekly
  digest (run through the platform job endpoint, see `lib.mjs`);
- jobs: seeded cards with pay, experience and "+1 more" skills, and with no logo, Zylo Labs's and Deloitte's initials in
  a tone from each company's name, readable, two tones apart and not the institution's; the Work mode and experience
  filters behind More filters, checked once the list has loaded, and Clear filters; at a phone's width, the Backend
  Engineer page's facts two across (their longest word fits) with every word whole, whole again at 320px with nothing
  scrolling sideways, and one to a row with every word whole beside a place too long for half the row
  ("Thiruvananthapuram", scripted with `scriptJob`), and the page offering a member with no skills "Add your skills to
  see which you match" in place of a count, its link landing on My profile's Work (`#work`) near the top of the screen;
  posting a job with work mode, seniority,
  experience, skills (Enter adding one without posting the form), pay previewed as it will show, bullet points, a How to
  apply address and an Apply link opening in a new tab with noopener, its page offering its poster nothing to match; an
  edit of the title alone keeping every other field; Mark closed swapping the contacts and How to apply for
  "Applications closed"; a new job at the same company, typed in lower case with a double space, offered Use details
  from your last job at Smoke Labs, filling the website; deleting a job through the confirm dialog;
- rich text: the seeded meetup's bullets, its link opening in a new tab, and its email opening in place with nofollow;
  the Zylo Labs listing's bullets as one list with no dash left, its link, and a numbered list keeping its start;
- an RSVP, the chosen answer in its tone (the success fill, its ink readable, an edge at 3:1, a drawn check and no ✓)
  and every answer 44px tall; the meetup's Going and Maybe lists answered empty (scripted), "No one has said yes yet"
  saying "Choose I'm going to be the first." and "No maybes yet" who it would list, each its own box with the icon
  in the institution's ink on a round wash; and London pub night, which is over, saying only that nobody has, inviting
  no one; the directory: a search by a seeded skill finding Sneha with her Open to badge, the Open to filter behind
  More filters leaving Priya out, Were there in beside the search ("Were there in 2012" and so on) leaving Priya
  (2008–2012) out in 2013, finding her in 2012, and Any year taking it off, and Priya's card with her headline, then
  her profile: headline, skills, her current role before her past one, studies here and elsewhere, and a LinkedIn link
  with the right target and rel;
- businesses: search and filters, contact details only on a listing's own page; add (its logo a 4000 × 3000 photo of
  over 5 MB, made smaller in the browser before it goes up), edit, find it in My posts and delete it;
- My profile: the photo picker refusing a text file beside it, Cancel upload pressed while a photo is still being
  prepared sending nothing, a saved photo served as a 512-pixel square JPEG, and initials when a photo can't load, in
  the member's own tone in the header and the picker alike, beside Demo University's initials in its ink on its tint; a
  headline, skills, a GitHub handle turned into its address and a past role, saved together, with an end year before
  the start refused in its row and a server error on `experiences.0.endYear` shown there; the meter moving to 75 with
  four skills, a link and a past role saved, asking for neither skills nor a link,
  and its bio item linking to About you; `#work` landing on Work on a phone with no sideways scrolling; and all of it
  on the profile other members open, found by the new headline, with the years given at registration (2008–2012) under
  the name on the card and the profile, and "Registered"; Delete account's confirm dialog, saying a suspension
  or blocks come back with the number, cancelled with the account still there;
- matching skills at a phone's width, with "typescript, aws" among the skills just saved: the Backend Engineer card
  showing TypeScript and AWS first, each with a check, then Node.js and "+1 more" on one line, each chip's text readable
  and its edge at 3:1, its link's name saying "(you have this)" after each; its page keeping the job's order, the same
  two checked (filled in the brand, readable, with an edge, as the others have), and "You have 2 of 4 skills";
  "You have 0 of 4 skills" and no marks on Associate Product Manager; and the member's own job, asking for TypeScript
  among skills too long for one line, unmarked on its page and on its My posts card, whose chips shorten to fit;
- joining Demo College as that member (nothing sent): its landing page offering Join DCE and "Signed in as" rather than
  sending them into the form, and forgetting Demo College as the institution to start at, so Choose a different
  institution opens the list; the name from the account, Use a different number with a city typed asking first and
  Cancel staying, Use details from Demo University keeping that city and filling in no years, Undo keeping a headline
  changed after the copy, with focus back on Use details, and Back on Basics asking "Leave registration?", whose Leave
  goes to the landing page;
  re-applying after a rejection (answered by the script) prefilling every step, with the reason on each and no Use
  details offer;
- the phone layout: every section opens its own page, the More sheet (grouped Connect, Community, You, its tiles at
  least 44px with an SVG icon and a line read as the description, not the name: Funding's "Members raising and
  investing"; hovered, a tile's icon well standing apart from the row and its line still reading), its active state,
  sections the institution has switched off, and the guards keeping the open screen when a refetch fails (the
  registration form keeping what's typed, even when the account details fail too); the feed's Explore row, a region
  rather than a nav, offering what's behind More in priority order (Events, Groups, Mentors, Businesses, Funding) as
  44px chips with SVG icons in the brand's ink under a readable heading, holding no text box or post (the feed's first
  stay the composer's and a post's), with no sideways scrolling and Funding's chip opening its page with More current;
  and no Explore row at all on a wide screen or with nothing behind More; the Upcoming events strip, not there (nor its
  placeholder) when nothing is coming up or the events can't be fetched, holding its own height while the events load
  (a placeholder of the same height, both keeping a thin scrollbar's room for a mouse), between the celebrations and
  the composer, then the seeded two soonest first as 44px links with a readable heading, an SVG icon and See all
  opening Events, each date tile's day in Demo University's ink on its wash, the Mumbai meetup answered "You: yes" by
  the RSVP step, and Maybe given on Alumni Day's page (opened from the strip, Back being the feed) showing on its link,
  then taken back; the strip still there with Events on the bar, and gone on a wide screen and with Events switched off;
- direct messages between two seeded members (Meera and Sneha): a request, welcomed first by a note named "Say hello to
  Sneha Kulkarni" (its text and tip, the envelope an SVG in Demo University's badge, its words readable, nothing hinting
  at a decline or a block, and the message box described by it: title, text and tip as sentences of their own, as
  Chromium works the description out over CDP), refused once for going too fast (keeping its words in the box), its
  Request sent panel giving the date to ask again on a line of its own (a clock, thirty days on in a `<time>`, nothing
  hinting at a decline or a block), the thread left open past that date (answered by the script a few seconds on)
  offering the box with its note on the info tone and saying so, accepted live, replies both ways with exactly one
  bubble each, a thread in a background tab not marking anything read, Try again reusing the client key, a refusal for
  sending too fast (a warning on the warning tone), a draft surviving a failed refetch, a report (and a second one), a
  block (the blocked member's messages never arrive, even after the unblock), a lost socket frame recovered by the gap
  fill, and the thread on a phone;
- a current pupil (Naina, Demo School) seeing no Messages, Groups, Mentors or referrals, with all of them switched on,
  the feed's Explore row offering Businesses and Funding, and Upcoming events listing the Singapore dinner and
  Founders' Day assembly with Events on the bar, each day in Demo School's ink on its wash;
- groups: each chosen visibility card in Demo University's wash and ring around an ink ring and dot, with its
  description readable on the wash; an open group found in Discover and joined, live messages both ways, the thread's
  Group details link drawn with an SVG icon rather than a glyph, an invite-only group's invitation (the invite list
  keeping its rows, with no spinner, while a search is on its way; the invitee's box in Demo University's ink with a
  drawn tick, `expectChoiceLook`; its badge arriving live, and at a phone's width on the feed's Explore chip, named
  "Groups, 1 invitation" with its count) accepted from Invitations (with the history before it hidden), leaving,
  archiving and My posts;
- mentorship: offering to mentor (on a 320px screen, the areas as chips sized to their names, every word whole, each
  44px tall and inside the screen; one not chosen with the meta-grey box, a chosen one in Demo University's wash and
  ink box, `expectChoiceLook`; at five, Law disabled, its label readable and described by "Choose up to 5. 5 chosen:
  untick one to choose another."; with the browser's text at twice its size on a 390px screen, every chip still
  inside the form and nothing wider than the screen, though "Entrepreneurship" wraps inside its chip there, as README
  Known gaps says), finding a mentor by name, area and availability, a request reported, a request
  with the longest note accepted into a live chat that opens with the note, ending it read-only (each side told the date
  a new request can be sent from, thirty days on), the bell, and the Mentor badge in the directory and on the new
  mentor's own profile; switched off, Mentors kept as a way out, on the feed's Explore row and as the More sheet's tile
  at a phone's width saying "Your requests and mentorships";
- referrals: a job offered for referral, the Can refer filter, a request reported, one accepted into a live chat that
  opens with the note, closing a job closing a waiting request, and the bell;
- a chat notice in the bell opening its thread; notification settings, through a Settings link named by its word
  alone (its icon is silent); sign out;
- an ADMIN_APPROVAL tenant: Submit for approval, with the note that an admin will review the profile, landing on the
  pending screen; and a forced sign-out leaving nothing cached;
- empty states drawing their icon in the institution's ink on a round wash at 3:1 (`expectEmptyState`): the directory's
  "match" box with Show all members, which empties the search and Open to, and the businesses' with Show all
  businesses, which empties the search, the category and the city, each putting focus back in the search box, the
  empty inbox with Find people (filled, first, to the Directory) and Find a group (to Groups), and with the Directory
  or groups switched off only the other, a new group's empty thread naming it, an empty Requests tab, a mentor search
  with Clear filters inside the box (its title matched exactly, as a live box repeats its words in a hidden status
  line), a job's empty referral
  requests, My posts' own box on each of its tabs but Posts, which Smoke Tester's post fills (Past events with nothing
  to add; Jobs with Post a job, Businesses with Add a business, Groups with Create group and Upcoming events with Plan a
  gathering, each linking to its section's form; Funding with I'm raising and I'm investing, each to the form for its
  kind), and with every section off its "Nothing to show" under the page's header and no wider than the page, at Demo
  University (blue); the pupil's three "aren't available" boxes, each with Go to the app, and her empty Posts tab in My
  posts, with Write a post (no Create group anywhere there) opening the feed with focus in its composer, once (a reload
  keeps the state but doesn't focus it again), at Demo School (amber); and the new post's comments and the events'
  attendee lists, inside their cards (above).

## Web (tenant admin + platform console)

```bash
pnpm e2e:admin
```

Covers:

- the tenant admin dashboard; approving and rejecting members, each toast naming the member (the Pending approval
  badge's ink readable and its edge at 3:1, and the success toast white on the success tone's solid, readable); Approve all asking first
  (opened and cancelled, sending nothing); approving Pooja Bhatt from her new-member notice (answered by the script: its
  Approve and Reject 44px tall beside the link to her page, never inside it; an open Reject closing with a toast that
  says where she stands once the API's live notice of a change refetches the list showing her decided elsewhere, and
  not opening again by itself when she waits again; Approve sending the status the notice showed, and the notice then
  showing Approved); a member's page showing Kiran Joshi's whole profile (headline, skills, past role, studies
  elsewhere, Open to), his initials in the same tone of his own in the list and on his page, and Make admin and Remove admin role each asking first (Cancel sending nothing), each toast
  naming Kiran, and both changes in the recent activity by the admin's name; his answers' Clubs and societies chips
  each 44px tall, the chosen ones on Demo College's wash, in its ink, with a drawn tick, and the others white with none
  (`expectChipLook`), before and after a press; his answers' Cancel putting back the
  saved ones, and the admin's own page, with its answers being edited, linking from its recent activity to Kiran's
  page, held from the visit before, which opens with no editor; approving a pending job after its full preview (the
  Robotics Intern's stipend, with its title an h2 and its parts h3s under the page's h1, and its skills compared with
  nothing of the admin's), and a pending business listing whose contact details show only once opened; a group waiting
  (answered by the script), its byline giving the owner's years ("by Rohan Gupta (2012–2016)"), approved in two
  presses, the first opening its name and description beside what members see until then and sending nothing, the
  second sending what was shown, refused as changed meanwhile and fetched again, then, with the preview showing the
  owner's new name, a press sending nothing and asking to check it again, and the next sending the new name; resolving
  the spam report by removing content;
- settings, saving only the switches that changed: every checkbox row 44px tall, a ticked switch's box in Demo
  College's ink with a drawn tick and a cleared one's grey edge at 3:1 (`expectChoiceLook`), Chat attachments on with
  its line under the switches, and unchecking Messaging
  unchecking Mentorship and holding it (its label in the meta grey, unfaded), both coming back on;
  Branding with the welcome message's hint saying new members see it too, Demo College's green chosen among the
  suggested colours (a drawn tick) and the preview's initials in its ink on its tint, a near-white colour typed showing
  the contrast warning with Save branding still enabled and the initials following it, readable, and Save held, saying
  why, while the script holds a large logo's preparation, then free once the logo is in, with nothing saved;
- the Profile fields page saying degree and field of study are built in, and adding a profile question (Add field and
  the move arrows drawn as icons, the directory filter box disabled for short text and saying why), moving it up (in its
  new place while the script holds the move, with the arrows waiting until it's saved), and archiving it after the
  confirm dialog (Cancel first); importing an invitation CSV (once the profile questions are in) whose "Year Joined" and
  "Batch" columns are read as the start and end years ("Using phone, name, start year, end year.", 2011–2015 in the
  preview's Years and on the row once imported), and joining through its link in a second browser at a phone's width,
  the invitation page's logo initials in Demo College's ink on its tint though no theme colours the page, with the
  name and both years filled in and the three steps, then the walk-through ("Welcome, Kavita") with no sideways
  scrolling, its Add a profile photo link ending it (the POST answered) on My profile's Basics, and the front door
  then opening the feed; another invitation revoked through its confirm dialog (Cancel first sends
  nothing); an announcement that also goes by email, asked first in the app's dialog with the email box's count and
  the billing line, Cancel posting nothing, then Post and send; Demo University's Send pending asking first in a dialog
  that says it's billed (Cancel sends nothing), a refusal (answered by the script, as for a plan that stopped sending)
  closing the dialog and saying why, then a send (answered by the script, so nothing is billed);
- the reported business listing in Demo University's reports;
- chat reports: the dashboard tile and nav entry, the queue showing no message until an admin chooses to view it, the
  Open tab counting the open report (1, then 0 once it's resolved), a note typed and cancelled gone from the next
  view's dialog after Hide, the audit row the view writes, the audit log's Chat reports chip showing only that family
  and the console's Audit log link then showing the whole log again, with no filter written back, the messages
  discarded on leaving the page, a report another admin just handled, removing the reported message, and the page on a
  phone;
- analytics: the headline figures' changes (the period before scripted, so each direction shows) in words beside SVG
  arrows, never text arrows; the New members chart's weeks day first ("2 Nov") in an en-US browser; its Table switch
  keeping its name, pressed, with a row a week in place of the chart; Members by batch's table, its columns Batch and
  Members, with 2012 among its rows; "Updating…" with the 12 weeks' charts still up while the script holds the 26
  weeks' answer; and the members CSV, starting Name, Phone, Email, Start year, End year, Status, with Rahul's 2008 and
  2012, and with the profile's own columns after "Last active" and Rahul's seeded headline and skills in them;
- at a phone's width: the app header's Admin link (its icon alone, a 44px target, named with the work waiting as the
  console's dashboard counts it, the count in amber, the feed's Explore row offering no Admin console chip, the More
  sheet's tile under You named the same, with its line and its count in amber, and the sidebar's row named the same on
  a wider screen), and
  every admin page with no sideways scrolling: each section in the console's nav, the Members, Moderation and Reports
  status tabs, a member's page and the Branding tab;
- Appearance on My profile, as the Demo University admin: Plain chosen and no Cover tile without a cover; Institution
  colour saved and tinting the page (Demo University's tint) with its grey text a shade darker (the meta grey, then the
  secondary one, readable on each), on the feed after a reload too, with post cards painting their own white (the first
  the pinned strip's, its frame in the brand's edge still 3:1 against its white card on the tint); the console's
  dashboard and Branding tab staying on the plain page; and Plain putting the page and its grey text back;
- the platform console: login, the Institutions list drawing each institution's initials in its own colour (Demo
  University's blue, Demo College's green), onboarding an institution (the welcome message's hint saying new members
  see it too) with its first admin, whose years are asked under a college's labels, an end before the start refused on
  its box with nothing created, and the admin then listed with 2010–2014 on the Admins tab; a billing plan and usage,
  stats and user search, the institution comparison and its CSV,
  the chat reports list showing only escalated reports (and rows on a phone: the nav item's open count, why each is
  staff's, "About an admin" or "No other admin", and reports another member of staff must handle, or that no member of
  staff may take yet, or that are closed, each with its note and no link), opening an institution's admin console
  without being a member, a school's settings starting with Messaging, Groups and Mentorship off and saying why (and
  Chat attachments on, waiting for nothing), and
  the admin console stacking on a phone;
- empty states drawing their icon in the institution's ink on a round wash at 3:1 (`expectEmptyState`): Demo College's
  empty reports (green), Demo University's empty chat reports (blue), and the platform console's empty escalated
  reports in the default blue.

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

- tenant picker → landing (the brand cover's short name and tagline) → login → OTP → registration in three steps →
  the walk-through → feed, as on the web: each step's button on the
  screen once, Back included; "Signed in as" with the number on Basics, and Back there (untouched, so nothing holds
  the page) leaving for the landing screen, which offers Join DemoU instead of sending them back into the form; with a
  name typed, the page held, Use a different number asking first and Cancel staying signed in, and Back asking "Leave
  registration?", Cancel staying with the name and Leave going to the landing screen; the years filled by their labels
  ("Year you joined *", "Year you left (or will leave) *"), never by position, so a past role's Start year can't be
  taken for them, and Continue with no start year staying on Basics with "Enter the year you joined"; the step bar going
  back with Work kept, Skip for now putting Work back as it was last accepted, Open to's chips on About you as on the
  web (44 points tall, Hiring chosen and cleared, `expectChipLook`), Back from About you and from Work, a
  server error sending the member back to Work with the page still held, and Join the network leaving the screen (it
  isn't held) for the walk-through, with nothing holding it;
- the first-entry walk-through, above the tabs with no tab bar showing: "Welcome, Mobile" focused and described by "1
  of 3", the cover's short name, Demo University's welcome message, one Skip and no Back, with SVG icons and no emoji;
  "Make your profile stand out" scoring 0, "A photo and a headline help…", and Add a profile photo and Write a
  headline, described by "Each opens My profile and ends this welcome."; Back focusing the first heading again; "Find
  your people" with Directory, Mentors, Groups, Messages, Events, Jobs, Businesses and Funding named by the section
  alone, each at least 44 tall, Funding's described "Members raising and investing"; Get started sending `POST
  …/memberships/me/welcome/done` and opening the feed with one tab bar; and its own address, opened cold once it's
  ended, going to the feed;
- the "Complete your profile" card: 0 for a name and years, its three heaviest missing items, Write a headline
  opening Edit profile at Work with Back going to My profile and then the feed, and Not now leaving focus on its note
  and the card gone after a reload;
- a post with a photo (the member's form offering no Announce), editing it, a Like on it (the chosen chip Demo
  University's wash, apart from its tray and from white, with a filled icon in their ink at 3:1 or more on it) and
  taking it back, the author's initials on the post in the member's own tone, not the institution's colours, the same as
  on the app bar's My profile, beside the app bar's Demo University initials in its ink on its tint, the post's page
  saying "No comments yet" under a level-2 Comments heading, in its own box (the icon in the institution's ink on a round wash) with "Be the first to
  reply.", as on the web, the celebrations
  card (a birthday row and an anniversary row with years) and a poll vote, marked with a drawn check rather than a ✓,
  with "your vote" in the row's hidden text; a poll with several choices, its drawn boxes saying which are chosen
  (`aria-checked`) before the vote;
- Edit profile: Cancel upload pressed while a photo is still being prepared freeing the picker at once and sending
  nothing, then a photo through the round picker, saved as a 512-pixel square JPEG; a headline, three skills and a past
  role in their sections, Done refusing an end year before the start, a server error on `experiences.0.endYear` in its
  row with "Check the details marked in Work." by the button, then all of it on My profile, the meter at 50 with what's
  still to add, skills no longer among it, and `?section=about` scrolling About you into view; Delete my account's
  confirm sheet, saying a suspension or blocks come back with the number, cancelled with the account still there;
- the feed's Explore row offering what's behind More in priority order (Events, Groups, Mentors, Businesses,
  Funding), as chips at least 44 tall with SVG icons under a readable heading and no text box, Funding's chip opening
  its screen with More selected, and the Feed tab going back;
- the feed's Upcoming events strip: not there (nor its placeholder) when nothing is coming up or the events can't be
  fetched; a placeholder of its own height while the events load; under Explore and the celebrations and over the
  posts; then the seeded two soonest first as links at least 44 tall under a readable heading with an SVG icon, each
  date tile's day in Demo University's ink on its wash; the Mumbai meetup opening on Events' stack, so Back is the
  Events list with More selected, and See all opening Events;
- every section opening its own screen, with Events, Groups, Mentors and Funding behind More; the More hub grouped
  under Connect, Community and You headings, its rows at least 44 tall, each with a line exposed as its description
  (Funding's "Members raising and investing", My posts' "Everything you've shared"), and on a 320×568 screen sitting
  in an area that scrolls, which the mouse wheel scrolls to an uncovered Sign out; My posts from the More hub, its tabs
  scrolling rather than truncating, "Past events" and "Upcoming events" whole at 320px;
- jobs: seeded cards with place, pay, experience and "+1 more" skills, and Zylo Labs's and Deloitte's initials in a
  tone from each company's name, two tones apart and not the institution's; the Work mode and experience filters behind
  Filters, and Clear filters; the Backend Engineer page, its title the only heading holding it, with its facts, section
  headings, About the company, a How to apply link opening in a new tab with noopener, and Apply;
- matching skills: before the member has any, the Backend Engineer card marking none and its page offering "Add your
  skills to see which you match" in place of a count, the link bringing back the Edit profile left open and unsaved on
  the Profile tab, at Work with its draft, rather than stacking a second editor; once "typescript, aws" are saved,
  TypeScript and AWS first on that card, each with a check, then Node.js and "+1 more" on one line, with "(you have
  this)" after each in the card's name; its page keeping the job's order, the same two checked, and "You have 2 of 4
  skills"; and "You have 0 of 4 skills" with no marks on Associate Product Manager;
- an RSVP, with the description's bullets, link and mail link as on the web, and the chosen answer as on the web (its
  tone's fill, ink and edge, a drawn check and no ✓) in a "Your RSVP" group of three 44px buttons, then "You: yes" on
  the feed's strip; Who's coming with the web's Going and Maybe tabs, 44px tall, and the same empty lists as on the
  web: the meetup's answered empty (scripted) inviting the member to be first and saying who Maybe would list, and
  London pub night's, which is over, saying only that nobody has;
- the directory: a search by a seeded skill finding Sneha, her Open to badge short on the card and in full in its
  name, the Investing filter leaving Priya out, Were there in chosen from a list behind Filters and counted with them
  (2013 leaving Priya out, 2012 finding her, Any year taking it off), and Priya's full profile with her years and place
  ("2008–2012 · London, United Kingdom"), "Registered", her roles in order and a LinkedIn link with the right target
  and rel;
- businesses behind More: search, filters and contact details only on a listing's own page; the description's bullets
  as one list with the bullet marks hidden from screen readers, its numbered steps read out from 1 with the numbers on
  the left, and its link; add (its logo changed to a 4000 × 3000 photo of over 5 MB, made smaller before it goes up),
  edit, My posts and delete through the confirm sheet;
- notification settings persisting, opened from a Settings button named by its word alone; nested screens opened cold,
  and a notification tap landing on its target;
- direct messages between two seeded members (Arjun and Vikram), as on the web, including the note welcoming the first
  message ("Say hello to Vikram Desai", its text and tip, its envelope in Demo University's badge, its words readable,
  nothing hinting at a decline), the request refused once for going too fast (on the warning tone), the date to ask
  again on a line of its own, the thread left open past it offering the box with its note on the info tone, a report
  from tapping a message, a block, a cold start on a thread, and a lost socket frame recovered by the gap fill;
- groups, mentorship and referrals, as on the web, between two generated members and a member the run registers
  (the invitee chosen while the search for their name is on its way keeping that same row once it answers; the
  mentor areas checked on a 320-point screen as on the web, with nothing wider than the screen; the invitation's
  badge arriving live on More and on the feed's Explore chip, named "Groups, 1 invitation"; Mentors,
  kept as a way out, on the feed's Explore row and as More's row saying "Your requests and mentorships");
- the job form along the way: work mode, the last Seniority chip (Executive), skills (two too long for one line of a
  card), experience, pay previewed as it will show, a pay note, Responsibilities, a website, an industry chosen from a
  list and a contact email; the job's facts after posting and after an edit of the title alone; after posting, its facts
  two across with every word whole, whole again on a 320-point screen with nothing wider than the screen, and one to a
  row with every word whole beside a place too long for half the box ("Thiruvananthapuram", scripted with `scriptJob`);
  its page comparing nothing with its poster's skills; the edit form opening with Executive, last in its row, drawn on
  the screen; the
  poster's own card on Jobs unmarked though they have TypeScript, its long skills cut short with an ellipsis to stay on
  one line; a second job at the same company filling the website and industry from Use details from your last job at
  Smoke Labs; and "Applications closed", with the email gone, once the job is closed;
- a current pupil seeing none of them, Explore offering Businesses and Funding and Upcoming events Demo School's two;
  sections switched off, with no Explore row once nothing is behind More (Upcoming events staying, with Events on the
  bar) and no Upcoming events once Events is off; the guards (the registration form keeping what's typed,
  even when the account details fail too); re-applying after a rejection (answered by the script) prefilling every step
  with the reason on each; joining Demo College from its landing screen's Join DCE (it doesn't send a signed-in
  non-member into the form, and forgets Demo College as the institution to start at, so Choose a different institution
  opens the list), with Use details from Demo University and Undo keeping a headline changed after it, then Submit for
  approval with its note, landing on the pending screen; switching institution and signing out from the More hub; a
  second new member's walk-through, waiting while a link to the directory opens the directory with the tab bar and
  opening again at the front door, then its Write a headline link ending it (the POST answered) and opening Edit
  profile at Work, with Back going to My profile and then the feed with one tab bar, and the front door then opening
  the feed (Skip and the section rows aren't pressed here: they leave through the same `leave()` as Get started and
  the links, and the web journey presses its own); a forced sign-out leaving nothing cached;
- the admin console, as the Samaj admin: More's row named "Admin console, 2 waiting", described "Members, moderation and
  settings", and My profile's link; the
  console's home with no tab bar and no sideways scrolling, its "Pending members, 2" tile in amber and "Content to
  review, 0" not, no report tiles with none open, the four figures at a glance, the Growth and activity charts link,
  the approval sentence, and a row for every section, Analytics first, with nothing left for the web console; Back to
  More and to My profile; a chat report's notice tapped in Notifications opening the
  open chat reports (saying the report isn't there, as Samaj has none), with Back returning to the list;
  Appearance from My profile (a 44px link with an SVG icon; Plain chosen, no Cover
  tile, each tile 44px), Institution colour saved and tinting the screen (the Samaj's tint) with `Muted` text a shade
  darker (the meta grey, then the secondary one; Notification settings' first line, written on the page itself rather
  than in a card, readable on the plain page and on the tint), and the feed after a reload with its post cards painting
  their own white, the console's home staying on the plain page, and Plain putting the page and its grey text back; the
  console's Settings, reached from the approval
  sentence's 44px Settings link (and later from the section's row), saying the plan has no messaging, Chat attachments
  on, the Funding switch and the chosen approval mode drawn in the Samaj's ink on its wash (a drawn tick, a ring), and
  an approval mode not chosen with a grey edge at 3:1 (`expectChoiceLook`), a blank batch year
  refused under its box with nothing sent, a save refused while another admin's change comes back (both answered by the
  script) starting the form again from the stored settings and still saying "Couldn't save: …", Messaging off clearing
  Mentorship and holding it with "Needs Messaging" (its label in the meta grey), and Funding saved off (sending only
  that switch) with More and the feed's Explore row dropping it at once, then back on, with Explore offering it again;
  Branding, from Settings' 44px row: the welcome message's hint saying new members see it too, the Samaj's orange
  chosen among the suggested colours, the tagline saved with the preview following it and its initials in the orange's
  ink on its tint, Save held (saying why) while the script holds a large logo's preparation and free again once it's
  cancelled, with nothing uploaded, a near-white colour showing the contrast warning without holding Save and the
  preview's initials following it, readable, "#12" refused under its box (and by Save) with nothing sent, Teal (a 44px
  radio) chosen and saved, the screen's and Settings' buttons taking it at once, and the Samaj's colour and tagline put
  back;
  Profile fields, adding "Seva team …" in the modal editor (the key following the question,
  options added by Return and by Add, the directory filter box disabled for short text and for admin-only answers),
  moving it up (in its new place, said, with the arrows waiting, while the script holds the move) and down, a move the
  script refuses put back with "Couldn't move it" while the list's refetch is held, archiving it after the confirm sheet
  (Cancel first), and Show archived listing it to restore, after a reload too; and, with the role taken away (answered
  by the script), the console leaving for the feed with one set of tabs, More dropping its row, and the console opened
  cold doing the same;
- the console's members list, as the Samaj admin: the Pending tile opening Pending with its count, Parth Joshi's
  details line led by his years, as a member who still belongs ("2018–present · +91 91000 00037 · Infosys, Pune ·
  requested …"), his Pending approval badge's ink readable and its edge at 3:1, 44px actions named for Parth and Diya
  Raval, no sideways scrolling, and Approve all asking first
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
- a member's page and the audit log, as the Samaj admin: Nisha Modi opened from her row in the members list (its name
  starting "Nisha Modi, Approved, 2010–present"), with her facts (her phone as the console writes it, her place by name,
  what she does; two across with every word whole, and whole again on a 320-point screen), her mentor profile listed
  in Mentors with its areas and availability, no sideways scrolling, and
  Remove as mentor asking first (Cancel sends nothing); her answers edited, Chapter saved as Diaspora ("Answers saved"),
  then Surat chosen and cancelled, the saved answer standing and the next edit starting from it (on the way, the
  Community interests chips each 44 points tall with every word whole, on a 320-point screen too and inside it, the
  chosen ones on the Samaj's wash, in its ink, with a drawn tick, and one pressed, then dropped by Cancel, the next
  edit starting without it); View profile in the app leaving the console for her profile, back on the tabs; an
  admin-managed question (added by the script) given to the admin as a text box, saying only admins see the answer, and
  sent by Save, and an interest (added by the script) wider than a whole 320-point row wrapping inside its chip, at its
  spaces, inside the row and the screen; Parth Joshi made an admin and the role taken
  away again, each through its confirmation (Cancel first sends nothing), the Admin badge following, and his recent
  activity naming Jignesh Patel with the changes made; the audit log from the console's home, opening on All, its
  Members chip showing Diya's rejection with its reason, a prefix typed by hand that is no chip's ("membership.app")
  leaving none chosen, and one that is ("chat_report.") choosing that chip and finding nothing, Clear choosing All
  again, a membership row opening Diya's page with Back keeping the filter, and a row carrying a phone hash (answered by
  the script) showing its other details and never the hash;
- the console's moderation and reports queues, as the Samaj admin: Moderation from the console's sections, opening on
  Awaiting approval with its count, All types chosen, "Nothing is waiting for review." and no sideways scrolling; a
  group waiting (answered by the script), "by Hetal Shah (2005–present)", approved in two presses, the first opening it
  (Hide says it's expanded) with what members see until then and the note that chat messages are never shown, sending
  nothing, the second sending the name and description shown, refused in its row as changed meanwhile, and the group
  fetched again, then, with the preview showing the owner's new name, a press sending nothing and asking in the row to
  check it again, and the next sending the new name; Hetal's job under Published and Job, its preview with the title an
  h2 and "About the role" an h3, the apply link as text, no link but the row's Open in app, no Apply and no skills
  compared, and Kiran's closed job showing its closed line and "No apply link, email or phone."; Nisha's post removed
  through the reason sheet, Cancel keeping the note for next time, then restored from Removed; Hetal's post pinned and
  unpinned, the button's SVG icon and its label following; a link with `item=` opening that post's preview, and a
  content notice (answered by the script) opening Awaiting approval with Post chosen, saying the item isn't waiting any
  more, Back returning to Notifications, and the notice tapped again once the script lists the post as waiting, the
  queue cached by the first visit fetched again rather than taken for the answer, so the post opens with no "isn't
  waiting" line; Open in app leaving the console for the post's own page with one tab bar; Hetal's post reported from
  the feed (the reasons 44 points tall, Spam chosen on the Samaj's wash, in its ink, with a drawn tick,
  `expectChipLook`), then the console's "Open reports, 1" tile opening Reports on Open with its count, the row
  labelled Spam, Post and Published (never the raw status), with the reporter, the details and the post's words;
  Dismiss refused (answered by the script) as already handled, closing the sheet, saying so and refetching the list;
  Resolve, keep content with a note, then "No open reports" and the note under Resolved; and a report notice (answered
  by the script) for it saying it has already been handled, then, tapped again once the script lists it as open, the
  Open list fetched again and the report shown with no "already handled" line;
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
  welcome, with its Announcement badge drawn with an SVG icon; both in the pinned strip (a region named "Pinned posts",
  as on the web), each a white card saying Pinned once (an SVG pin, in the Samaj's ink) above its author and framed 1px
  in the Samaj's edge (3:1 on white), the announcement's left edge 4px of the ink, the welcome's the frame's and no
  badge, then a readable "Latest posts" heading below the strip; on a plan with WhatsApp and email (the audience
  and the post answered by the script, so nothing is billed or stored), both boxes with their counts and the line saying
  each member still gets one message, email alone asking first in a sheet with its count and "Messages are billed to
  your institution.", Cancel sending nothing and keeping the text, then both asking "by WhatsApp or email?" with one
  message each to every member, by email only when WhatsApp can't be sent, and Post and send sending it pinned with both
  channels and going back to the feed; then the console's queue listing the real one with both badges, and Unpin there
  leaving it an announcement on the feed, no longer pinned: no Pinned line, out of the pinned strip, back in the grey
  border with its left edge still in the ink;
- the console's invitations, as the Samaj admin: none yet, Can send today read as none and no Send pending on a plan
  that sends nothing, no sideways scrolling; the import modal's hint saying a community's end year may be blank, and its
  Template downloading invitations-template.csv with its byte order mark, `start_year` and `end_year`, the questions'
  keys as columns, the example phone unguarded and the example's end year blank; a two-row CSV with "Member Since" and
  "Until" columns picked through the file chooser (the document picker's web input), previewed with the columns used
  ("phone, name, start year, end year, Chapter") and ignored and each row's years ("From 2015", "2009–2016"), Send now
  disabled, imported ("2 new, 0 updated, 0 skipped.") after the script has held the request long enough to see
  "Importing 0 of 2…" and "Keep this screen open…" and the bar's Back leave the screen where it is, and Done saying "2
  invited, 0 updated" on the list, each row with its years; Copy link read back from the clipboard; WhatsApp opening a
  new tab at wa.me with the number and the Samaj's message (answered by the script); a search kept in the address;
  Revoke through its sheet (Cancel first), the row then Revoked, listed under the Revoked tab, which a reload keeps;
  and, with the plan said to send by WhatsApp (answered by the script, so nothing is billed), Send 1 pending asking
  first and saying it's billed (Cancel sends nothing), a refusal (as for a plan that stopped sending) closing the sheet
  and saying why on the list, then "Sending 1 invitation", and a row's Send saying "Invitation sent";
- the console's analytics, as the Samaj admin: opened from the console's Analytics row on the last 12 weeks, the
  compared headline tiles (the period before scripted, so each direction shows) named with their change ("New members,
  12. +20% vs the previous 12 weeks (10)") and drawing it as an SVG arrow beside the words, never a text arrow; the New
  members chart a slider named by its summary whose value is the latest week's readout ("Week of …, N approved"), the
  left arrow key stepping it a week back; "Last 6 months" putting `weeks=26` in the address and asking the API for 26
  weeks, the 12 weeks' charts staying up with "Updating…" while the script holds the answer, and the headline figures
  then compared with "the previous 6 months"; the New members card's Table switch keeping its name, pressed, and listing
  27 rows (its header and 26 weeks) in place of the chart; the invitations funnel's table saying Imported 2; Activity's
  table with its five headers whole on one line and every row's figures right under them; Members by year joined, a
  slider whose value reads "Joined in …, N members", its table's columns Year joined and Members, with 1996 among its
  rows; no sideways scrolling; the members CSV saying "Preparing…" while the script holds
  it, with Activity CSV disabled until it's saved (one export at a time), then downloaded as
  shri-gujarati-samaj-members-<date>.csv with one byte order mark, Start year and End year after Email (Hetal Shah's
  2005 and a blank end) and the Samaj's Chapter among its columns; and a reload keeping 6 months;
- empty states drawing their icon in the institution's ink on a round wash at 3:1 (`expectEmptyState`), with the
  buttons that used to sit beside them inside the box: the empty inbox with Find people (filled, first, opening the
  Directory's tab) and Find a group, and with the Directory or groups switched off (the inbox answered empty) only
  the other, a new group's empty thread naming it, its icon above its title in the upside-down list, Received
  referrals with Post a job, Sent referrals with Find jobs that can refer, a mentor search with Clear filters, the
  directory's "match" box with Show all members, the businesses' with Show all businesses (which empties the search,
  the category and the
  city and puts focus back in the search box), an empty Requests tab, My posts' own box on each of its tabs but Posts,
  which the member's post fills (Past events with nothing to add, Upcoming events with Plan a gathering, Jobs with Post
  a job, Businesses with Add a business, Groups with Create group, Funding with I'm raising and I'm investing), I'm
  investing opening the investing form and Plan a gathering the event form, each with Back on its section's list, and
  with every section off its "Nothing to show", at Demo University (blue); the pupil's "aren't available" screens at
  Demo School (amber), each with its way out, and her empty Posts tab in My posts, with Write a post (no Create group on
  the screen) opening the new-post screen; the new post's comments and the events' attendee lists (above); and the
  console's empty chat reports, Pending tab and invitations at the Samaj (orange).

Note: on the web export, screens underneath stay mounted (React Navigation keeps inactive tab stacks and stacked
screens), so the script picks the last visible match and dispatches clicks directly in a few places. On iOS and
Android the native navigation doesn't have this quirk.

Not covered by any script: reporting a declined, withdrawn or closed mentorship or referral request's note, and the
admin's view of a note report from the API (**View request** in Chat reports; the phone journey's is answered by the
script). The API tests cover them. Nor is the last registration
step's **Join the network** for an invitation at an institution that approves members automatically but has invitation
auto-approve off, as no seeded institution is set up that way. Nor are registering at a community with Until left
blank, or a member changing their own years on My profile: the API tests cover the rules (`membership.test.ts`), and
the checks on a real phone below cover the forms. Nor does a script check that the Samaj's Analytics has no Members by
batch card beside Members by year joined: the unit tests do (`unit/analytics.test.ts`).

## Checks that need a real phone

Everything below has only run on the web export or in unit tests, so nobody has seen it on a device yet. It is one
pass, in order: work through it on one Android phone and one iPhone, and do each check on both unless it says otherwise.
Where a check uses something up (sends a request, accepts an invitation, rejects a member), the first phone does all of
it but that last step, and the second phone the whole check, unless the check gives each phone its own. Record each run
under "Runs" at the end.

### Getting set up

**Expo Go, then a development build.** Expo Go on one iPhone and one Android phone covers almost all of this pass: it
already has every native module the app uses, including the five added for photo preparation and the admin console's
files (`expo-image-manipulator`, `expo-file-system`, `expo-document-picker`, `expo-sharing` and `expo-clipboard`). Only
part 20, pushes and `illuminize://` links, needs a development build, as Expo Go can't receive the app's pushes or open
its links; a development build made before those five modules were added lacks them and must be rebuilt (part 20 says
how). After installing (`pnpm install`, or a rebuild), restart Metro (`pnpm mobile`): a server started before the
install can't find the new modules.

1. With the phones on the same Wi-Fi as this computer, run `node scripts/setup-local.mjs --lan` so they reach the API
   here, then `pnpm db:reset` and `pnpm demo`. `pnpm demo` starts the API and the web app, not the phone app's Expo
   server: start that with `pnpm mobile` in a second terminal.
2. Install Expo Go from the App Store or Google Play (or update it, so it runs SDK 58), and scan the QR code that
   `pnpm mobile` shows: with the camera on the iPhone, or from inside Expo Go on Android.
3. From part 3 on, each phone is signed in to Demo University as Rahul (`+91 91000 00001`) unless a part says
   otherwise. On a computer, open the web app as Priya (`+91 91000 00002`) to send messages to the phones, and in a
   private window as the Demo University admin (`+91 90000 00001`) for the admin steps.
4. Parts 1 and 2 sign each phone in with a number that isn't in the demo data, such as `+91 98765 43210` on the iPhone
   and `+91 98765 43211` on Android. Part 18 deletes those two accounts, and part 19 uses them once they've joined
   again; never confirm Delete account as Rahul.
5. Turn on TalkBack (Android) or VoiceOver (iPhone) only for the checks that ask for it.
6. Sign-in codes are limited, and the pass is laid out to stay inside the limits in a day: each number may ask for 5
   codes an hour and 10 a day (the day counted from its first code), a minute apart, and each phone, or this computer
   for all its browser windows, 20 an hour. Rahul, the number used most, asks for 7 in parts 1 to 19. Signing the
   second phone in as the same person straight after the first, the code screen says "Resend code in …s": wait for
   it, then choose Resend code. Past a limit, sign-in says "Too many codes requested for this number. Please try again
   later." (for a phone or the computer, "Too many codes requested. Please try again later."): wait an hour, or until
   the next day, or carry on as another demo member. `pnpm db:reset` clears the counters too, but it also puts the
   demo data back as it started, losing the accounts from parts 1 and 2 and what later parts build on, so after a
   reset start again from part 1. Part 20 is the exception: it works after a reset, on another day.

### 1. Sign-in and phone entry

On each phone, open Demo University (signing out first under More → Sign out, if someone is signed in) and choose "Sign
in / Join with mobile number": India (+91) is chosen. Write `+91 98765 43210` in Notes first, to copy it from there:
the paste checks use it on both phones and send nothing. Only the fourth check sends a code, each phone for its own
new number.

- [ ] Paste "+91 98765 43210" into Mobile number: the box shows 98765 43210, with no 91 in front, India stays chosen,
      and Send code is enabled. Clear it and paste "+919876543210", then "919876543210": each time the box holds the ten
      digits once. Five digits leave Send code dimmed; the sixth enables it.
- [ ] Autofill. iPhone, with the phone's own number on its contact card (Contacts → My Card): tap the box, and the bar
      above the keyboard offers the number; choose it. Android: choose the number if the keyboard or Google's autofill
      offers it. Either way the box gets it once, with India chosen, and nothing is sent until Send code.
- [ ] Paste a UK number, "+44 7700 900123": the country changes to United Kingdom +44 and the box holds 7700 900123.
      With TalkBack or VoiceOver on, "Country code set to United Kingdom +44" is read out while focus stays in the box.
      Choose India again and clear the box, sending nothing.
- [ ] Type the phone's own new number with a 0 in front ("09876543210" on the iPhone, "09876543211" on Android): the 0
      stays in the box and Send code is enabled. Send it: the next screen says "Enter the code sent to" and that number
      without the 0 (+91 98765 43210 on the iPhone, +91 98765 43211 on Android). Sign in with `123456`: registration
      opens on "Step 1 of 3 · Basics" (part 2 carries on from there).
- [ ] The web app in iPhone Safari and Android Chrome, on Demo University's sign-in page: the browser's AutoFill of the
      phone's number, and a pasted "+91 98765 43210", each put the number in the box once, with India chosen. Don't
      send it.

### 2. Registration: Back, swipe and Android back

Still the new number, joining Demo University. Leave Work empty with Skip for now when you finish, for the last checks.

- [ ] TalkBack or VoiceOver, on Basics: Back is read as a button on every step, and "Signed in as" and the number,
      written once (+91 98765 43210 on the iPhone), are read before "Use a different number", a button. With a name
      typed, Use a different number opens the sheet, read as an alert named "Use a different number?", and Cancel (or
      Android's back button) closes it, still signed in.
- [ ] On Basics, choose Add photo: the first time, the phone asks for access to your photos. Allow it and pick a photo:
      the system editor crops it square, and the round preview shows it once it's uploaded. On the other phone, deny
      access (or turn it off in Settings first): "Allow photo access to choose an image." shows under the buttons.
      Turn access back on in Settings afterwards, for part 4.
- [ ] On Basics, tap "Year you joined *", then "Year you left (or will leave) *": each brings up the number pad with
      the box still in view above it, takes only digits, four at most, and says under it which years it takes. Type
      2014 and 2012 and choose Continue: Basics stays, with "Can't be before the year you joined" under the second box,
      which TalkBack or VoiceOver reads there. Make the second 2018 and carry on.
- [ ] Android's back button and the iPhone's swipe from the left edge: on Work and About you they go to the step before,
      keeping what was typed (on the iPhone the screen springs back into place, with no flicker of the screen under
      it). On an untouched Basics they leave for the institution's landing screen, which shows Join and "Use a different
      number", not a fresh form. On Basics with a name typed, "Leave registration?" asks first: Cancel (and Android's
      back button on the sheet) stays with the name kept, and Leave goes to the landing screen. While Join the network
      is spinning (turn on airplane mode first, so it fails), they do nothing; the failure leaves them on About you with
      everything kept, and back works again. When the profile is sent, Join the network goes straight to the
      walk-through (the next check), then the feed.
- [ ] The walk-through, which opens once Join the network has sent the profile. Before choosing it, set the largest
      text size in the phone's settings, and put it back after this check. The status bar's clock and icons are white
      over the brand cover. TalkBack or VoiceOver reads "Welcome" and the first name, then "1 of 3", as it opens, and
      each screen's title and count on Next and Back. At the largest text size the cover leaves room for the card,
      which scrolls, and Skip, Back and Next stay in reach above the bottom edge (the home indicator on the iPhone),
      nothing cut off. A quick double tap on Next moves one screen. On the iPhone, the swipe from the left edge does
      nothing on any screen, though the landing screen is under it here (Sign in / Join opened the sign-in screen over
      it): finish with Get started, which opens the feed. On Android, the back button on the second screen goes to the
      first, and on the first it ends the walk-through as Skip does, opening the feed. Either way it doesn't come back:
      force-quit the app and open it again, and the feed opens.
- [ ] Signed in at an institution they aren't a member of, whose landing screen is the one the app opened (as after
      being removed): Choose a different institution opens the list of institutions, not the same landing screen again.
- [ ] With the profile sent (Work skipped, so it lists no skills): on My profile choose Edit profile and type a headline
      without saving, then open Jobs → "Backend Engineer (Node.js)" and choose Add your skills to see which you match.
      The Profile tab comes back with that same editor, scrolled to Work and the headline still typed, and Back (and, on
      the iPhone, the swipe back) goes to My profile, never to a second editor.
- [ ] TalkBack or VoiceOver, on the waiting screen: under More → Switch institution, join Demo College and submit for
      approval. The screen reads "Awaiting approval" and its text, with nothing read for the icon above them. Sign
      Rahul back in afterwards; the new number stays a member of Demo University, waiting at Demo College, for part 18.

### 3. Profiles

As Rahul. For the copy banner and the Samaj's years, Rahul opens Demo College and Shri Gujarati Samaj under More →
Switch institution: leave each without sending, or he'll be waiting for approval there, and switch back to Demo
University after.

- [ ] TalkBack or VoiceOver, in Edit profile: Remove on a past role says "Removed" and its name, and focus moves to
      Add a past role; Done folds a row and moves focus to its Edit button; Done on a row whose end year is before its
      start says the problem and moves focus to that year.
- [ ] TalkBack or VoiceOver, on Rahul's registration at Demo College: Use details from Demo University reads out what
      it filled in and moves focus to Undo. Type both years, Continue, change the headline on Work, go back to Basics
      and choose Undo: it reads out what it kept, and focus goes back to Use details from Demo University.
- [ ] Rahul joining Shri Gujarati Samaj, a community: Basics asks "Member since *" and "Until (leave blank if you still
      are)", with no asterisk on Until. Give a year in Member since and leave Until blank: Continue goes on to Work.
      Back on Basics, type next year in Until and Continue: "Leave this blank if you still are" shows under it. Leave
      without sending (Back on Basics, then Leave).
- [ ] My profile → Edit profile, Basics: "Year you joined *" holds 2008 and "Year you left (or will leave) *" 2012, and
      each brings up the number pad with the box in view above it. Clear the first and choose Save profile: "Enter the
      year you joined" shows under it, and nothing is saved. Type 2008 again and save, or leave with Back.
- [ ] The years in grey with names. On the feed, the line under each post's author and each comment's author starts
      with their years (Priya Nair's "2008–2012"); on Directory each card's grey line does ("2008–2012 · London, United
      Kingdom"), and so does the line under the name on Priya's profile, which says "Registered" and a date lower down.
      On the narrowest phone you have, with the largest text size, nothing overlaps and the years stay whole. TalkBack
      or VoiceOver reads the years with the name, as two years, not as a sum ("2008 minus 2012").
- [ ] Directory → Filters → Were there in: the list opens over the screen, headed "Were there in" with Close, newest
      first, from the last year anyone was there (2024 in the demo data, not this year) back to the 1990s, and scrolls
      smoothly. Choose 2010: the list closes, the box says 2010, the toggle says
      "Hide filters (1)", and the results are the members who were there in 2010, Rahul and Priya among them. Open it
      again: 2010 is marked, and Any year at the top takes the filter off. TalkBack or VoiceOver reads the box as "Were
      there in, Any year" (then "Were there in, 2010") and the chosen year in the list as selected. Android's back
      button closes the list without changing anything.
- [ ] My profile → Or edit → About you opens Edit profile scrolled to the About you heading, and Work to the Work
      heading. This checks the scroll to a section (`measureLayout`) on the new architecture.
- [ ] TalkBack or VoiceOver, on Rahul's feed: Not now on "Complete your profile" moves focus to "Hidden for 14 days. My
      profile always shows what's left to add." The card stays away on the other phone and after restarting the app.
- [ ] Links open the phone's browser, and coming back finds the app where it was: LinkedIn on Priya's profile
      (Directory), Apply and the address in How to apply on "Backend Engineer (Node.js)", its website under About the
      company, and the map link in the Mumbai alumni coffee meetup. The meetup's email address opens the mail app.
- [ ] Chips, on the narrowest phone you have, at the usual text size and then the largest: Open to in Edit profile →
      About you, Clubs and societies on About you of Rahul's registration at Demo College, and the reasons in Report
      (a post's Report link). Every chip is at least a fingertip tall, its name whole and inside the screen: a name too
      long for the row wraps inside its chip, never past the edge. A chosen Open to, club or reason is on the light
      brand tint with a thin ring, its name in the brand colour with a tick before it; choosing one may move the chips
      after it along. The labels stop growing at twice the usual size. TalkBack or VoiceOver reads each chip as a
      button and says whether it's selected.
- [ ] Registration's step bar at the largest text size (on Rahul's registration at Demo College): a step name too long
      for its third of the row ("3 About you") goes onto a second line, at its spaces, rather than ending in "…", and
      the three bars stay in line above the names.

### 4. Photos

Every photo is prepared on the phone before it goes up (README → Photos and uploads). Take the photos below with the
phone's own camera first, so they are in its library. Each one should upload, with no message under the button, and
show in its preview and, once saved, on its card or page the right way up. Branding's logo and cover are checked with
the console (part 14).

- [ ] iPhone, with Settings → Camera → Formats → High Efficiency on (photos saved as HEIC): a photo as a post's image,
      an event's cover, a business's logo and a job's logo.
- [ ] iPhone 15 Pro or later, a 48-megapixel photo (Settings → Camera → Formats → Resolution Control on, then 48 MP in
      the Camera app), or a panorama: as a profile photo (the system editor crops it, then the round preview shows it)
      and as a post's image.
- [ ] Android: a HEIF photo (on a Samsung, Camera settings → Picture formats → High efficiency pictures; or a .heic
      sent from an iPhone and saved to the gallery) and a full-resolution photo of 50 megapixels or more, each as a
      post's image and as a profile photo (cropped square, then round in the preview). On a phone with little memory,
      the app doesn't close while preparing it.
- [ ] A PNG logo and a GIF logo with see-through backgrounds (save them from a browser to the library), and a large
      cut-out PNG (a 3000 × 3000 photo of a person on a clear background) as a post's image: on the business's card
      and page and in the post, the background stays see-through, not black or white.
- [ ] Pick a large photo as a profile photo and choose Cancel upload at once, while it is still being prepared: the
      button goes back to Add photo with "Upload cancelled." read out, and nothing is uploaded (no photo appears).
- [ ] Disconnect the computer running the API from the network, so the upload hangs, and pick a profile photo: Cancel
      upload stops it, the button goes back to Add photo, and focus stays there. Pick again and wait: after 90 seconds,
      "The upload is taking too long. Check your connection and try again." shows. Reconnect, and Add photo works again.
- [ ] The web app in iPhone Safari: a HEIC photo as a post's image uploads and shows, the right way up.

### 5. Reactions and brand colours

- [ ] On the feed, press and hold a reaction on a post: the chip shrinks a little while held. Once chosen it is a light
      brand tint with a thin ring and a filled icon, and the count beside it turns the brand colour; Like again takes it
      back. Check it here at Demo University (blue); part 13 checks it at Shri Gujarati Samaj (orange).
- [ ] TalkBack or VoiceOver reads the chosen reaction as selected and the other three as not.
- [ ] An empty list (Messages → Requests): its icon sits in a round, light tint of the brand colour and is drawn in the
      brand colour (blue at Demo University; part 14 checks it at the Samaj), and TalkBack or VoiceOver reads the title
      as a heading and doesn't stop on the icon.
- [ ] A member without a photo has the same initials colour on their post, in the directory, on their profile, in a
      chat with them and in the console's members list, and a different one from most other members; the institution's
      own initials (the app bar, Businesses, a group) are its colour on a pale tint, and on the start screen each
      institution's are in its own colour.
- [ ] Tags have a thin edge in their colour that you can see outdoors, at Demo University and at Shri Gujarati Samaj:
      a post's Announcement badge, a job card's skills and a pending member's badge in the console. On an event, the
      chosen RSVP is its colour (green for I'm going) with a check, the label not cut off at the largest text size, and
      TalkBack or VoiceOver reads the buttons as a "Your RSVP" group, the chosen one as selected. In a poll you voted
      in, each result is one item, and yours ends "your vote".
- [ ] On London pub night (Events → Past), Who's coming shows Going and Maybe tabs that are easy to hit, each empty
      list saying only "No one has said yes yet" or "No maybes yet" under the icon in the brand's round tint. Your own
      new post's page says "No comments yet" and "Be the first to reply." the same way.
- [ ] A search that finds nothing, with TalkBack or VoiceOver on: type "zzzz" in the Directory's search box, and
      "No members match. Try removing a filter." is read once, not once a letter. With the keyboard still up, one tap
      on Show all members empties the search and the filters and puts the reader on the Search members box. The same on
      Jobs ("No openings match", Show all openings, the Search jobs box), Businesses (a city of "nowhere", Show all
      businesses), Mentors (an availability nobody has, Clear filters, the Search mentors box) and, signed out, the
      institution picker ("No institutions found", Clear search).

### 6. Navigation

- [ ] The tab bar fits Feed, Messages, Jobs, Directory and More, with a number on Messages, on the narrowest phone
      you have and with the largest text size. No label is cut off.
- [ ] Android: Back from a section behind More (Events, Groups, Mentors, Businesses, Funding) returns to the More
      hub, not out of the app. Back from a chat returns to Messages.
- [ ] My posts has seven tabs at Demo University (Posts, Jobs, Funding, Businesses, Groups, Upcoming events, Past
      events): they scroll sideways, the selected one scrolls into view, and no label is clipped. Nor are the tab labels
      on Jobs, Mentors and Groups.
- [ ] My posts as a new member, who has added nothing: each tab says what it holds, with its icon in the brand's round
      tint and its own button (Write a post, Post a job, I'm raising and I'm investing, Add a business, Create group,
      Plan a gathering; none on Past events). Each opens its form, Funding's on the kind pressed. Back from a section's
      form lands on that section's list (Jobs, Funding, Businesses, Events), never on a screen with no way back, and
      Back from Create group returns to My posts; Write a post opens New post, and posting returns to the feed.
      TalkBack or VoiceOver reads each button as a link.
- [ ] Bell notifications of each kind open their screen, a chat message's time and day labels look right, and a group
      whose name starts with an emoji (create "🏃 Morning runners") shows the initials "MR". These check `Object.hasOwn`,
      `Intl` and Unicode handling on Hermes.
- [ ] More, on the narrowest phone you have with the largest text size: the Connect, Community and You groups, each
      row's line wrapping under its name without overlapping the chevron or a count, and the screen scrolling down to
      Sign out.
- [ ] VoiceOver and TalkBack read each More row's name (with its count, such as "Groups, 1 invitation"), then its line
      ("Members raising and investing"), and the group headings as headings.
- [ ] The feed's Explore row, on the narrowest phone you have with the largest text size: its chips wrap onto more
      lines rather than running off the screen, no label is cut off, and a count stays beside its label. VoiceOver and
      TalkBack read "Explore" as a heading and each chip as a link by its name ("Groups, 1 invitation").
- [ ] Android: Back from a section opened from Explore (Funding, say) returns to the feed, not to More.
- [ ] The feed's Upcoming events strip, on the narrowest phone you have with the largest text size: each event's card
      grows wider and taller with the text, its title and its date and place each wrapping onto up to four lines
      (cut with an ellipsis only past that; the strip's text stops growing at twice its size) and its answer inside
      the card; the date tile's month and day stay inside the tile; and the strip scrolls sideways to the next event.
      Close the app and open it again at that size (and at one step above the standard size): the posts under the
      strip don't move when its events arrive. VoiceOver and TalkBack read "Upcoming events" as a heading, each event
      as one link by its title, date, place and answer ("Mumbai alumni coffee meetup, …, Mumbai, You: yes"), and See
      all as "See all events".
- [ ] Android: Back from an event opened on the strip goes to the Events list, then to the feed. RSVP to it in the
      browser as the same member, then pull the feed down: the strip shows the answer.

### 7. Messages

- [ ] Messages: the chat with Priya shows "2008–2012" after her name, with the message preview under them, and "London &
      UK alumni" shows no years. Open the chat: its header has her years under her name. On the narrowest phone you
      have, with the largest text size, the name and years fit their row without covering anything else in it.
      TalkBack or VoiceOver reads her years with her name, in the list and in the header.
- [ ] Open Rahul's chat with Priya and tap the message box. The box and the newest message stay above the keyboard,
      with no gap and nothing hidden behind it, and closing the keyboard puts the screen back.
- [ ] Type several lines. The box grows to its limit and then scrolls inside itself, and Send stays reachable.
- [ ] In a long thread (send 30 messages from the browser), scroll up to load older messages: what you're reading
      doesn't jump. While you're scrolled up, a new message from the browser doesn't drag you down: a New messages
      button appears, and tapping it takes you to the newest. In "London & UK alumni", each run of messages shows the
      sender's name.
- [ ] Put the app in the background for a minute while Priya sends two messages, then bring it back. They appear
      without pulling to refresh, and new ones keep arriving live.
- [ ] Turn on flight mode and send a message: it offers Try again. Turn flight mode off and tap Try again: it arrives
      once.
- [ ] Disconnect the computer running the API from the network, so the phone's request hangs instead of failing, and
      send a message: after about 20 seconds it offers Try again. Reconnect and tap Try again: it arrives once. (On
      Android this checks that the app's fetch honours its abort signal.)
- [ ] The message box and the search boxes offer no saved passwords or autofill suggestions on either keyboard.
- [ ] Create a group and open it before anyone writes: "No messages yet" and "Messages in {the group} show here."
      read the right way up, under the icon in the brand's round tint, just above the message box. Send a message:
      the box goes and the message takes its place. As a new member, Messages offers Find people and Find a group,
      and Find people opens the Directory's tab, with Back (Android) returning to Messages.
- [ ] Tap one of Priya's messages and choose Report message: the sheet opens. In Conversation options, choose Block
      member: the confirm sheet opens once the first one has closed (iPhone especially). Unblock her afterwards under
      Messages → Blocked members.
- [ ] The web app in iPhone Safari and Android Chrome: open a chat, tap the message box, and the box stays in view
      above the keyboard.
- [ ] Open Message this member on a member you haven't messaged, and tap the message box. The note "Say hello to …"
      stays whole above the keyboard, or scrolls, with nothing cut off; its envelope is in the institution's colour on
      a pale disc; and TalkBack or VoiceOver read its title, its text and its tip, in that order, before the box, and
      skip the envelope.
- [ ] Send a first message to a member you haven't messaged. Under Request sent, the line with the clock reads like
      "You can ask again from Mon, 7 Dec if they haven't accepted by then." (no "Invalid Date", and the day and date as
      the web shows them: Hermes writes it with the same `Intl` options as the chat times), and TalkBack or VoiceOver
      read it as one sentence.

### 8. Groups

- [ ] TalkBack or VoiceOver reads the open and invite-only choices as radio buttons with their checked state, and a
      disabled choice as disabled.
- [ ] Have Priya create an invite-only group in the browser and invite Rahul. With the invitation waiting, More reads
      "Groups, 1 invitation" with TalkBack or VoiceOver, and long group names on cards are read in full.
- [ ] Android: Back from Groups (behind More), from a group's details and from its chat goes one step back each time.
- [ ] In "Batch of 2012 reunion committee", which Rahul owns, open Group details, tap Aisha Qureshi and choose Remove
      from group, then tap Priya and choose Block member. Each confirm sheet opens once the member's sheet has closed
      (iPhone especially). Cancel both, so the checks below still work.

In the next three checks, each button opens its screen once: Back (and, on the iPhone, the swipe back) never leads to a
second copy of a screen, or back to the page the button was on.

- [ ] Open a group's chat, then Group details, and choose Open chat: you're back on the chat, and Back goes to where
      you opened the chat from. On a member's sheet in Group details, View profile opens their profile in Directory.
- [ ] Have Priya create an open group in the browser. On the phone, find it in Groups → Discover, open it and choose
      Join group: its chat opens in place of the group's page, and Back goes to Discover.
- [ ] In Groups → Invitations, tap the name of the group Priya invited Rahul to (above) to open its page, and choose
      Accept invitation there: its chat opens in place of the group's page, and Back goes to Groups.

### 9. Mentorship

- [ ] TalkBack or VoiceOver: a request row's name link is easy to hit, and after Accept, Decline or Withdraw the row's
      new status is announced.
- [ ] Android: Back from Mentors (behind More) and from a mentor's page and request form.
- [ ] Sign one phone in as Arjun (`+91 91000 00003`), who has no mentorship or request. Have the admin switch
      Mentorship off under Admin → Settings, then reopen the app: Mentors has gone from More. Switch it back on and it
      returns. Rahul, who has a mentorship under way, keeps Mentors behind More while it's off.
- [ ] Have Sneha (`+91 91000 00006`, in the browser) offer to mentor under Be a mentor. Sending her a request from the
      phone lands on Mentors → Requests → Sent, and going back never returns to the form or her page. While it waits,
      See your request on her page does the same. View full profile on a mentor's page opens their profile in
      Directory, once. (Rahul's own mentor page, reached by a link, is in part 20.)
- [ ] Open Be a mentor on the narrowest phone you have, at the usual text size and then at the largest: every area
      name is whole (never "Entrepreneurshi p"), each chip is at least a fingertip tall and inside the screen, and
      chosen ones are on the wash with a filled box and tick. The labels stop growing at twice the usual size. On a
      320-point phone (iPhone SE, first generation) "Entrepreneurship" may still break past about 1.8×: note it in the
      run if it does.
- [ ] TalkBack or VoiceOver, with five areas chosen: Law is read as a dimmed (disabled) checkbox, then "Choose up to 5.
      5 chosen: untick one to choose another."

### 10. Referrals

- [ ] Android: Back from the request form returns to the job.
- [ ] Sending a request (on Priya's "Associate Product Manager") lands on Jobs → Referrals → Sent, and Back doesn't go
      back to the form or the job. Back on the job, See your requests does the same.
- [ ] TalkBack or VoiceOver reads the "I can refer people for this job" checkbox with its state and its hint.

### 11. Jobs

- [ ] On Post a job, the chip rows too wide for the screen (Type, Seniority, Currency and Company size, at least)
      scroll sideways. Tapping a chip partly off the screen scrolls its row until the chip is whole on the screen, and
      a row whose choice is already in view stays where you left it. Post a job with Executive seniority and a company
      size of 5,001+, then Edit it: the form opens with both chips on the screen, though each is last in its row.
- [ ] TalkBack or VoiceOver, with one phone signed in as Vikram (`+91 91000 00005`), whose profile lists SQL: on Jobs,
      the card for Priya's "Associate Product Manager" is read in full, title first, with its skills as "SQL (you have
      this), Product management, A/B testing, 1 more". On its page, the SQL chip is one stop read as "SQL (you have
      this)", the other skills are read by name alone, and "You have 1 of 4 skills" follows them.
- [ ] Open Backend Engineer (Node.js) at the usual text size: its facts sit two across. Then at the largest text size
      (and on the narrowest phone you have): they go to one column, every word whole ("Experience" never split), and
      "Applications close …", where shown, still runs under them across the grey box.

### 12. Businesses and other screens

- [ ] Add a business: the form opens as a modal and closes cleanly, and choosing a logo opens the phone's own photo
      picker and shows the logo once it's uploaded.
- [ ] TalkBack or VoiceOver, on Zylo Labs in Businesses: the contact buttons read "Website" (with a hint that it opens
      in the browser), "Email hello@zylolabs.example" and "Call +91 22 5550 0101", with no symbol names. As Rahul, edit
      his Zylo Labs listing in Funding to add an email address and a phone number: its buttons read "Website", "Get in
      touch" and "Call …" the same way.

### 13. Notices with Approve and Reject

For parts 13 to 16, both phones are Shri Gujarati Samaj's admin, Jignesh Patel (`+91 90000 00004`), who has two
members waiting for approval (Parth Joshi and Diya Raval). Three checks on the way there:

- [ ] Sign Rahul out from More: you land on Demo University's own page, with "Sign in / Join with mobile number". Choose
      a different institution, then Shri Gujarati Samaj, and sign in as Jignesh.
- [ ] On the Samaj feed, press and hold a reaction on a post, as in part 5: once chosen, the chip is a light orange tint
      with a thin ring and a filled icon, and the count beside it turns orange. Like again takes it back.
- [ ] On the Samaj feed, the grey line under Hetal Shah's name on her posts starts "2005–present": she is still a
      member.

Then, on a computer, join Shri Gujarati Samaj in the web app with another number that isn't in the demo data
(`+91 98765 43212`, say), giving 2015 as Member since and leaving Until blank, and submit for approval: the admin's
Notifications get a new-member notice.

- [ ] In Notifications, that member's notice says "… (2015–present) has requested to join." and has Approve and Reject
      under its text, and TalkBack or VoiceOver reads them with the member's name ("Approve …", "Reject …"). Approve
      asks first; Cancel. Tapping the notice's text opens the member's page in the console, and Back returns to
      Notifications.

### 14. The admin console, page by page

Still the Samaj admin on both phones, except for Chat reports. Sign Rahul back in after part 16.

**Dashboard**

- [ ] More shows Admin console with an amber 3 (Parth, Diya and the request from part 13), and TalkBack or VoiceOver
      reads the row as "Admin console, 3 waiting". My profile has an Admin console link too. Each opens the console,
      with no tab bar, and Back (and, on the iPhone, the swipe back; on Android, the back button) returns to where it
      was opened.
- [ ] TalkBack or VoiceOver, on the console's home: each tile is one stop, read as its label and count ("Pending
      members, 3"), then its hint; "Needs you", "At a glance" and "Sections" are read as headings; the sections' icons
      are silent; and every section in the list opens its page in the app.
- [ ] Pulling the console's home down refreshes it.
- [ ] Under My profile → Appearance, choose Institution colour: the member screens take the Samaj's tint, and the
      console's screens stay on the plain page. Choose Plain again.
- [ ] Any empty tab in the console (Reports → Dismissed, say): its icon sits in a round, light orange tint and is drawn
      in orange, as in part 5.

**Members and a member's page**

- [ ] On the members list, choose Reject on the member from part 13: with the keyboard up, the reason box and the
      sheet's Reject and Cancel stay above it on both phones, and Reject stays disabled until the reason has 3
      characters. On Android the back button closes the sheet (the keyboard first, if it's up), and opening Reject again
      still shows what was typed. Cancel on the first phone; on the second, Reject with a reason: the line above the
      list says so, and TalkBack or VoiceOver reads it out without moving focus. Their notice in Notifications, on both
      phones, then says where they stand, with no Approve or Reject.
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
- [ ] At the largest text size, Nisha's facts, the tiles on the console's home and on Analytics, and the figures above
      Invitations go to fewer columns (one, if need be) rather than splitting a word ("Registered", "Approved"), each
      row's tiles the same height; back at the usual size they are two across (three for Invitations' figures).

**Moderation and reports**

- [ ] Moderation → Published → Post, Remove on a post, on the smallest phone you have: with the keyboard up, the note
      box and the sheet's Remove and Cancel stay above it. On Android the back button closes the sheet (the keyboard
      first), and Remove again still shows the note. Cancel it, so nothing is removed.
- [ ] Moderation → Published → Job, View full content on "Export Documentation Executive" and on a long job: the
      preview fits the screen with nothing cut off at the sides, the apply link can be selected but not tapped, and on a
      low-end Android a long preview scrolls smoothly. A post with photos (post one with two photos from New post first)
      shows them as small thumbnails that load.
- [ ] TalkBack or VoiceOver on a queue row: its badges are read as words ("Announcement", "Pinned", "1 report"), View
      full content says whether it's expanded, and each Approve, Remove or Pin is followed by the item's opening words,
      so one row's can't be mistaken for the next's. Open in app says it leaves the admin console, and does: the post
      opens with one tab bar, and More → Admin console returns.
- [ ] Report two posts from the feed (as Hetal, `+91 91000 00031`, in the browser), one for each phone. On each phone,
      open its own report's notice in Notifications: Reports opens on Open with that report, and Resolve, keep content
      with a note says "Report resolved" in the line above the list, read out without moving focus. Then, on the first
      phone, open the other report's notice, which the second phone has resolved: Reports opens on Open, and the line
      above the list says "That report has already been handled."

**Chat reports**

Sign one phone in as Demo University's admin (`+91 90000 00001`), which has a seeded open report, for these four.

- [ ] Chat reports: the row says who reported whom and why, and no words. View messages, then open the app switcher
      (iPhone: swipe up and hold; Android: Recents): the app's picture there shows no message text, and back in the app
      the report is closed again (View messages). Do the same by switching to another app and back. Until this passes
      on both phones, README only says the app means to keep the text out of that picture.
- [ ] The same with the note sheet open: View messages, Remove message, type a note, then open the app switcher or
      Recents at once: the picture shows neither the note nor the messages, not even part way through the sheet sliding
      away. If it does, the sheet has to close without its animation when the app goes inactive. Back in the app, the
      report is closed, and View messages then Remove message opens an empty note.
- [ ] With the messages open, VoiceOver or TalkBack reads each message's sender and time, "Reported message" on the
      reported one, then its words; a long press on the words offers no Copy.
- [ ] From an open report, open "…'s member page", then go back (iPhone swipe back, Android back button): the report
      is closed, with no words. Remove message: with the keyboard up, the note box and Remove stay above it on both
      phones; on Android the back button closes the sheet. Cancel, and Hide.

**Invitations** (importing a list and the template are in part 15)

- [ ] Copy link on a row, then paste it into WhatsApp or Notes: the whole link. WhatsApp on a row opens WhatsApp at
      that number with the invitation written in; with WhatsApp not installed, the wa.me page in the browser.
- [ ] TalkBack or VoiceOver on Invitations: each tile is read as its label and count, Can send today as "none" on a plan
      that sends nothing; each row's buttons with the person ("Copy link for …", "Revoke the invitation for …"); Revoke
      asks in a sheet, which Android's back button closes, changing nothing.

**Profile questions**

- [ ] Profile fields → Add field: the editor opens as a modal sheet (swiping it down, on the iPhone, closes it and
      keeps nothing). Type a question: the box stays above the keyboard and the key fills in. Choose "Choose one" in
      Answer type (its list opens over the sheet). In "Add an option…", type an option and press Return: it's added,
      the box stays focused and the keyboard stays up; add a second the same way, then remove it with its cross.
      Scroll to Add field with the keyboard up and save.
- [ ] Profile fields, TalkBack or VoiceOver: the arrows are read as "Move … up" and "Move … down", the first field's up
      and the last's down as dimmed; after a move the new place is read out ("… moved up: 2 of 3"), and focus stays
      on the arrow pressed.

**Settings**

- [ ] Settings: tap "Earliest batch year". The number pad comes up with the box still in view above it, on the iPhone
      and on Android, and only digits go in (four at most). Scroll down with the keyboard up: Save settings can be
      reached. TalkBack or VoiceOver reads Mentorship, with Messaging off, as a dimmed (disabled) checkbox and then
      "Needs Messaging".
- [ ] Settings: switch Funding off and save. With VoiceOver on, "Settings saved" is read out once (not again when the
      form starts over from the saved settings). Back to More: Funding has gone without a pull to refresh. Switch it back
      on. (Signed in as the demo-school admin, `+91 90000 00003`, the last paragraph under the switches reads
      "Messaging, Groups and Mentorship start off for schools…" on the phone as on the web.)

**Branding**

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

**Analytics** (its exports are in part 15, its charts in part 16)

- [ ] Analytics, from the console's Analytics row: the period choices (Last 12 weeks, Last 6 months, Last 12 months),
      the headline figures, each compared with the period before, and every chart fit the screen with no sideways
      scrolling. Choosing another period keeps the old charts up under "Updating…" until the new ones arrive. Table on
      a chart shows its figures in place of the chart (part 16 checks the tables).

**Audit log**

- [ ] Audit log (from the console's home): the chips scroll sideways and each is read as a button with its state;
      Members fills the field with "membership." and TalkBack or VoiceOver reads each row's action, time, who acted and
      its details. A row's "membership …" link opens that member's page, and Back returns to the log with Members still
      chosen. Scroll fast to the end: more rows load with no repeats, and the line under them counts what's shown.

**Announcements**

- [ ] New post, as the Samaj admin: TalkBack or VoiceOver reads Announce as a button, not selected, and once pressed
      as "Undo announce", selected; Pin to the top of the feed as a checked checkbox, and the line saying the plan has no
      channels. Post announcement goes back to the feed with "Announcement posted; members are being notified", the
      post first with its Announcement badge and Pinned line, framed. Unpin it from the console's Moderation afterwards.
      (On Demo University, whose plan includes email, as `+91 90000 00001`: ticking Also email it and posting asks first
      in a sheet; Cancel it.)
- [ ] The feed's pinned posts, on the Samaj with Institution colour chosen (My profile → Appearance) and the largest
      text size: each pinned card stays white, its frame in the brand's colour showing against the card, its Pinned
      line above the author not cut off; then "Latest posts" over the rest. VoiceOver and TalkBack read "Pinned" before
      the author's name and "Latest posts" as a heading; on Android the frame and the announcement's left edge meet
      cleanly at the rounded corners.

### 15. Files

The console's file pickers and the share sheet, as the Samaj admin.

- [ ] Invitations → Import a list → Choose CSV file: on the iPhone pick a CSV from Files (On My iPhone, then iCloud
      Drive), on Android from Downloads and then from Google Drive. Each shows its first rows and the columns used. A
      CSV that Excel saved with ";" between the columns reads the same, and one saved as "CSV UTF-8" with Gujarati
      names shows them correctly in the preview and, once imported, on the list.
- [ ] Import a long list (a CSV of a few thousand rows, picked the same way): while "Importing … of …" counts up, the
      bar's Back, the iPhone's swipe down and Android's back button leave the screen where it is, and "Keep this screen
      open until the import finishes." shows (VoiceOver or TalkBack says it on a blocked Back). Done then returns to the
      list, which says how many were invited.
- [ ] Import's Template opens the share sheet with invitations-template.csv (not .csv.csv). Save it to Files (iPhone) or
      Drive or Downloads (Android). Opened in a text editor (Files' preview, or Notes), the columns are phone, name,
      start_year, end_year, email and the Samaj's question keys, the example row's phone reads +919876543210 with no '
      in front, and its end_year is blank (someone who still belongs). Opened in Excel or Google Sheets, the header row
      reads the same and start_year shows 2008, but the example phone shows as a number (9.19876E+11 in Excel,
      919876543210 in Sheets), as both read a leading + as a sign: so the import's hint says to format the phone column
      as Text before typing numbers. Do that in Excel, type +919876543210 with 2015 as its start_year, save as CSV
      UTF-8 and import it: the row is new, not refused as scientific notation, and its line says "From 2015".
- [ ] First set Jignesh's city on My profile to અમદાવાદ. Then Analytics → Members CSV: it says "Preparing…", and
      Activity CSV is dimmed and can't be pressed meanwhile (one export at a time), then the share sheet opens with
      shri-gujarati-samaj-members-<date>.csv (not .csv.csv), and closing the sheet without choosing anything shows no
      error. Do the same with Activity CSV (shri-gujarati-samaj-activity-<first week>-to-<today>.csv). Save both to
      Files (iPhone) or Drive or Downloads (Android) and open them in Excel or Google Sheets: the columns line up, the
      first header reads "Name" with nothing in front of it, the names read correctly, both files have Start year and
      End year columns (Hetal Shah's End year blank: she still belongs), the Members CSV has a Chapter column and its
      city reads અમદાવાદ (not "àª…": the file is UTF-8 with a byte order mark), and each phone number keeps all its
      digits, behind a ' that stops a spreadsheet reading it as a sum. Put Ahmedabad back.

### 16. Charts

On the console's Analytics, as the Samaj admin, with the web console's Analytics open beside it on a computer.

- [ ] Hermes number and date text. Choose each period in turn and compare it with the web's: the week labels read like
      "2 Nov" (day, then month), the line above a chart (its readout) like "Week of 2 Nov 2026", figures are grouped
      with commas ("1,234"), an axis that reaches 10,000 reads "10K", and each change reads like "+12% vs the previous
      12 weeks (10)", the same as the web shows. Nothing reads "NaN", "Invalid Date", "undefined" or a raw date such as
      "2026-11-02". These are written by hand, as Hermes lacks parts of `Intl`. Dates and counts elsewhere in the
      console (a member's page, the audit log's times, the invitations) read as on the web console too.
- [ ] Another language, region and time zone. Set the phone to Hindi (India), then to English (United States) with
      the time zone New York (Date & Time, with setting it automatically off), and open Analytics each time: the weeks
      under the charts read "2 Nov" and the readout "Week of 2 Nov 2026", never "Nov 2" or a date a day out, and figures
      keep their commas ("1,234") and the same digits. Put the language, region and time zone back afterwards.
- [ ] Scrubbing. Drag a finger along "New members per week" and "Activity per week": the line above each chart follows
      the week under the finger, the chosen week stands out (the column under the finger stays solid while the others
      fade; on the lines, a crosshair and dots), and the choice stays when the finger lifts. A drag up or down that
      starts on a chart scrolls the page instead, and leaves the week that chart had chosen as it was (scroll the whole
      page with a finger on the charts: no week is chosen in any of them).
- [ ] TalkBack or VoiceOver. Each column and line chart is one stop, read as its summary ("New members per week, 3 in
      total"), adjustable, with the latest week's readout as its value; swiping up and down (VoiceOver) or the volume
      keys or swipes TalkBack offers for a slider step a week at a time (Next and Previous), reading "Week of …, 1
      approved" (each series, by name, on Activity per week; "Joined in …, … members" on Members by year joined, which
      a community such as the Samaj has in place of Members by batch's "Batch of …, … members"). The chart drawings
      and the line above them aren't read on their own. The headline tiles are read as their label and figure, then
      the change ("+12% vs the previous 12 weeks (10)"), with hints turned off too (VoiceOver's Speak
      Hints, TalkBack's usage hints). Table is read as a button that says whether it's on (selected while the table
      shows), its hint saying what pressing it does ("Shows New members per week as a table", then "Shows New members
      per week as a chart again"), and the table's rows and cells in order; a bar chart's rows as their label and
      count ("Mumbai, 12 members"). Choosing Last 6 months says "Updating…" on both (VoiceOver is told it; TalkBack
      reads a live region).
- [ ] A year's table. Choose Last 12 months and open New members per week's Table: on Android its 53 rows scroll
      inside the card, and the page scrolls once the table reaches its end.
- [ ] Narrow phones and large text. On a narrow phone (320 to 360 points wide), then with the largest text size,
      Activity per week's Table shows every header whole ("Comments" never broken inside the word) with each figure
      under its header; where the five columns don't fit, the table scrolls sideways inside its frame, and the page
      doesn't.

### 17. Appearance

As Rahul, under My profile → Appearance. Choose Plain again at the end, so the other checks see the plain page.

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

### 18. Delete account and rejoining

- [ ] TalkBack or VoiceOver, on Rahul's My profile: Delete my account opens the confirm sheet (it used to be a system
      alert). It's read as an alert named "Delete your account?", then the whole explanation, including "If you were
      suspended at an institution, or members there had blocked you, that still applies if you join again with this
      number.", then Delete account and Cancel, and focus stays in the sheet until it closes. Cancel (and Android's
      back button) closes it and leaves the account. Don't confirm it as Rahul.
- [ ] With the number from parts 1 and 2, signed in on the phone: message Priya (Directory → Priya Nair → Message this
      member), and in the browser, as Priya, open the request and choose Block member. As Demo College's admin
      (`+91 90000 00002`, web), approve the number's request under Admin → Members; as Demo University's admin, suspend
      it there with a reason. The phone shows "Membership suspended" at Demo University (reopen the app if it hasn't
      yet). Choose another institution → Demo College: its walk-through opens, as this is the first visit since the
      approval; Skip it, then More → My profile → Delete my account → Delete account: the app opens the list of
      institutions. Sign in with the same number at Demo University and register again: after Join the network the
      screen says "Membership suspended" and "Reason given: Suspended before this account was deleted". As the admin,
      find the member under Suspended and Reinstate them: within half a minute the phone opens Demo University's
      walk-through (the membership is a new one, so it's owed); Skip it for the feed.
      Message Priya again: it says the request was sent, as before, but Priya's Messages show nothing new, and her
      Blocked members list the new account.

### 19. Keyboard on long forms

Still the number from part 18, a member of Demo University again, which saves signing Rahul in once more (on another
day, Rahul does as well). Every screen built on `Screen` now makes room for the keyboard on Android too (its
KeyboardAvoidingView pads there, as the chats do), since Android's edge-to-edge window on SDK 58 no longer shrinks for
it. Look for room made twice (a blank band above the keyboard) as well as none.

- [ ] Android especially: the long forms (Edit profile, Post a job, Add a business, Plan a gathering, New post) move up
      with the keyboard, so the box being typed in and the button at the bottom can be reached, with no blank band
      above the keyboard and nothing hidden under it. Closing the keyboard puts the form back, with no gap left at the
      bottom.
- [ ] Registration at Demo College (More → Switch institution, as in part 3; leave without sending): on each
      step, tap the last box: it and the step's buttons (Continue, Skip for now, Back, Submit for approval) stay above
      the keyboard, with nothing hidden behind it. On Work, choose Add a past role and type in each of its boxes, the
      years too: Done and Remove stay reachable. Do the same on My profile → Edit profile, down to the links in About
      you, and in Add a place of study.
- [ ] Create a group and edit it: the keyboard leaves the fields and the save button reachable. The invitation
      sheet's search box does too.
- [ ] The mentorship request note and the Be a mentor fields stay above the keyboard.
- [ ] On a job that takes referrals, Ask for a referral: the note field stays above the keyboard under the header, and
      on the iPhone dragging the page down closes the keyboard. Type a long note: the box grows and nothing is cut off.

### 20. Pushes and links (development build only)

Expo Go can't receive the app's pushes or open `illuminize://` links, so these need a development build on each phone,
made after the five native modules above were added.

1. Create the Expo project first (README → Mobile → Push notifications), or no pushes arrive. Then, in a second
   terminal, `cd apps/mobile` and:
   - Android, plugged in with USB debugging on: `npx expo run:android`. It builds with the Android SDK, so install
     Android Studio first and set ANDROID_HOME to the SDK (on Windows `%LOCALAPPDATA%\Android\Sdk`; in PowerShell,
     `$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"`), or the build stops, unable to find it. Use a phone on USB,
     not an emulator, unless the computer has emulator images.
   - iPhone, on a Mac with Xcode: `npx expo run:ios --device`. Without a Mac, use EAS Build, which needs a paid Apple
     developer account: the repo has no `eas.json` yet, so run `npx expo install expo-dev-client` and
     `eas build:configure` once, register the iPhone with `eas device:create`, then
     `eas build --profile development --platform ios` and install what it gives you.

   `expo run` starts the Expo server when it's done. Another day, start it with `pnpm mobile`.
2. Allow notifications when the app asks, and sign Rahul in again on each phone. On one phone, first check that a
   member who has just joined isn't asked until their walk-through is over: before signing Rahul in, sign in with a
   number that isn't in the demo data (`+91 98765 43212`) and join Demo University. The walk-through opens with no
   notification prompt over it, and the phone asks once Get started opens the feed. Allow it, then sign out under More.
3. A push about a chat comes 5 to 10 seconds after the message, and one about a group 30 to 60 seconds after. After a
   push, that chat sends you no other for 2 minutes (a group for 10) unless you open it or write in it, so wait between
   checks that need one.

**Messages**

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
- [ ] Sign Rahul in on the web app too. On the phone, open the chat with Priya and put the app in the background, then
      send to that chat as Priya. The phone gets a push, and Rahul's web app counts the chat unread until the phone is
      back in front on that chat, which marks it read.
- [ ] Lock-screen text: a message from Priya shows "New message from Priya Nair"; a first message from someone with no
      chat with Rahul (sign in on the web as Sneha, `+91 91000 00006`) shows only "New message request". No message
      text appears anywhere on the lock screen.
- [ ] As the admin, remove a message the phone member sent (Admin → Chat reports, after reporting it from the
      browser). The push says only "A message you sent was removed", and the admin's note shows only in the app.

**Links**

- [ ] With the app closed, open a job, business or mentor from a push or a link (for example
      `illuminize://t/demo-university/jobs/<id>`, with an id from the web app's address bar). Back (and, on the iPhone,
      the swipe back) goes to that section's list.
- [ ] Open such a link while the app is on another section: Back goes somewhere sensible, never to a duplicate screen.
- [ ] Open Rahul's own mentor page, `illuminize://t/demo-university/mentors/<id>`, with the id from the end of his
      profile's address in the web app's Directory: Edit mentor profile opens Be a mentor, once, and Back never returns
      to a second copy of either.
- [ ] Android, with registration the only screen: force-quit the app, then, as Rahul (no member of Demo College), open
      `illuminize://t/demo-college/register`, fill in Basics, Continue, and press the back button: it goes to Basics,
      not out of the app. Back on Basics with a name typed asks "Leave registration?", and Leave opens the landing
      screen. Nothing is sent.

**Groups, mentorship and referrals**

- [ ] Have Priya create another invite-only group in the browser and invite Rahul, with the app closed: tapping the
      push opens Groups → Invitations, and Back works. Then, with the app open, have her create one more and invite him
      to it: that invitation shows a banner. Before accepting either, open
      `illuminize://t/demo-university/messages/<id>` with the id from the end of the first one's address in Priya's
      browser: the app offers See invitation, which opens Groups → Invitations, once.
- [ ] A push about a group's moderation opens My posts → Groups: have the phone member create a group, and the admin
      remove it under Admin → Moderation → Published.
- [ ] Mentorship pushes. Have Priya ask Rahul for mentoring from the browser: tapping the push opens Mentors →
      Requests. Then have Sneha accept, in the browser, the request Rahul sent her in part 9 (after a reset, first have
      her offer to mentor under Be a mentor and Rahul ask her from the phone): tapping that push opens the chat.
- [ ] Have Priya ask for a referral on Rahul's "Backend Engineer (Node.js)" from the browser, with the app closed:
      tapping the push opens Jobs → Referrals. With the app open, referral pushes show a banner.

**The walk-through**

- [ ] A push tapped over the walk-through. As Rahul, join Demo College under More → Switch institution and submit for
      approval, and leave the waiting screen open. Have the Demo College admin (`+91 90000 00002`) approve him in the
      web console: within half a minute the waiting screen opens Demo College's walk-through. Leave the approval's push
      in the phone's notifications until then, and tap it there with the walk-through on screen: its screen opens with
      one tab bar, and nothing goes back to the walk-through. It isn't ended: force-quit the app and open it again,
      and the walk-through opens; Skip it.

**Admin console**

Sign one phone in to Shri Gujarati Samaj as its admin (`+91 90000 00004`) for these.

- [ ] With the app closed, have a new member ask to join: on a computer, join Shri Gujarati Samaj in the web app with a
      number that isn't in the demo data and submit for approval. Tap the push on the phone: the app opens on the new
      member's page in the console, with the console's home under it. Back (and the iPhone's swipe back) goes to the
      console's home, then to the Samaj feed, with one tab bar, never a blank screen; on Android one more Back leaves
      the app rather than showing the Samaj feed again (the phone remembers the Samaj, so the start screen redirects
      there as the push opens: one Samaj, not two). Do it again with the app open on another tab: Back returns there, by
      way of the console's home. Then once more with the console's home already open: the push opens the member's page
      above it, and a single Back returns to the console's home.
- [ ] Report a post from the feed in the browser (as Hetal, `+91 91000 00031`), and tap the push: Reports opens on Open
      with that report.
- [ ] Post an announcement from the phone (part 14, Announcements): a member's phone (Hetal's, signed in on the other
      phone) gets its push, and tapping it opens the post.

### Runs

One row per run, newest first: the phones and their OS versions, whether it was Expo Go or a development build (part
20 needs the latter), the commit (`git rev-parse --short HEAD`), how it went, and what failed, filed as follow-ups
(README → Known gaps until they're fixed).

| Date | Phones and OS | Expo Go or development build | Commit | Result | Follow-ups |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
