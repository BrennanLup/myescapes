# Review Viewer UI (workstream 10)

`ReviewOverlay({ roomId })` — the scrapbook-style overlay shown when a polaroid on the board is clicked
(`bus.emit('review:open', { roomId })` -> `store.overlay = { kind: 'review', roomId }`, mounted by `App.tsx`).

Reads `rooms`, `reviews` and `boardPins` from the store and shows the room's latest review (`latestReviewFor`).

## Sections
- Header: genre chip (`GENRE_COLORS`), date, room name (font-display), company + city, crew initial avatars,
  website link (http(s) only) and a Google Maps link for the address, an "ESCAPED! 52 min" / "Trapped" stamp,
  and a sticky-note "crew verdict" with the overall score and comment.
- Polaroid gallery of room + review photos (deduped by URL): prev/next buttons, swipe, counter.
  No photos -> a genre-coloured placeholder card with a doodle per genre.
- Ratings: five animated 1-100 bars (`role="meter"`) with the comment beneath.
- Yes/no badges: escaped (with time), visible timer, multi-room, flashlights, live actors.
- Puzzles (type chip from `PUZZLE_TYPE_COLORS`, filled star when memorable), tools as chips.
- Collapsible "Voice note" (`<details>`) with the transcript on lined paper in the handwriting font.
- No review -> room info + "No review yet" card. Unknown room id -> "Room not found".

## Interaction
- Esc, the close button or a backdrop click emit `overlay:close`.
- Left/Right arrows and the toolbar buttons emit `review:open` for the previous/next room in board order
  (`boardPins` sorted by `order`, unpinned rooms appended; falls back to the `rooms` order). Wraps around.
- `role="dialog"`, `aria-modal`, `aria-labelledby` the room name; focus moves into the dialog on open,
  Tab is trapped, focus is restored on close.
- `sfx { name: 'paper' }` on open and on each page flip.
- Mobile: bottom sheet (94dvh) with an internal scroller; desktop (>=640px): centred card, max 900px wide.

## Files
`ReviewOverlay.tsx` (shell, header, keyboard), `sections.tsx` (ratings, badges, puzzles, tools, voice note),
`Gallery.tsx`, `icons.tsx` (inline SVG icons), `helpers.ts` (board order, formatting), `ReviewOverlay.test.tsx`.

## Simplifications
- Keyframes are injected with a small `<style>` tag inside the overlay (no edits to shared CSS).
- No backdrop blur, to keep the WebGL canvas behind cheap to composite on mobile.

## Photos (Phase 3, workstream A)
- Signed in (`dataSource === 'postgres'`, where a review id is the visit id), the overlay has a **Photos** card (`VisitPhotos.tsx`) under the puzzles: it loads the visit (`ROUTES.visit`) for its photos with uploader ids, and renders `PhotoAttach` so you can add photos (resized in the browser, progress, Retry) and remove your own. Uploads started from the confirm form show here too, including failed ones with Retry. Someone only tagged (pending) sees "Accept the tag on this visit to add photos." Hidden in the signed-out demo.
- `photoSync.ts` keeps the store in step: a finished upload is added to that review's `photos` (gallery and polaroid update without a reload) and a removed photo is taken out.
- The focus trap now includes inputs (the file picker).
- Tests: `VisitPhotos.test.tsx`.
