# Wish List Board (workstream 15)

Exports `WishlistBoard` (3D) and `WishlistOverlay` (DOM) from `index.tsx`.

## WishlistBoard
- Mounted at `ANCHORS.wishlistBoard` (east wall, 3.2 x 2 m): a `chalkboard` slate in a chunky honey-wood frame
  with brass corner pegs and a chalk tray (white/yellow/pink chalk sticks and a felt eraser).
- The chalk writing is a transparent 2048x1280 `CanvasTexture` on a plane just in front of the slate
  (`chalkTexture.ts`): faint eraser smudges, the "Rooms to try" title, then the list sorted by priority in Caveat
  with small seeded jitter and dusty erosion. Done items are dimmed, ticked and struck through. The list uses one
  column for up to 6 lines and two columns after that. It shows up to 12 lines; a longer list puts "+N more..." in
  the 12th. Long names shrink slightly, then get an ellipsis, and the city is dropped when it doesn't fit.
- The texture redraws only when `store.wishlist` changes (and once more when the Caveat font finishes loading).
- Interactable `wishlist:board` emits `wishlist:open`. When `store.hoveredId === 'wishlist:board'` the board
  lifts 3 cm off the wall and a warm halo fades in behind it.
- Registers one AABB collider (`wishlist:board`) that covers the board and tray.

## WishlistOverlay
- A cozy panel with a chalkboard header. Each row shows the priority, name, city, added by and a "Visit site" link.
  The link opens in a new tab; `https://` is added when missing, and non-http(s) links are dropped.
- Row actions: Done/Undo, up, down, remove. Removing shows an Undo toast for 6 s. On desktop (non-touch), rows can
  also be dragged and dropped to reorder.
- Add form: name (required), city, link, and added by. Added by has a datalist plus quick-pick chips from
  `store.crew`, and the last value is remembered in localStorage. On phones (<640 px) the form starts collapsed
  behind a "+ Add a room" button.
- Every change goes through `useStore.getState().setWishlist(next)` with priorities renumbered 1..N. If the save
  fails, the store rolls back and a toast explains it.
- Esc, the close button or a backdrop click emits `overlay:close`. Adding an item or marking one done emits
  `sfx: chalk`. Removing one emits `sfx: paper`.
- Test ids: `wishlist-add-name`, `wishlist-add-submit`, `wishlist-item-<id>`, `wishlist-done-<id>`,
  `wishlist-up-<id>`, `wishlist-down-<id>`, `wishlist-remove-<id>`, plus `wishlist-undo` and `wishlist-add-open`
  (the mobile expand button).

## Logic
`listOps.ts` holds pure functions, tested in `listOps.test.ts`: `sortByPriority`, `renumber`, `normalize`,
`addItem`, `moveUp`, `moveDown`, `moveToIndex`, `removeItem`, `insertAt` (undo), `toggleDone`, `safeHref`, `boardLines`.
`WishlistOverlay.test.tsx` covers add, up/down, drag and drop, done, remove plus undo, save failure and Esc.

## Simplifications
- Drag and drop uses native HTML5 DnD, so it only works on desktop. Touch users reorder with the up/down buttons.
