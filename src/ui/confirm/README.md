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
