# Try Illuminize

The quickest way to try Illuminize is a **GitHub Codespace**: a cloud workspace that runs the database, the API and the
web app for you. You need nothing installed except a browser (and the free **Expo Go** app if you want the phone app).

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
| Member of Demo University | `+91 91000 00001` (Rahul Mehta) | The full member app with posts, jobs, funding, events and directory |
| Admin of Demo University | `+91 90000 00001` | Members and posts are approved automatically |
| Admin of Demo College | `+91 90000 00002` | Approval is required for members **and** posts; pending items and a spam report are waiting |
| Admin of Demo School | `+91 90000 00003` | Members need approval, posts publish immediately |
| Illuminize staff | `+91 99999 99999` | The platform console at `/platform` |

The phone field has a country picker. Choose **IN +91**, then type the 10 digits.

## 3. Things to try

**As a new alumnus**
1. On the first screen, pick **Demo University** and sign in with any new number.
2. Fill in your profile: batch, profession, company, city, plus the optional details.
3. Post in the community feed, react and comment on others' posts.
4. Open **Jobs** and post an opening, or switch to **Looking for work** and mark yourself as open to work.
5. Open **Events** and RSVP to the Mumbai coffee meetup, or plan your own gathering.
6. Search the **Directory** by batch, city or company.
7. Sign out, pick **Demo College**, register again with a new number, and see the "awaiting approval" screen.

**As an institution admin** (sign in to Demo College with `+91 90000 00002`, then click **Admin**)
1. **Members**: approve or reject the pending alumni, with a reason they will see.
2. **Moderation**: approve or reject pending posts, the internship and the Toronto dinner.
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

**Wave 1: grow and engage** (`pnpm db:reset` loads six months of demo history for these)
- **Celebrations.** Sign in as Rahul (`+91 91000 00001`): the feed opens with today's birthday (Meera) and Rahul's own
  third anniversary of joining. Tap **Send wishes**; Meera sees them under the bell. Only the day and month are ever
  shown. Members can opt out in their profile.
- **Polls and announcements.** Vote in Priya's London meetup poll. The pinned 📣 announcement came from the admin;
  as Demo University's admin (`+91 90000 00001`) write a post, choose **📣 Announcement**, and tick **Also email it**.
  Email, WhatsApp and SMS are offered only when the institution's plan includes them; in this demo they're printed in
  the API terminal.
- **This week.** Every Monday morning members get a digest of popular posts, new jobs and upcoming events, in the app
  and by email if they have confirmed one (Profile → Email). To see it now, run `pnpm jobs:run digest demo-university
  --force` in a terminal, then open **This week** from the feed.
- **Notification settings** (bell → ⚙️ Settings): choose off, in-app, or in-app and push per kind of notification,
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
- Push notifications, and from now on invites, digests and reminders, are delivered in the background, so actions in
  the app return immediately and temporary provider outages are retried.

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
- **Restart the app** with `pnpm demo` if you closed its terminal.
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
| Phone app's bell does not update live | Same fix: make port 4000 public. The web app's live updates go through the web port and need nothing. |
| Tunnel will not start | Stop it with Ctrl+C and run `pnpm mobile:tunnel` again; the tunnel service is occasionally busy. |
