# Thamires on TikTok: developer app and review texts

App name: **Thamires Drop Studios** · TikTok account: Drop Studios' own account · Website: https://www.dropstudios.ie

## What Thamires will do on TikTok

- Prepare Drop's videos (class clips, promos, studio rental, events) and **send them to Drop's TikTok drafts** on a schedule.
- Write the caption and hashtags for each video and send them to the owner, who opens the draft, adds a trending sound and taps Post.
- After TikTok audits the app: publish directly, with the owner tapping "Post to TikTok" in Drop's admin page. TikTok requires a person to choose who can see each post.

What she **can't** do (TikTok limits, not ours):
- Reply to TikTok DMs. TikTok's messaging API isn't available to business accounts in the EU, Ireland included.
- Reply to or read comments. There's no public comments API for business accounts.

## Steps for the owner

1. Go to **developers.tiktok.com** and log in with **Drop's TikTok account**.
2. **Manage apps → Connect an app.**
3. Fill in:
   - App name: Thamires Drop Studios
   - Category: Business
   - Description: see "App description" below
   - Icon: the Drop logo (1024×1024 PNG)
   - Terms of Service URL: https://www.dropstudios.ie/terms
   - Privacy Policy URL: https://www.dropstudios.ie/privacy
   - Platform: **Web**, website https://www.dropstudios.ie
4. **Add products:** Login Kit and Content Posting API. Leave Direct Post off for now.
5. **Scopes:** `user.info.basic`, `video.upload`.
6. **Login Kit → Redirect URI:**
   `https://plskvdfcjdxkfiznguzo.supabase.co/functions/v1/thamires/tiktok/callback`
7. **Submit for review**, pasting the texts below. Attach the demo video (script below).
8. When approved, copy the **Client key** and **Client secret** into Supabase → Edge Functions → Secrets as
   `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. Never paste them in a chat or an email.
9. Tell Claude "TikTok approved". Claude builds and tests the connection, then adds **Connect TikTok** to Admin → Thamires.

## App description

Thamires is the social media assistant for Drop Studios, a dance and fitness studio in Dublin, Ireland. It is used only by Drop Studios staff with Drop Studios' own TikTok account. Staff choose short videos of Drop's classes and events in Drop's private admin page; the app uploads them to Drop's TikTok drafts, where a staff member adds a sound, checks the caption and posts it from the TikTok app. It does not serve any other business or account.

## Per scope

**user.info.basic:** We read the connected account's display name and avatar to show staff which TikTok account is connected in our admin page (it must be Drop Studios' own account).

**video.upload:** We upload Drop Studios' own videos (class highlights, studio promos and event announcements made by Drop) to the connected Drop Studios account as drafts. A staff member then finishes and posts each one in the TikTok app. Nothing is posted publicly by the app itself.

## Demo video script (1–2 minutes)

1. Open https://www.dropstudios.ie/login and sign in as the Drop admin. Show the address bar.
2. Go to Admin → Thamires → TikTok. Click **Connect TikTok**, log in to the Drop Studios TikTok account and approve the permissions.
3. Pick a video, click **Send to TikTok drafts**.
4. On a phone, open TikTok → Inbox and show the draft notification; open it, add a sound and post (or save as a draft).

(The Connect button and TikTok tab are built after the app is created, so the demo is recorded then. TikTok usually allows submitting the review with a recording made in their sandbox.)
