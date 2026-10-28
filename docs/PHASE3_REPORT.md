# Phase 3 report

Hi Brennan. Phase 3 is live. You merged [PR #6 "Phase 3"](https://github.com/BrennanLup/myescapes/pull/6) into `main` on 28 October, and Railway deployed it: the live site serves the new loading splash, `/daily/room` and `/api/presence` are there, and `/api/status` says `"database":"ready"`, so the new migration ran. (I only checked those public addresses; I didn't sign in on the live site.)

One more round of fixes is waiting for you in [PR #7 "Phase 3"](https://github.com/BrennanLup/myescapes/pull/7), from the same branch `claude/project-thread-plon5u` into `main`. It is open, not a draft, assigned to you, and GitHub says it merges cleanly. It holds QA round 4's fixes (see below). Nothing has been merged into `main` by me. When you merge it, Railway deploys it as usual.

The short version: all four workstreams from `docs/PHASE3_PLAN.md` are done and went through four rounds of automated QA, fixes and improvements. Rounds 1 to 3 went live with PR #6; round 4 is in PR #7. The full automated test suite passes on PR #7's head commit. What still hasn't happened is anything on a real phone, or multiplayer with two real Google accounts. The checklist for that is at the end.

## What's in Phase 3

### 1. A better review form, with photos (workstream A)

- **The whole form stays visible while you type.** One scrolling form with every section, on the laptop and the phone. On phones, the field you're typing in scrolls into view above the keyboard, and the Save bar drops into the page while the keyboard is open, so it never covers the field.
- **Photos while you write the review.** An "Add photos" control on both forms: photos are resized in the browser, show as thumbnails straight away, each has its own progress bar, can be removed, and gets Retry if the upload fails. Desktops can drop files on it. Photos picked before the visit exists wait in a queue and upload right after Save, even after the form closes. Limits match the server: images only, up to 40 MB originals, 30 per visit. A photo in its 5-second Undo window no longer counts towards the "N of 30".
- **Adding photos later.** The review overlay in the 3D room and the phone's room page both have a Photos card, for you and accepted crew. Removing an uploaded photo shows "Photo removed · Undo" for 5 seconds before it's really deleted. Tapping any thumbnail opens a full-size viewer (arrows, swipe, Esc).
- **Room search as you type.** The room field searches the directory (games and venues) using the shared room picker. Rooms in the draft's city come first, there's an "Add “…”" row for a new room, an opt-in **Near me** button (nearest first), and an "Is it X? Use it" suggestion when the name matches a directory game. The arrow keys and Enter now work properly in the list: the first ArrowDown lands on the first result, and Enter on "Add" adds. On the phone, "Not right? Change it" on the form does the same job.
- **No more duplicate venues or games.** Picking a game links the visit to it. Picking a directory *venue* now links to that venue too (the form says "At <venue> in <city>, from the room directory"), so saving adds the room there instead of creating a second copy of the venue. Without a pick, the server matches venues by name and city, prefers directory venues over ones people typed in, and doesn't link across countries on a bare city name.
- **Exact matches link themselves.** When the room name and city in your notes both match a directory game exactly, the form links it on its own and says so ("Same name and city as your notes, so it's linked. Not it? Press Change."). A name-only match stays a "Use it" suggestion, and if Company or City is then missing, the error points you at "Use it" instead of making you type them.
- **Friendlier form.** An unset score shows an empty "Tap to rate" track instead of a slider sitting at 50. Genre and the four features (timer, multiple rooms, flashlights, live actors) can be "Not sure" (and it's spelled that way now, not "Not Sure"). Errors only appear once you leave a field or press Save, and Save jumps to the first missing field.
- **Better for keyboards and screen readers.** The laptop form puts focus on its title when it opens, marks fields with errors properly for screen readers, and turns the "Check this" chips into one toolbar you move through with the arrow keys. On the phone form every input now has a real label, the Yes / No / Not sure answers are named groups, and those buttons are at least 44 px tall. The voice-note record overlay now moves focus into itself when it opens and hands it back when it closes, and Esc closes it even from the transcript box.

### 2. Your character, camera modes and the wardrobe (workstream B)

- **A character for you.** Low-poly, built in code from simple shapes (no downloaded model), with idle and walk animations and wave, cheer and dance emotes. Each look is merged into a few meshes at runtime, so a character costs about 12 draw calls.
- **Third person.** Press `V` (or the camera pill bottom right; the eye button on phones) to switch between first and third person. The camera follows smoothly, pulls in when a wall is in the way, and you can drag to orbit. Clicking and reach work in both modes. The choice is remembered per device. First person is still the default.
- **Backed against a wall** (fixed in rounds 3 and 4, the round 4 part is in PR #7). The camera used to end up inside your head, and then for a round it looked straight down on top of it. Now it rises only a little, slides over your shoulder (the other one if a wall is in the way) and keeps looking into the room, tilting at most 25 degrees down. Pressed flat to a wall, you get a short over-the-shoulder view of the room ahead.
- **The wardrobe.** A button bottom right opens it, with a live 3D preview: skin tone, hair, top, bottom, shoes, hat and an accessory, each with colours, plus "Surprise me" and "Undo". It's saved to your account. Since round 3:
  - unlocking an item always puts it on, in the same step, and the wardrobe stays open with a message saying so (and naming anything still locked in the look);
  - a "Wear what you own" button appears when your look has locked items you can't afford;
  - a dark "Wearing" tag marks what you have on today, separate from the teal "trying on" ring;
  - the small text and chips inside the wardrobe use darker colours that pass the contrast guideline, and colour swatches sit in even rows on phones.
- **Keys, with no real money.** Some items cost keys. You start with 20, get 10 for each room you log (or are tagged on and accept) and 5 for each Escape of the Day you solve. The server counts keys from your data instead of storing a balance, and refuses to let anyone wear an item they haven't bought. Deleting rooms after spending leaves you "owing" keys, and the wardrobe now says the next keys you earn pay that back first. There is no payment provider anywhere. The catalogue has 40 items, 22 free and the rest from 10 to 120 keys. Everyone starts with their own free starter look, so a room of friends doesn't look identical.
- **The "How to play" card** now lists the Phase 3 controls: `F` for people and `T` (or `Enter`) for chat when friends can be online, and the wardrobe button. On touch screens it has a small legend for the round buttons on the right.
- **Easier on phones** (PR #7). While a full-screen overlay is open (the review form, record, wardrobe, wish list, Wrapped and so on), the 3D room behind it stops redrawing and just keeps its last frame, then carries on when you close it. Settings is the exception, so quality changes still show behind it. Background blur is turned off on all touch screens, because blurring the live room is expensive.

### 3. Visiting friends, live (workstream C)

- **Visit a friend's room** at `/home/<their handle>`: their board and reviews, read-only, with you, them and any other visiting friends walking around together. Friends only. Strangers and unknown handles get a friendly page, and a block makes the room look like it doesn't exist. The loading screen says "Heading to Vera's room…".
- **See each other.** Other players are drawn as their own characters in their own (saved, owned) looks, with an @handle tag and chat bubbles. Press `T` or `Enter` to chat (never stored), and use wave, cheer and dance. Movement is smoothed, so friends glide rather than jump. When you emote, a small chip by the buttons says who saw it ("You waved · Mia sees it", or that nobody else is here).
- **Presence.** "Sam is in your room" and "Robin is home" toasts, a People panel (`F`) listing who's here and "Visit a friend" with online friends first (friends already with you aren't listed twice), online dots and a Visit link in the `/settings` friends list, and a "Friends online" card on the phone home (`/m`) with **Visit**. Rows read "In their room", or "In their room with 2 friends".
- **The words fit a visitor.** In a friend's room the empty board reads "Vera hasn't pinned any escapes yet!", the desk, wish list and trophy shelf say "Vera's desk (look only)" and so on, and their Wrapped stays closed (every card in it talks to its owner, "Your year"), with a toast explaining why.
- **You stay in charge of your room.** Visitors can't log rooms, edit your wish list or upload photos (the store and the server both refuse). As host you can "Ask to leave", which keeps that person out for 10 minutes. Since PR #7 it asks first, right under their row ("Ask Sam to leave? They can't come back for 10 minutes."), with Cancel as the safe default. Unfriending or blocking someone removes them within a minute, and their screen switches to "You can no longer visit Robin's room".
- **Spoilers stay hidden** in a friend's room unless you flip the Spoilers toggle on the visiting banner.
- **Sturdier connection.** A reconnect can no longer open a second socket, a flood of messages now just reconnects instead of looking like a kick, and if a friend changes their @handle while you're in their room, you stay in and your address bar follows the new handle. In PR #7: you are only "in" a home while its 3D room is on screen, so going from your room to `/daily/room` no longer shows your puzzle-room moves to friends in your home as if you were walking around there; coming back puts you in again.
- Under the hood: a websocket server at `/api/realtime` on the same Railway service, signed-in only, with rate limits, a 12-player cap per room and idle timeouts.

### 4. Escape of the Day as a room you walk around in (workstream D)

- **New page `/daily/room`.** Today's puzzle becomes a small 3D room: clue posters and a padlock box for combination days, a coded word above the door for cipher days, a lit panel for sequences, and keys hidden under cushions, books, pots and so on for search days. There's a chalkboard for guesses, a bell for hints and a lock display showing your last guess. Camera modes and your character work there too.
- **A cosier room.** The bare walls now have strings of bulbs, a coat rack with a hat and coat, a shelf of decoys (books, an hourglass, a spare padlock, a candle), a key cabinet, and a stopwatch clock labelled "YOUR TIME" whose hands follow your timer. None of it is clickable, and it costs about 7 extra draw calls.
- **Same game, same scores.** Hints, timer, streaks, the share grid and the leaderboard are exactly the 2D ones, saved through the same API. The lock panel's buttons and code fields now show a clear focus ring.
- **Walk home.** Solving (or running out of guesses) opens the door. Walking through it fades to "Welcome home…" and puts you inside your own room, a little to the side of the daily door (so the open door no longer squashes the third-person camera onto your back), with a welcome toast. Signed-out players land in the demo room with a "Continue with Google" button, and phones land on `/m` with the same welcome card.
- `/daily` stays as the light 2D version, now with a **Play in 3D** card, and the door in your room links to both. `/daily` and `/m` still never download the 3D engine.

### Smaller things

- **No more blank dark screen while the app loads.** The page now paints a loading splash (the door logo, "My Escapes" and a shimmer bar) before any script arrives, and the app's own loading screens use the same look, so it never jumps.
- If WebGL fails, the 3D room and the puzzle room show "The room couldn't light up" with Reload and the light version, instead of a blank page.
- The phone's "Saved!" screen shows "+10 keys" and your balance.
- `/daily` has a short "How it works".
- Better contrast on small key chips, captions and the teal links in the People panel.
- On `/m`, the footer links (View on desktop, About, Privacy, Terms, Sign out) are now proper 44 px tap targets.
- `/home/*` pages are hidden from search engines and never put the @handle in the page head.
- The data download (`/api/me/export`) includes your look and purchases.
- The privacy page is updated (see your to-dos).

## How to try it

PR #6 is already live at <https://bubbly-hope-production.up.railway.app>, so you can try most of this now. The steps marked *(PR #7)* need that PR merged and deployed first.

**On the laptop**

1. Sign in and open your 3D room. Press `V` to see yourself, walk around and drag to orbit. Back up against a wall and into a corner: you should still see the room ahead *(PR #7)*. Press `V` again to go back.
2. Click the hanger button bottom right to open the wardrobe. Try some looks and "Surprise me", unlock something with your keys (it goes on straight away), and save. Close it without saving after trying something on: it asks first.
3. Log a room from the board. In the form, type part of a room name and pick one from the list with the mouse or with ArrowDown and Enter (try Near me once; the browser asks for location only then). If your notes already have the exact name and city, it links itself *(PR #7)*. Add two photos, then Save. A toast reports the uploads, and you get "+10 keys".
4. Click the new polaroid. The review has a Photos card: add another, click a thumbnail to see it full size, use "Edit photos" to remove one, then press Undo.
5. Open the daily door in your room and choose **Play in 3D** (or go to `/daily/room`). Walk to the posters and props, ring the bell for a hint, write guesses on the chalkboard, solve it, and walk out through the door. You should arrive home with a welcome toast.

**On your phone**

1. Open the site; it goes to `/m` as before. Log a room with a voice note. On the form, check every section is there, use "Not right? Change it" if the room is wrong, add a few photos (remove one), and Save. The "Saved!" screen shows each upload and "+10 keys".
2. Open the room from your rooms list and add another photo there.
3. Open `/daily/room` on the phone and play with the joystick and Tap. Finishing takes you back to `/m` with the welcome card.
4. Open the 3D room with `?debug=1` on the end of the address, walk around in third person for half a minute, and look at the frame rate. Then open the wardrobe: the readout should say the room is paused behind it *(PR #7)*.

**With your girlfriend (or a second account)**

This needs two accounts that are friends, both with an @handle, and her Google address added as a test user (see to-dos).

1. Both open the 3D room on laptops (or one of you on a phone via the friend's Visit button on `/m`).
2. One of you presses `F` and picks the other under "Visit a friend", or opens `/home/<handle>`. The host should get "… is in your room".
3. Walk around and check you see each other's characters and name tags. Chat with `T`, wave and dance, then try "Back to my room".
4. As host, try "Ask to leave" from the People panel (with PR #7 it asks you to confirm first). The guest's room closes, and reloading keeps them out for 10 minutes.
5. Check `/settings` shows the online dot and "Visit room".

## What was verified, and how

Everything below ran on the build machine, against PR #7's head commit `61e4343`, with the local PGlite database, the test-only login and mocked transcription and extraction.

- **Unit and component tests:** `npm run check` (typecheck, lint, Vitest) passes: 149 test files, 1,724 tests (up from 1,255 at the end of Phase 2).
- **Production build:** `npm run build` passes.
- **End-to-end (Playwright):** the full suite passed with 45 passed, 0 failed, and 13 skipped by design (specs that only run in the laptop or phone project), in about 20 minutes. Phase 3 specs:
  - `review-form.spec.ts`: both forms, photos, the queue, Undo, the room search, keyboard picking, linking (including the automatic exact match) and focus on the title.
  - `character.spec.ts`: third person on laptop and phone, the camera against the wall, reach in third person, the wardrobe, buying an item (it goes on), locked items staying locked, the help card, and the room pausing behind the wardrobe.
  - `realtime-server.spec.ts`: two signed-in browsers meeting over the socket, plus a stranger being refused.
  - `multiplayer.spec.ts`: two friends in two browsers (one a phone) seeing each other move, chatting, waving, Back to my room, and visiting the other way.
  - `multiplayer-leave.spec.ts`: Ask to leave (cancel first, then confirm) closing the guest's room, and Friends online on `/m`.
  - `multiplayer-daily-room.spec.ts`: the host goes to the puzzle room and disappears from the guest's view, then comes back with Back.
  - `daily-room.spec.ts`: signed in and out, laptop and phone, solving and walking home with the streak saved, and a normal third-person view on arrival.
  - `boot-splash.spec.ts`: the loading splash shows with every script blocked, the app replaces it, and the phone footer links are at least 44 px.
- **Booting the production build:** with a local database, `/health` returns ok and every page returns 200, including `/daily/room` and `/home/<handle>`. The presence API returns 401 when signed out.
- **On the live site** (PR #6 only): the home page has the new splash, `/daily/room` returns 200, `/api/presence` returns 401 signed out, and `/api/status` reports the database ready.
- **Four rounds of scripted QA.** These walked through each feature on a laptop profile and a Pixel 7 profile, took screenshots and recorded problems, against a local test server. Each round's findings were fixed on their own branches and merged. The scripts, screenshots and raw results are in `qa/phase3/` (round 1), `qa/phase3/r2/`, `qa/phase3/r3/` and `qa/phase3/r4/`, with `results-r2.json` to `results-r4.json`. Bugs worth mentioning found this way: a race that threw away queued photos when the form closed on save, a client that could show priced items to other players without owning them, picking a directory venue creating a duplicate venue, spending keys on an item without it being put on, a reconnect that could open a second socket, and your puzzle-room moves being sent to friends in your home. All are fixed and tested.

The one earlier "flaky" test (the smoke test timing out) turned out to be the review-form spec leaving two browsers rendering in the background. It's fixed at the cause, not by loosening the test.

## Decisions I made without asking

The full list (139 lines, each with a reason) is at the end of `docs/PHASE3_PLAN.md`, with the bigger ones also in `DECISIONS.md`. The ones you're most likely to care about:

- **No real money.** Outfits cost in-game keys earned by playing. Nothing is wired to a payment provider until you choose one. Someone can still log fake rooms to earn keys; with self-reported logs that can't be prevented, and it only buys outfits.
- **The character is made in code**, not a downloaded 3D model: no licence questions, small, easy to recolour.
- **Visiting is friends-only and read-only.** Visitors see only reviews they could already see (no private reviews, no transcripts, and spoilers hidden unless they ask). Rooms are addressed by @handle. A friend's Wrapped stays closed rather than being reworded.
- **One server is enough for now.** Multiplayer runs on the same Railway service, with rooms kept in memory. Running more than one instance later would need a shared message bus and sticky sessions. Restarting the server forgets "Ask to leave" cool-downs, but everyone simply reconnects.
- **Chat is never stored.** At most 8 lines per 10 seconds and 200 characters per line, cleaned on the server.
- **A block or unfriend takes up to 60 seconds** to remove someone already in your room. The server re-checks every minute rather than changing the friends code.
- **The puzzle room is its own page** (`/daily/room`) rather than a mode of your room, so `/daily` and the phone app stay light. A failed day still opens the door, with the answer shown, so nobody gets stuck. Going there from your room is still a quick in-app hop; you simply leave your home's live session while you're away.
- **First person stays the default camera**, and the third-person choice is remembered per device. Against a wall, seeing the room ahead wins over seeing your own character.
- **Exact directory matches link themselves**, only when both the room name and the city match; anything less stays a one-click suggestion.
- **"Ask to leave" asks first** instead of offering Undo, because Undo would leave the guest in the room for a few more seconds.
- **Near me is opt-in each time**, rounded to about 1 km, and never stored.
- **"Not sure" is allowed** for genre and the four features. "Escaped?" stays a required yes/no on the laptop form, because the board, stamps and stats all treat it as yes/no.
- **Phones still ask "Which room was it?" before the form**, because that step auto-matches the voice note. The form then has its own room search to change it.
- **The loading splash shows on every page**, public ones included, because it appears before the app knows which page it's on.
- **Friends online on `/m`:** two branches each built a card for this, and I kept the one with **Join** and an e2e test.

## Not done, or only partly done

- **Nothing tried on a real phone.** The keyboard handling, the third-person camera and the frame rate were checked in desktop Chromium emulating a Pixel 7 (with software rendering, so its frame rates mean nothing), plus unit tests. Real iPhone and Android checks, and Firefox for Android, are still to do, especially whether the room pausing behind overlays helps with heat and battery.
- **Multiplayer not tried live.** Phase 3 is deployed, but nobody has yet met a friend through Railway's proxy with two real accounts.
- **The puzzle room doesn't pause behind its own panels.** Only your main room does (PR #7); some puzzles react in 3D while a panel is open.
- **Players walk through each other.** There's no collision between players.
- **A friend's wish list can't be viewed while visiting.** The wish list overlay belongs to the other team and can edit, so it stays closed.
- **No "hide my online status" setting.**
- **The wardrobe only opens from the HUD button.** There's no wardrobe or mirror object in the room (those files belong to the room visuals team), and no link that opens it straight from the phone.
- **In first person you have no body.** Looking down shows no feet or shadow.
- **Performance on laptops:** at High or Medium quality, third person adds about 50 draw calls because of shadows. Phones were the focus and use cheap blob shadows.
- **Old duplicate venues stay.** The fix stops new ones, but any that were created before it (for example from your own earlier logs) are left alone, because merging venues would touch other people's visits. (The duplicates the QA scripts made were in the local test database, not on the live site.) Also, picking a venue keeps the room name from your draft, so a misspelt name becomes a new room at the right venue; the form reminds you to check it.
- **After a friend changes their @handle,** reconnecting with the old address only works while someone is still in that room.
- **Small UI leftovers:**
  - the "How to play" card still fades after 8 seconds even though it's longer now (the `?` button brings it back);
  - the puzzle room's entry card: the QA script saw focus slip off the "Step inside" button in one path, which needs a look in the real 3D room;
  - the shared room picker doesn't cancel a short timer when it closes (harmless in the app; it belongs to the room-database team);
  - the record overlay's focus handling has unit tests but no end-to-end test.
- **Contrast:** white text on the app's teal and accent pills is about 3.9:1 and 3:1, below the accessibility guideline for small text. The wardrobe and People panel now use darker shades locally, but changing the app's palette is your call.
- **Left to other teams:** a black wedge on the floor at Low quality (room visuals).
- **QA script notes that look like script quirks.** The round 4 script still flagged a few things:
  - in the puzzle room, aiming at the lock in third person hovered nothing in the script, though the e2e test for the lock passes;
  - "the wardrobe did not close after unlock": that's now deliberate, it stays open and tells you what you put on;
  - "no 'Blake is in your room' notice within 10 seconds": the script's own log shows the toast had already appeared before it started waiting;
  - a 24 px camera badge on the phone, below the script's 32 px line.
- **Server photo limits are unchanged** (1 MB after resizing, JPEG/PNG/WebP). iPhone HEIC photos work only where the browser can decode them; otherwise the form asks for JPEG or PNG.

## Your to-dos

1. **Merge PR #7** (from `claude/project-thread-plon5u` into `main`) when you're happy. It only has QA round 4's fixes and no database changes. I haven't merged anything.
2. **Check the privacy page wording.** `public/privacy.html` (effective 28 October 2026, already live) says:
   - friends who visit can see your room and wish list (only reviews they could already see);
   - online status, position, look and chat are shared live and not stored;
   - Near me is opt-in, rounded to about 1 km and not stored.

   Adjust the wording if you like.
3. **The avatar migration is done.** `server/db/migrations/0002_avatars.sql` (two new tables, `avatars` and `avatar_purchases`) ran with PR #6's deploy, and `/api/status` says the database is ready. Nothing else to do.
4. **Try the laptop and phone steps above.** In particular: a real photo upload from your phone, the keyboard on the review form, `/daily/room` on the phone, and the frame rate with `?debug=1` on an Android phone and an iPhone (it should stay above about 40 fps, or switch itself to Low quality within about 10 seconds).
5. **Try multiplayer with a second real account.** Her Google address still needs adding as a test user in Google Cloud (project `myescapes`, Google Auth Platform, Audience), as in the Phase 2 report. If friends can't see each other but everything else works, the websocket isn't getting through Railway: tell me and I'll look.
6. **Keep the app on one Railway instance (replica).** That's the default. Multiplayer rooms live in memory, so a second replica would split friends across servers.
7. **Optional:**
   - tidy up any duplicate venues you spot in your own data;
   - decide on the pill colours (the contrast note above);
   - decide whether you want real payments for outfits one day (nothing is set up);
   - say if you'd like collisions between players or a "hide my online status" setting next.
