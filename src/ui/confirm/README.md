# Confirm screen (workstream 13)

`ConfirmOverlay({ draft })` opens when the store overlay is `{ kind: 'confirm', draft }`. The bridge sets that overlay on `draft:ready`. It shows the extractor's `ReviewDraft` as an editable form. Nothing is saved until the user presses **Save & pin**.

## Files
- `ConfirmOverlay.tsx`: the overlay UI. Two columns at 1024px and wider, one scrollable column below that.
- `form.ts`: the pure logic. `draftToForm`, `validateForm`, `draftToEntry(form, existingRooms)`, `findExistingRoom`, `labelFor`, `shiftPuzzleFlags`.
- `toast.ts`: shows "Pinned to the board!" through the shell's toast slot (`useShell().showToast`), which the HUD renders outside the overlay, so it outlives the overlay that unmounts as soon as the save goes through.
- Draft-level flags (currently `extraction.fallback`) are not fields: `draftToForm` turns them into `notes`, shown as a small info note at the top (`confirm-draft-note`). Only `room.*` / `review.*` paths become "Check this" chips.
- The footer's "Still needed: ..." line has a "Show me" button (`confirm-next-missing`) that scrolls to and focuses the first missing required field (handy for fields the mock extractor leaves empty).
- `sampleDraft.ts`: a sample draft with some nulls and flags, used by the tests.

## Behaviour
- The header badge shows the extractor mode: "Extracted by Claude" or "Mock extractor (no API key)".
- Fields listed in `draft.flags` get a warn highlight and a "Check this" tag. The summary at the top ("N fields need a look") has jump links and a ✓ to dismiss a flag. Editing a field clears its flag. When a puzzle is removed, flags on the puzzles after it move with them. A missing date defaults to today and stays flagged.
- These fields are required: room name, company, city, genre, date, escaped, all 5 rating scores, and the 4 yes/no features. Each yes/no feature starts unset until the user picks one. A puzzle that has a description also needs a type. Puzzles with no description are dropped. Escape time is optional, from 0 to 600 minutes.
- The Save button stays disabled until the form is valid, and the footer says what is still missing. Errors also appear inline under each field.
- `draftToEntry` uses `makeId('room' | 'rev' | 'pz')`, sets each puzzle's `reviewId`, and returns `EntrySchema.parse(...)`. If an existing room has the same name, company and city (case-insensitive), the form reuses that room as a revisit. It fills in the address or website only if the existing room has them blank. The form also shows a "Revisit!" note in that case.
- Save calls `await useStore.getState().addEntry(entry)`. While it runs, the button reads "Saving…". If it fails, the error appears inline and the form stays as it was. If it succeeds, the store emits `entry:saved`, the bridge closes the overlay and the toast appears.
- Cancel, the × button and Esc all ask "Discard this review?" before emitting `overlay:close`. The Esc listener runs on window in the capture phase.
- Test ids: `confirm-save`, `confirm-cancel`, and `field-<dotted.path>` on each field. Some fields need a note:
  - Yes/no groups carry `-yes` and `-no` on their buttons.
  - Rating sliders are `field-review.ratings.<k>.score-slider`. The number input is `field-review.ratings.<k>.score`.
  - The chip inputs are `field-review.crew` and `field-review.toolsUsed`.

## Simplifications
- The crew and tools pickers use chips with a native `<datalist>` plus suggestion buttons, not a custom combobox.
- A rating slider with no value sits at 50, dimmed, until the user touches it or types a number.

## Phase 3 (workstream A): one page, room search, photos
- **All questions on one page.** Every section (Room, Visit, Outcome & features, Tools, Ratings, Puzzles, Photos, Transcript) is always rendered; nothing collapses to the focused field and there is no step wizard. `keyboard.ts` handles phone keyboards: `useRevealFocusedField(scrollRef)` scrolls a focused field to the middle of what is still visible once the keyboard has opened, and `useKeyboardInset()` (from `window.visualViewport`) adds that much bottom padding to the scroller so the last fields can be scrolled above the keyboard. The phone log flow (`src/mobile/log/confirm.tsx`) uses the same file and drops its sticky Save bar into the page flow while the keyboard is up.
- **Room search** (`RoomSearch.tsx`, built on the shared `src/ui/roompicker`): search-as-you-type over the directory's games and venues, an "Add “…”" row when nothing fits, and an opt-in **Near me** toggle (`near.ts`) that sorts nearest first. Near me asks the browser for the position only when pressed, rounds it to 2 decimals (about 1 km), sends it only as the search's `lat`/`lng`, and remembers just on/off (`localStorage` `myescapes.nearMe`). `suggestFor` looks the draft's room name up once and offers "Is it …? Use it" when the directory has it exactly (same city first, `exactGameMatch`).
  - Picking a game fills name, company, city and genre (`linkGame`), clears those "Check this" flags, then fills the address from the venue page (best effort), and shows a "From the room directory" card with **Change**. `form.link` remembers the game; editing the name, company or city unlinks it (`linkMatches`). `draftToEntry` then uses the game id as `room.id`, and `saveEntryForUser` (server/db/dataset.ts) saves the visit against that game instead of matching by name, so no duplicate venue or game is created.
  - Picking a venue fills company, city and address (`linkVenue`) and focuses the room name; "Add" names a new room (`newRoomNamed`) and focuses the next empty field.
  - Escape on an open result list closes the list only; the next Escape asks to discard.
- **Photos while reviewing**: a Photos section with `PhotoAttach` (`src/ui/photos`). Photos are resized and shown at once under a draft key; after **Save & pin** they move to the saved visit and upload one by one (`attachToVisit`) while the overlay closes. `photosAfterSave.ts` follows them and toasts "N photos added to …" or "N photos didn't upload. Open … on the board to retry"; the review overlay then shows the failed ones with Retry. Closing without saving drops them. Signed-out demo: the section says "Sign in to add photos".
- Test ids: `confirm-room-search`, `room-search-suggestion`, `room-search-near`, `confirm-room-linked`, `confirm-room-unlink`, `confirm-photos`, `confirm-scroll`.
- Tests: `ConfirmOverlay.phase3.test.tsx`, `helpers.phase3.test.tsx`, `e2e/review-form.spec.ts`.
