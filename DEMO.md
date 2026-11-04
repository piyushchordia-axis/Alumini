# Try Illuminize

The quickest way to try Illuminize is a **GitHub Codespace**: a cloud workspace that runs the database, the API and the
web app for you. You need nothing installed except a browser (and the free **Expo Go** app if you want the phone app).

> **On your own computer instead?** With Git, Node.js 22 and Docker Desktop installed (Windows, macOS or Linux):
> `git clone -b claude/illuminize-multi-tenant-platform-ho1w6e https://github.com/piyushchordia-axis/Alumini.git`,
> then in the `Alumini` folder `node scripts/setup-local.mjs` once and `pnpm demo`, and open http://localhost:5173.
> Everything below (logins, things to try) works the same; README.md → "Run it on your computer" has the details.

## 1. Start the workspace

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/piyushchordia-axis/Alumini/tree/claude/illuminize-multi-tenant-platform-ho1w6e)

Click the button above (or on GitHub: **Code → Codespaces → Create codespace**, on the branch
`claude/illuminize-multi-tenant-platform-ho1w6e`).

- The first start takes **about 3–5 minutes** while it installs everything and loads the demo data.
- When it is ready, a terminal shows a box titled **Illuminize demo** and the web app opens in a new browser tab.
- If the tab does not open: open the **Ports** tab at the bottom, find **Illuminize web app (5173)** and click the globe
  icon.

## 2. Sign in

Every sign-in uses your mobile number and a one-time code. In this demo the code is always **`123456`**, and it is also
shown on screen.

| Who | Phone number | What you'll see |
| --- | --- | --- |
| A brand-new alumnus | any number you like | Picks an institution, registers, and is approved instantly (Demo University) or waits for approval (Demo College, Demo School) |
| Member of Demo University | `+91 91000 00001` (Rahul Mehta) | The full member app: posts, messages, groups, mentors, jobs with referrals, businesses, funding, events and directory |
| Another member of Demo University | `+91 91000 00002` (Priya Nair) | A mentorship request and a referral request waiting for her answer |
| Admin of Demo University | `+91 90000 00001` | Members and posts are approved automatically; a reported chat message is waiting |
| Admin of Demo College | `+91 90000 00002` | Approval is required for members **and** posts; pending items and a spam report are waiting |
| Admin of Demo School | `+91 90000 00003` | Members need approval, posts publish immediately; messaging, groups and mentorship start off |
| Pupil at Demo School | `+91 91000 00026` (Naina Sen) | Still at school, so never sees messages, groups, mentors or referrals |
| Illuminize staff | `+91 99999 99999` | The platform console at `/platform` |

The phone field has a country picker. Choose **IN +91**, then type the 10 digits.

## 3. Things to try

**As a new alumnus**
1. On the first screen, pick **Demo University** and sign in with any new number. The landing is brand-first (cover +
   institution name); chrome uses SVG icons, not emoji.
2. Create your profile in three steps: **Basics** (a photo, your name and batch), **Work** (or **Skip for now**) and
   **About you**, then **Join the network**. "What's new" below walks through it.
3. Post in the community feed (composer tray with Add image / Poll / Post), react and comment on others' posts.
4. Open **Jobs** and post an opening, or switch to **Looking for work** and mark yourself as open to work.
5. Open **Events** and RSVP to the Mumbai coffee meetup, or plan your own gathering.
6. Search the **Directory** by name, company or skill, or filter it by batch and city.
7. Sign out, pick **Demo College**, register again with a new number, and see the "awaiting approval" screen.

**As an institution admin** (sign in to Demo College with `+91 90000 00002`, then click **Admin**)
1. **Members**: approve or reject the pending alumni, with a reason they will see. On the **Approved** tab, open a
   member such as Kiran Joshi to see their whole profile.
2. **Moderation**: approve or reject pending posts, the internship and the Toronto dinner. **View full content** shows
   the whole internship, its stipend included.
3. **Reports**: remove the reported spam post.
4. **Settings**: switch member approval or post moderation between automatic and manual, turn features on or off,
   and change the institution's colours and logo under **Branding**.

**As Illuminize staff** (open `/platform` and sign in with `+91 99999 99999`)
1. Onboard a new institution together with its first admin.
2. Open an institution's **Billing** tab, record a per-active-member plan, and look at the usage estimate for the month.
3. Check **Stats**, **Compare** and **Users**.

## 4. Try the phone app

The mobile app talks to the API on port 4000, so that port must be public first.

1. Open the **Ports** tab, right-click **Illuminize API (4000)**, choose **Port Visibility → Public**.
   The demo terminal tells you if this was already done automatically.
2. Open a new terminal (**Terminal → New Terminal**) and run:
   ```bash
   pnpm mobile:tunnel
   ```
3. Install **Expo Go** from the App Store or Google Play. Scan the QR code from the terminal: with the camera on iPhone,
   or from inside Expo Go on Android.

No phone handy? Run `pnpm mobile:web` instead, then open **Mobile app (Expo) (8081)** from the Ports tab for a
phone-sized preview in the browser. Port 4000 must still be public.

## What's new

**Richer profiles and job posts** (run `pnpm db:reset` first: the seeded profiles and job posts load only into fresh
demo data)

Profiles now hold a headline, past roles, studies, skills, links and what a member is open to, and joining walks through
them in three steps. Job posts give the pay, experience, skills, the role in sections and the company. The web and phone
apps match.

- **Join in three steps.** Pick **Demo University** and sign in with a new number. **Create your profile** opens on
  "Step 1 of 3 · Basics": choose **Add photo**, fill in your name and batch, and press **Continue**. On "Step 2 of 3 ·
  Work", type a headline, then press **Skip for now**: you move on to "Step 3 of 3 · About you" without what you typed
  on Work. The step bar at the top goes back to any step you've opened, and the browser's Back to the step before.
  Press **Join the network** and the feed opens. At Demo College the last button is **Submit for approval**, with "An
  admin at DCE will review your profile before you can join." under it.
- **Use details from another institution.** Sign in to **Demo University** as Kiran Joshi (`+91 91000 00011`), who is a
  member of Demo College only. The first step says "You have a profile at Demo College of Engineering". Give a batch and
  type a city, then choose **Use details from Demo College of Engineering**: it fills in his headline, company, skills,
  past role, studies, website and more, keeps the city you typed, and says what it filled in and what it kept. Press
  **Continue**, change the headline on Work, go back to Basics on the step bar and choose **Undo**: the rest goes, and
  your headline stays. The batch, the institution's own questions, the **Personal** details (marital status and kids)
  and the photo are never copied.
  Rahul or Priya signing in to Demo College see **Use details from Demo University** the same way.
- **Profile strength.** Sign in as Rahul (`+91 91000 00001`). The feed opens with **Complete your profile** at 80%, and
  the one thing missing, **Add a profile photo**, opens the Basics part of his profile. **Not now** hides the card for
  14 days on every device, leaving "Hidden for 14 days. My profile always shows what's left to add." in its place. **My
  profile** always shows **Profile strength** and what's **Still to add**. The feed's card also goes once a profile
  reaches 90%.
- **Edit your profile.** **My profile** shows your profile as other members see it, then its three sections, **Basics**,
  **Work** and **About you**, saved together with **Save profile**. On the phone app, choose **Edit profile** on My
  profile, or a section after **Or edit**. Add a headline, skills (press Enter or type a comma after each), **Add a past
  role**, a GitHub handle such as "@yourname" (it becomes the full address when you leave the box) and an **Open to**
  choice. Then find yourself in **Directory**: your card shows the headline, and your page the skills, your roles with
  the current one first, your studies and your links.
- **Directory by skill.** Search **Directory** for "Distributed systems": Sneha Kulkarni comes up from her skills alone,
  and her card shows **Investing**, what she's open to. **More filters** (**Filters** on the phone app) now has
  Industry, Skill, Field of study and Open to. Choose "Open to investing" (**Investing** on the phone app) and search
  for Priya: nobody matches, as she's open to hiring. Clear the filters and open Priya Nair for a full profile: her
  headline, skills, her roles in order, her studies here and in London, and a LinkedIn link.
- **Job posts.** Open **Jobs**. Rahul's **Backend Engineer (Node.js)** card shows "Zylo Labs · Mumbai · Remote",
  "₹25–40 LPA", "3–6 years" and three of its four skills with "+1 more". Its page has the key facts (the pay note "Plus
  ESOPs", Mid level, 2 openings), the skills, **Apply**, the role in sections (About the role, Responsibilities,
  Requirements, Benefits, How to apply) and **About the company**. Work mode, Seniority and "Your experience (years)"
  wait behind **More filters** (**Filters** on the phone app): type 1 in "Your experience (years)" and the backend job
  goes, while Priya's **Associate Product Manager** (1–3 years) stays.
- **Skills you have.** Sign in as Vikram (`+91 91000 00005`) and open Priya's **Associate Product Manager**: SQL, which
  is on his profile, is a filled chip with a check mark, and the line under the skills says "You have 1 of 4 skills".
  The job's card on the list shows SQL first, with the same check, and the page of Rahul's backend job says "You have 0
  of 4 skills". A member whose profile lists no skills (a new one that skipped Work, say) sees "Add your skills to see
  which you match" instead, which opens the Work section of My profile (**Edit profile** at Work on the phone app).
  None of this shows to the job's poster, or in an admin's preview.
- **Post a job.** As Rahul, choose **+ Post a job** (on the phone app, the **+** button on Jobs). Give it a title, type
  "Zylo Labs" as the company and write About the role. Under **Company**, the form offers **Use details from your last
  job at Zylo Labs**: it fills in the website, industry, size and about from his backend job and says "Filled in from
  your last job at Zylo Labs. Check them before you post." Type the pay in full, 1800000 as the Minimum pay and 2500000
  as the Maximum, and the form previews it: "Shows as: ₹18–25 LPA". Start each line of Responsibilities with "- " for
  bullet points, add an **Apply link** and choose **Post job**. Then, on its page, **Mark closed**: Apply (and any email
  or phone) gives way to "Applications closed", and How to apply goes too.
- **Bullet points and links** in long descriptions (jobs, events, businesses, funding and bios): open the Mumbai coffee
  meetup in **Events**, or Zylo Labs in **Businesses**. A line starting with "- " is a bullet, "1. " starts a numbered
  list, and web and email addresses become links. Posts, comments and chat stay plain text.
- **On the phone app** all of this works the same. While registering, Android's back button goes to the step before,
  and on an iPhone swiping back is off after the first step, so nothing typed is lost.

**Wave 2: connect one to one** (run `pnpm db:reset` first, so the demo data for these is fresh)

Demo University now has **Messages**, **Groups**, **Mentors** and **Businesses** too, and referral requests inside
**Jobs**. On a computer every section is in the menu on the left. On a phone, or a narrow window, the bar at the bottom
shows four sections and **More** holds the rest (Events, Groups, Mentors, Businesses and Funding), with your posts,
profile and sign out.

- **Messages, with two browsers.** This walks through a message request, live messages, a report and what an admin
  sees.
  1. In your normal browser window, sign in to Demo University as Priya (`+91 91000 00002`). In a private window, sign
     in as Sneha (`+91 91000 00006`), open **Messages** and then the **Requests** tab.
  2. As Priya, open **Directory**, search for "Sneha", open **Sneha Kulkarni** and choose **Message this member**. Write
     something and send it. A first message is a request: Priya's screen says **Request sent**, and she can't write
     more until Sneha accepts.
  3. As Sneha, watch the request appear under Requests, and a number appear on Messages, without reloading. Open it:
     Sneha can **Accept request**, **Decline request** (Priya is never told) or **Block member**. Choose **Accept
     request**.
  4. Write to each other. Each message shows up in the other window within a second or two.
  5. As Sneha, report one of Priya's messages: point at it (on a phone, tap it) and choose the flag beside it, **Report
     message**. Pick a reason and **Send report**. The dialog says admins will see this message and up to 10 around it,
     and nothing more.
  6. In a third window, or after signing out, sign in to Demo University as its admin (`+91 90000 00001`) and choose
     **Admin**. The dashboard has an **Open chat reports** tile. Open **Chat reports**: it shows who reported whom and
     why, but no messages. Another report is already there: Meera reported a threatening message from Arjun.
  7. Choose **View messages** on Sneha's report. You see the reported message and the few around it, and nothing else
     of their chat. Choose **Remove message** and confirm: it becomes "This message was removed" in both members'
     chats, and Priya is told. Then open **Audit log**: your view is recorded as `chat_report.view`, and the removal as
     `chat_report.resolve`. Leaving Chat reports hides the messages, so seeing them again means choosing View messages
     again, which is recorded too.

  Also try **Conversation options → Block member** in a chat: the other member isn't told, and nothing they send
  reaches you from then on. **Blocked members**, at the top of Messages, lists them and lets you unblock. Chat is text
  only, and pushes to a phone never show what a message says.
- **Groups.** Sign in as Arjun (`+91 91000 00003`), open **Groups** and, under **Discover**, open **London & UK alumni**
  and **Join group**: you see the whole conversation so far. **Create group** asks whether a group is open (anyone can
  find and join it) or invite-only (only people you invite see it, and they see messages from when they join), and
  that can't be changed later. As Rahul (`+91 91000 00001`), open his invite-only **Batch of 2012 reunion committee**
  chat, then **Group details** and **Invite members**, and search for the members to invite. They find the invitation
  under **Groups → Invitations**.
- **Mentors.** Sign in as Priya and open **Mentors**, then **Requests**: Riya Fernandes is waiting for an answer, with a
  note. **Accept request** opens a chat that starts with her note. **Find mentors** lists members who offer to mentor,
  with filters by area and how often they can meet, and **Be a mentor** is how you offer. As Rahul, Requests shows the
  mentorship he already has with Farhan Lobo, with **Open chat** and **End mentorship**.
- **Referrals.** Open **Jobs** and tick **Can refer**: Rahul's backend engineer job and Priya's product manager job take
  referral requests. As Arjun, open one and choose **Ask for a referral** with a short note. As Priya, **Jobs →
  Referrals** shows the requests waiting for her, and accepting one opens a chat. When you post a job, tick **I can
  refer people for this job** to offer the same.
- **Businesses.** Open **Businesses** to see what alumni run, search, or filter by category and city. Email and phone
  show only on a listing's own page. **Add a business** lists yours (up to five). Demo University's admin finds
  "Instant Visa Desk" under **Admin → Reports**, and Demo College's admin (`+91 90000 00002`) has "Joshi Automation
  Services" waiting under **Moderation**.
- **Schools and current pupils.**
  1. Sign in to **Demo School** as its admin (`+91 90000 00003`) and open **Admin → Settings**. Messaging, Groups and
     Mentorship are off, and the page says why: members can contact each other privately, and the school may still
     have pupils.
  2. Tick **Messaging** first (Mentorship needs it), then **Groups** and **Mentorship**, and **Save settings**.
  3. Sign in to Demo School as Aditya Reddy (`+91 91000 00021`), an alumnus: Messages is in the menu now, and Groups and
     Mentors too.
  4. Sign in to Demo School as Naina Sen (`+91 91000 00026`). Her batch is two years away, so she's still at school:
     she sees no Messages, Groups or Mentors, and Jobs has no Referrals, even though the school switched them all on.
- **Notification settings** (bell → **Settings**) now have **Messages** and **Mentorship and referrals**. Messages can
  be **In app** (the number on Messages alone) or **In app + push**; they never appear under the bell.
- **Deleting your account** (Profile) now explains that your messages stay in other people's chats, shown as from a
  "Deleted member", and that groups you own pass to the member who has been in them longest.
- **On the phone app** everything members do above works the same: Messages is a tab, and you tap a message to report
  it. The admin steps (Chat reports, Audit log, Settings, Reports and Moderation) are on the web only.

**Wave 1: grow and engage** (`pnpm db:reset` loads six months of demo history for these)
- **Celebrations.** Sign in as Rahul (`+91 91000 00001`): the feed shows today's birthday (Meera) and Rahul's own
  third anniversary of joining. Tap **Wish**; Meera sees them under the bell. Only the day and month are ever
  shown. Members can opt out in their profile.
- **Polls and announcements.** Vote in Priya's London meetup poll. The pinned announcement came from the admin;
  as Demo University's admin (`+91 90000 00001`) write a post, choose **Announce**, and tick **Also email it**.
  Email, WhatsApp and SMS are offered only when the institution's plan includes them; in this demo they're printed in
  the API terminal.
- **This week.** Every Monday morning members get a digest of popular posts, new jobs and upcoming events, in the app
  and by email if they have confirmed one (Profile → Email). To see it now, run `pnpm jobs:run digest demo-university
  --force` in a terminal, then open **This week** from the feed.
- **Notification settings** (bell → **Settings**): choose off, in-app, or in-app and push per kind of notification,
  and turn off the digest or announcement emails. Every email has an unsubscribe link.
- **Profile questions.** As an admin, open **Admin → Profile fields** and add a question (for example "Hostel" with
  choices). Choice questions can filter the directory; admin-only questions stay private.
- **Invitations.** **Admin → Invitations → Import a list** takes a CSV of phone numbers (download the template). Copy
  an invitation's link and open it in a private window: the invited alumnus signs in with that number and joins
  straight away, with their details filled in.
- **Analytics.** **Admin → Analytics** charts new and active members, activity per week, and who your members are,
  compared with the previous period. **Members CSV** and **Activity CSV** open in Excel or Google Sheets.
- **Staff: Compare** (`/platform/compare`) puts every institution side by side for a month, with messages sent and the
  estimated charge, and downloads it as CSV for chargeback. A plan's **Messaging included** section sets which
  channels an institution can use and their per-message rates.

**Live updates and background work**
- **The bell updates live.** Open the web app in two browsers (one in a private window) as two members of Demo
  University. When one reacts to or comments on the other's post, the other's bell count changes within a second, with
  no reload. The phone app gets the same live updates while it is open.
- Push notifications, and from now on invitations, announcements and digests, are delivered in the background, so
  actions in the app return immediately and temporary provider outages are retried.

**Fix pass after the first review** (web, iOS and Android)
- **Event times** are saved in the event's own time zone, whatever zone your laptop or phone is in. The phone app
  uses the native date and time pickers.
- **Every country** is in the phone-number and country pickers, and they can be searched (try "+44" or "kingdom").
  The US and Canada are now separate choices.
- **Edit what you posted**: posts on the web and the phone; jobs, funding listings and events on the phone.
- **Phones**: the admin and staff consoles fit on a phone screen; the web app has a **More** menu (My posts, Admin,
  Switch institution, Sign out); the phone app shows one header per screen and stays signed in when it starts
  offline.
- **Directory** on the phone filters by company and country too.
- **Push notifications** open the right post, event or listing in the right institution (needs a development
  build and an Expo project id, see `README.md`).
- **Billing**: usage counts the members active on any day of the period, in India time, and prorates the estimate
  when the period is not one billing cycle. Staff can edit or end a plan and add a note to an invoice snapshot.
- **Safer sign-in**: five wrong guesses use up the code instead of locking the number for everyone.
- Suspended members' posts disappear for other members, and only the author sees an admin's note on their post.

## 5. Good to know

- **Reset the demo data** with `pnpm db:reset` in a terminal. It wipes everything and reloads the sample institutions,
  members and posts.
- **Restart the app** with `pnpm demo` if you closed its terminal (on your own computer, it also starts the database
  containers if they're stopped).
- **Stop the codespace when you are done** (github.com/codespaces → … → Stop) so it does not use up your free hours.
  It also stops on its own after 30 minutes without activity, and your data is kept for next time.
- Making port 4000 public means anyone with that address can reach this demo API while the codespace is running. It
  only contains demo data.
- Real codes are sent over WhatsApp, with SMS as a fallback, once a WhatsApp Business account is connected (see
  `README.md`). The demo prints codes instead.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Codespaces is not available" | Codespaces must be enabled for the account or organisation that owns the repository. Personal accounts include free monthly hours. For an organisation, ask an owner to allow Codespaces. |
| Web tab shows "Blocked request" or a blank page | Wait until the terminal shows the demo box, then reload. Run `pnpm demo` if that terminal was closed. |
| Expo Go says the project needs a different SDK | Update Expo Go from the store. If it still does not match, use `pnpm mobile:web` for the browser preview. |
| Phone app shows "Could not reach the server" | Make port 4000 public (step 4.1), then restart `pnpm mobile:tunnel`. |
| Uploaded photos do not show | Same fix: make port 4000 public. |
| Phone app's bell or messages do not update live | Same fix: make port 4000 public. The web app's live updates go through the web port and need nothing. |
| Tunnel will not start | Stop it with Ctrl+C and run `pnpm mobile:tunnel` again; the tunnel service is occasionally busy. |
| No Messages, Groups or Mentors | At Demo School they start off until its admin turns them on (see "Schools and current pupils" above), and a pupil never sees them. At the other institutions, look in **Admin → Settings**: someone may have switched them off. |
| No seeded chats, groups, mentors or businesses | The demo data is older than Wave 2. Run `pnpm db:reset`. |
| No headlines or skills on profiles, or no pay on the seeded jobs | The demo data is older than richer profiles and job posts. Run `pnpm db:reset`. |
| No "Use details from …" when joining | It's offered only to a number that is already an approved member of another institution, on a first application (not when re-applying), and only when it would fill something in. |
| A profile still asks "Open to mentoring students" | That question is from the demo data before Mentors replaced it. Run `pnpm db:reset`. |
| "Too many codes requested" or "Too many requests" when signing in | Each number gets 5 codes an hour, and each computer 20 requests for a code. Wait, or run `pnpm db:reset`, which also clears these limits (and resets the demo data). |
