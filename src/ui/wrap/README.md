# Year in Escape Rooms (`src/ui/wrap`)

Workstream 18. A "Spotify Wrapped"-style recap of the crew's escape-room year, plus the
trophy shelf on the west wall that opens it.

## Exports (`index.tsx`)
- `WrapTrophy`: 3D, mounted at `ANCHORS.wrapTrophy`. Wall shelf with a plum felt backboard,
  three low-poly brass/gold trophies (a star, a big cup, a small cup), a medal on a ribbon and a
  wall calendar showing the current month and year. The calendar circles the days the crew
  played this month, plus Saturdays until 3 days are circled. Interactable `{ id: 'wrap:trophy',
  kind: 'wrap', label: 'Your year in escape rooms', event: wrap:open }`. The brass gets a warm
  emissive glow while `hoveredId === 'wrap:trophy'`. One AABB collider (`wrap:shelf`) covers the
  shelf.
- `WrapOverlay`: DOM overlay. Cards: intro, rooms done, best room (photo or genre placeholder),
  fastest escape (+ streak), favourite puzzle type (+ most memorable puzzle), cities, crew MVP,
  summary grid (+ genre breakdown). With no data for the period it shows intro + an empty-state
  card. Year selector lists each year and "All time". It defaults to the most recent year that has
  data.
  - Navigation: `wrap-prev` / `wrap-next` buttons, Left/Right arrow keys, swipe, or tap the
    left/right half of the card. Progress segments sit at the top. On the last card, Next
    becomes Replay.
  - Esc, the close button (`wrap-close`) or a click on the backdrop emits `overlay:close`.
  - Test ids: `wrap-overlay`, `wrap-next`, `wrap-prev`, `wrap-year`, plus `wrap-stage`
    (its `data-card` holds the current card key) and `wrap-close`.
  - Emits `sfx: whoosh` on card change and `sfx: click` on year change.
- `computeWrap(rooms, reviews, year | 'all')`, `availableYears(reviews)`, `defaultWrapYear(reviews)`:
  pure stats in `computeWrap.ts`.

## Stat rules
- "Rooms done" counts visits (reviews); replays count again, and `uniqueRooms` gives the distinct count.
- Best room: highest overall score. Ties go to the most recent visit.
- Fastest escape: escaped visits with a known time only. Ties go to the higher overall score.
- Favourite puzzle type: the most common type. Ties go to the higher memorable count, then the `PUZZLE_TYPES` order.
- Most memorable puzzle: the first memorable puzzle of the visit with the highest *puzzles* score.
- Crew MVP: most visits attended. Ties are broken alphabetically. A name counts once per visit.
- Longest streak: consecutive escapes in date order.
- Reviews whose `roomId` is not in `rooms` are ignored.

## Simplifications
- Animations are CSS only (confetti, sparkles, pop/rise) and respect `prefers-reduced-motion`.
- The cards do not auto-advance on a timer; the user steps through them.
- Glow is emissive-only (no extra light) to keep the lighting budget with the lighting workstream.
