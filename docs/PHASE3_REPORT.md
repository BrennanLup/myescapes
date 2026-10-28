# Phase 3 report

Hi Brennan. Phase 3 is built and waiting for you in one pull request: [PR #6 "Phase 3"](https://github.com/BrennanLup/myescapes/pull/6), from the branch `claude/project-thread-plon5u` into `main`. It is open, not a draft, GitHub says it merges cleanly, and it already contains everything on `main` (the Rooms to try picker, the `/reviews` feed, the room crawler and the bigger directory). Nothing has been merged into `main` and nothing has been deployed, so the live site still runs Phase 2. When you merge, Railway deploys it as usual.

The short version: all four workstreams from `docs/PHASE3_PLAN.md` are done, then went through two rounds of automated QA, fixes and improvements. The full automated test suite passes on the PR's head commit. What hasn't happened yet is anything on the live site or on a real phone, because that needs the merge (and, for multiplayer, two real Google accounts). The checklist for that is at the end.

## What's in the PR

### 1. A better review form, with photos (workstream A)

- **The whole form stays visible while you type.** One scrolling form with every section, on the laptop and the phone. On phones, the field you're typing in scrolls into view above the keyboard, and the Save bar drops into the page while the keyboard is open, so it never covers the field.
- **Photos while you write the review.** An "Add photos" control on both forms: photos are resized in the browser, show as thumbnails straight away, each has its own progress bar, can be removed, and gets Retry if the upload fails. Desktops can drop files on it. Photos picked before the visit exists wait in a queue and upload right after Save, even after the form closes. Limits match the server: images only, up to 40 MB originals, 30 per visit.
- **Adding photos later.** The review overlay in the 3D room and the phone's room page both have a Photos card, for you and accepted crew. Removing an uploaded photo shows "Photo removed · Undo" for 5 seconds before it's really deleted. Tapping any thumbnail opens a full-size viewer (arrows, swipe, Esc).
- **Room search as you type.** The room field searches the directory (games and venues) using the shared room picker from `main`. Rooms in the draft's city come first, there's an "Add “…”" row for a new room, an opt-in **Near me** button (nearest first), and an "Is it X? Use it" suggestion when the name matches a directory game. Picking a game links the visit to it, so no duplicate venue or game gets created. On the phone, "Not right? Change it" on the form does the same.
- **Friendlier form.** An unset score shows an empty "Tap to rate" track instead of a slider sitting at 50. Genre and the four features (timer, multiple rooms, flashlights, live actors) can be "Not sure". Errors only appear once you leave a field or press Save, and Save jumps to the first missing field.

### 2. Your character, camera modes and the wardrobe (workstream B)

- **A character for you.** Low-poly, built in code from simple shapes (no downloaded model), with idle and walk animations and wave, cheer and dance emotes. Each look is merged into a few meshes at runtime, so a character costs about 12 draw calls.
- **Third person.** Press `V` (or the camera pill bottom right; the eye button on phones) to switch between first and third person. The camera follows smoothly, pulls in when a wall is in the way, and you can drag to orbit. Clicking and reach work in both modes. The choice is remembered per device. First person is still the default.
- **The wardrobe.** A button bottom right opens it, with a live 3D preview: skin tone, hair, top, bottom, shoes, hat and an accessory, each with colours, plus "Surprise me" and "Undo". It's saved to your account.
- **Keys, with no real money.** Some items cost keys. You start with 20, get 10 for each room you log (or are tagged on and accept) and 5 for each Escape of the Day you solve. The server counts keys from your data instead of storing a balance, and refuses to let anyone wear an item they haven't bought. There is no payment provider anywhere. The catalogue has 40 items, 22 free and the rest from 10 to 120 keys. Everyone starts with their own free starter look, so a room of friends doesn't look identical.

### 3. Visiting friends, live (workstream C)

- **Visit a friend's room** at `/home/<their handle>`: their board and reviews, read-only, with you, them and any other visiting friends walking around together. Friends only. Strangers and unknown handles get a friendly page, and a block makes the room look like it doesn't exist.
- **See each other.** Other players are drawn as their own characters in their own (saved, owned) looks, with an @handle tag and chat bubbles. Press `T` or `Enter` to chat (never stored), and use wave, cheer and dance. Movement is smoothed, so friends glide rather than jump.
- **Presence.** "Sam is in your room" and "Robin is home" toasts, a People panel (`F`) listing who's here and "Visit a friend" with online friends first, online dots and a Visit link in the `/settings` friends list, and a "Friends online" card on the phone home (`/m`) with **Visit**.
- **You stay in charge of your room.** Visitors can't log rooms, edit your wish list or upload photos (the store and the server both refuse). As host you can "Ask to leave", which keeps that person out for 10 minutes. Unfriending or blocking someone removes them within a minute, and their screen switches to "You can no longer visit Robin's room".
- **Spoilers stay hidden** in a friend's room unless you flip the Spoilers toggle on the visiting banner.
- Under the hood: a websocket server at `/api/realtime` on the same Railway service, signed-in only, with rate limits, a 12-player cap per room and idle timeouts.

### 4. Escape of the Day as a room you walk around in (workstream D)

- **New page `/daily/room`.** Today's puzzle becomes a small 3D room: clue posters and a padlock box for combination days, a coded word above the door for cipher days, a lit panel for sequences, and keys hidden under cushions, books, pots and so on for search days. There's a chalkboard for guesses, a bell for hints and a lock display showing your last guess. Camera modes and your character work there too.
- **Same game, same scores.** Hints, timer, streaks, the share grid and the leaderboard are exactly the 2D ones, saved through the same API.
- **Walk home.** Solving (or running out of guesses) opens the door. Walking through it fades to "Welcome home…" and puts you just inside your own room's daily door, with a welcome toast. Signed-out players land in the demo room with a "Continue with Google" button, and phones land on `/m` with the same welcome card.
- `/daily` stays as the light 2D version, now with a **Play in 3D** card, and the door in your room links to both. `/daily` and `/m` still never download the 3D engine.

### Smaller things

- If WebGL fails, the 3D room and the puzzle room now show "The room couldn't light up" with Reload and the light version, instead of a blank page.
- The phone's "Saved!" screen shows "+10 keys" and your balance.
- `/daily` has a short "How it works".
- Better contrast on small key chips and captions.
- `/home/*` pages are hidden from search engines and never put the @handle in the page head.
- The data download (`/api/me/export`) now includes your look and purchases.
- The privacy page is updated (see your to-dos).

## How to try it after merging

Each push to `main` deploys to <https://bubbly-hope-production.up.railway.app>. Give the deploy a few minutes, then:

**On the laptop**

1. Sign in and open your 3D room. Press `V` to see yourself, walk around and drag to orbit. Press `V` again to go back.
2. Click the hanger button bottom right to open the wardrobe. Try some looks and "Surprise me", unlock something with your keys, and save. Close it without saving after trying something on: it asks first.
3. Log a room from the board. In the form, type part of a room name and pick one from the list (try Near me once; the browser asks for location only then). Add two photos, then Save. A toast reports the uploads, and you get "+10 keys".
4. Click the new polaroid. The review has a Photos card: add another, click a thumbnail to see it full size, use "Edit photos" to remove one, then press Undo.
5. Open the daily door in your room and choose **Play in 3D** (or go to `/daily/room`). Walk to the posters and props, ring the bell for a hint, write guesses on the chalkboard, solve it, and walk out through the door. You should arrive home with a welcome toast.

**On your phone**

1. Open the site; it goes to `/m` as before. Log a room with a voice note. On the form, check every section is there, use "Not right? Change it" if the room is wrong, add a few photos (remove one), and Save. The "Saved!" screen shows each upload and "+10 keys".
2. Open the room from your rooms list and add another photo there.
3. Open `/daily/room` on the phone and play with the joystick and Tap. Finishing takes you back to `/m` with the welcome card.

**With your girlfriend (or a second account)**

This needs two accounts that are friends, both with an @handle, and her Google address added as a test user (see to-dos).

1. Both open the 3D room on laptops (or one of you on a phone via the friend's Visit button on `/m`).
2. One of you presses `F` and picks the other under "Visit a friend", or opens `/home/<handle>`. The host should get "… is in your room".
3. Walk around and check you see each other's characters and name tags. Chat with `T`, wave and dance, then try "Back to my room".
4. As host, try "Ask to leave" from the People panel. The guest's room closes, and reloading keeps them out for 10 minutes.
5. Check `/settings` shows the online dot and "Visit room".

## What was verified, and how

Everything below ran on the build machine, against the PR's head commit `d571c84`, with the local PGlite database, the test-only login and mocked transcription and extraction. Nothing has been checked on the live site, because Phase 3 isn't deployed yet.

- **Unit and component tests:** `npm run check` (typecheck, lint, Vitest) passes: 143 test files, 1,642 tests (up from 1,255 at the end of Phase 2). I re-ran it myself on the head commit while writing this report, and it passed.
- **Production build:** `npm run build` passes.
- **End-to-end (Playwright):** the full suite passed with 39 passed, 0 failed, and 11 skipped by design (specs that only run in the laptop or phone project), in 23 minutes. New Phase 3 specs:
  - `review-form.spec.ts`: both forms, photos, the queue, Undo, the room search and linking.
  - `character.spec.ts`: third person on laptop and phone, reach in third person, the wardrobe, buying an item, locked items staying locked.
  - `realtime-server.spec.ts`: two signed-in browsers meeting over the socket, plus a stranger being refused.
  - `multiplayer.spec.ts`: two friends in two browsers (one a phone) seeing each other move, chatting, waving, Back to my room, and visiting the other way.
  - `multiplayer-leave.spec.ts`: Ask to leave closing the guest's room, and Friends online on `/m`.
  - `daily-room.spec.ts`: signed in and out, laptop and phone, solving and walking home with the streak saved.
- **Booting the production build:** with a local database, `/health` returns ok, the migration applied, and every page returns 200, including `/daily/room` and `/home/<handle>`. The realtime and presence APIs return 401 when signed out.
- **Two rounds of scripted QA.** These walked through each feature on a laptop profile and a Pixel 7 profile, took screenshots and recorded problems. Each round's findings were fixed on their own branches and merged. The scripts, screenshots and raw results are in `qa/phase3/` (round 1) and `qa/phase3/r2/` with `qa/phase3/results-r2.json` (round 2). Two bugs worth mentioning were found this way: a race that threw away queued photos when the 3D room's form closed on save, and a client that could show priced items to other players without owning them. Both are fixed and tested.

The one earlier "flaky" test (the smoke test timing out) turned out to be the review-form spec leaving two browsers rendering in the background. It's fixed at the cause, not by loosening the test.

## Decisions I made without asking

The full list (about 80 lines, each with a reason) is at the end of `docs/PHASE3_PLAN.md`, with the bigger ones also in `DECISIONS.md`. The ones you're most likely to care about:

- **No real money.** Outfits cost in-game keys earned by playing. Nothing is wired to a payment provider until you choose one.
- **The character is made in code**, not a downloaded 3D model: no licence questions, small, easy to recolour.
- **Visiting is friends-only and read-only.** Visitors see only reviews they could already see (no private reviews, no transcripts, and spoilers hidden unless they ask). Rooms are addressed by @handle.
- **One server is enough for now.** Multiplayer runs on the same Railway service, with rooms kept in memory. Running more than one instance later would need a shared message bus and sticky sessions. Restarting the server forgets "Ask to leave" cool-downs, but everyone simply reconnects.
- **Chat is never stored.** At most 8 lines per 10 seconds and 200 characters per line, cleaned on the server.
- **A block or unfriend takes up to 60 seconds** to remove someone already in your room. The server re-checks every minute rather than changing the friends code.
- **The puzzle room is its own page** (`/daily/room`) rather than a mode of your room, so `/daily` and the phone app stay light. A failed day still opens the door, with the answer shown, so nobody gets stuck.
- **First person stays the default camera**, and the third-person choice is remembered per device.
- **Near me is opt-in each time**, rounded to about 1 km, and never stored.
- **"Not sure" is allowed** for genre and the four features. "Escaped?" stays a required yes/no on the laptop form, because the board, stamps and stats all treat it as yes/no.
- **Phones still ask "Which room was it?" before the form**, because that step auto-matches the voice note. The form then has its own room search to change it.
- **Friends online on `/m`:** two branches each built a card for this, and I kept the one with **Join** and an e2e test.

## Not done, or only partly done

- **Nothing tried on a real phone.** The keyboard handling, the third-person framing and the puzzle room's frame rate were checked in desktop Chromium emulating a Pixel 7, plus unit tests. Real iPhone and Android checks, and Firefox for Android, are still to do.
- **Nothing tried live.** Most importantly, this will be the first time a websocket goes through Railway's proxy, and the first time the new migration runs on the real database.
- **Players walk through each other.** There's no collision between players.
- **A friend's wish list can't be viewed while visiting.** The wish list overlay belongs to the other team and can edit, so it stays closed.
- **No "hide my online status" setting.**
- **The wardrobe only opens from the HUD button.** There's no wardrobe or mirror object in the room (those files belong to the room visuals team), and no link that opens it straight from the phone.
- **In first person you have no body.** Looking down shows no feet or shadow.
- **Performance on laptops:** at High or Medium quality, third person adds about 50 draw calls because of shadows. Phones were the focus and use cheap blob shadows.
- **Small UI leftovers:**
  - `F` and `T` aren't in the "How to play" card, though the buttons show them.
  - While the 5-second photo Undo is showing, "N of 30" still counts the removed photo.
  - Your faded character (40% when it's in the way) can show its arms through its body.
- **Contrast:** white text on the teal and accent pills is about 3.9:1 and 3:1, below the accessibility guideline for small text. Fixing that means changing the app's palette, so it's your call.
- **Left to other teams:** a black wedge on the floor at Low quality (room visuals). The room picker's own keyboard handling also belongs to them: the last QA script noted that ArrowDown + Enter in the laptop room search didn't pick a result.
- **Last QA notes not re-checked after the final fixes.** The round 2 script also noted these, against the code before the round 2 fixes:
  - in third person, aiming at the door or the puzzle room's lock from about 2.4 m hovered nothing in the script;
  - the wardrobe stays open after an unlock;
  - the "… is in your room" toast didn't appear within the script's 2.5 seconds;
  - a small 24 px badge in the phone room.

  The e2e specs above (door and lock interaction in third person, the arrival toast) pass, so these may be quirks of the script's aiming and timing, but nobody has re-checked them since.
- **Server photo limits are unchanged** (1 MB after resizing, JPEG/PNG/WebP). iPhone HEIC photos work only where the browser can decode them; otherwise the form asks for JPEG or PNG.

## Your to-dos

1. **Read the privacy page changes before merging.** `public/privacy.html` (effective 28 October 2026) now says:
   - friends who visit can see your room and wish list (only reviews they could already see);
   - online status, position, look and chat are shared live and not stored;
   - Near me is opt-in, rounded to about 1 km and not stored.

   The old line "Your room, wish list and streak: You" would have become untrue. Adjust the wording if you like.
2. **Merge PR #6** (from `claude/project-thread-plon5u` into `main`) when you're happy. I haven't merged anything.
3. **The database migration runs on deploy.** `server/db/migrations/0002_avatars.sql` adds two new tables, `avatars` (your saved look) and `avatar_purchases`. It only adds tables, changes nothing that exists, and runs automatically as Railway's pre-deploy step (`npm run db:migrate`, under a lock). After the deploy, check `/api/status` says `"database":"ready"`. A rollback leaves those two tables in place, which is harmless. Turning on Railway Postgres backups before this deploy would be sensible, if you haven't yet.
4. **After the deploy, try the laptop and phone steps above.** In particular: a real photo upload from your phone, the keyboard on the review form, and `/daily/room` on the phone.
5. **Try multiplayer with a second real account.** Her Google address still needs adding as a test user in Google Cloud (project `myescapes`, Google Auth Platform, Audience), as in the Phase 2 report. If friends can't see each other but everything else works, the websocket isn't getting through Railway: tell me and I'll look.
6. **Keep the app on one Railway instance (replica).** That's the default. Multiplayer rooms live in memory, so a second replica would split friends across servers.
7. **Optional:**
   - decide on the pill colours (the contrast note above);
   - decide whether you want real payments for outfits one day (nothing is set up);
   - say if you'd like collisions between players or a "hide my online status" setting next.
