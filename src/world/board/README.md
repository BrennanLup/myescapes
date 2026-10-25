# Bulletin board (workstream 6)

`BulletinBoard` mounts a 9 x 3 m cork board (wood frame, `cork` / `woodLight` materials) at `ANCHORS.bulletinBoard` on the north wall. It pins one polaroid per room.

## Files
- `layout.ts`: the pure layout. `layoutBoard(rooms, reviews, sort, boardW, boardH)` returns `{ groups, slots, photoW, photoH }`. It also exports the group-key helpers (`groupKeyFor`, `ratingBucket`, `timeBucket`), the seeded RNG and `slotPinLocal`. Unit tests are in `layout.test.ts`.
- `textures.ts`: canvas drawing for polaroids, the genre illustrations (ghost, magnifier, mountains, rocket, castle, vault, pyramid, smiley, stopwatch, key), group label cards, sort tabs, sticky notes and the soft shadow.
- `index.tsx`: the R3F component, the animation loop, the sort tabs and the store/runtime publishing.

## Behaviour
- **Grouping** follows `store.sort`:
  - city, brand (company) and genre: alphabetical, with "Unknown" last.
  - date: by year, oldest first, with "Undated" last.
  - rating: 90+, 80-89, 70-79, <70, then Unrated.
  - escapeTime: Under 45 min, 45-54 min, 55+ min, Didn't escape, then Unknown.
- **Order within a group:**
  - city, brand, genre and date: chronological.
  - rating: highest score first.
  - escapeTime: fastest first.
  - Ties go by name, then id.
- **Packing:** each group is a cluster with a paper label card on top. Clusters flow left to right onto shelves. The photo size starts at 0.8 m wide and shrinks until everything fits. Every slot has room for its tilt, so photos never overlap and nothing leaves the board. Tests cover 1 to 200 rooms, including 200 single-room groups.
- **Polaroid:** a 256x300 CanvasTexture (160x188 above 80 rooms). It shows the photo, then a Caveat caption with the room name, the city and the overall score circled in red.
  - The photo is `room.photos[0]` or the latest review's first photo, loaded with `crossOrigin=anonymous`.
  - If there is no photo, or it fails to load, a procedural genre illustration in `GENRE_COLORS` is drawn instead.
  - Each photo also gets a seeded tilt, a red pin head (`pinRed`), washi tape on about a third of them, and a fake soft shadow that grows while the photo is lifted.
- **Store and runtime:**
  - On every layout change the board calls `setBoardPins([{ roomId, group, order, target }])`. `target` is the world-space position of the pin head once the photo settles.
  - On every frame where a photo is moving, its live pin-head position is written into `runtime.pinPositions`. The board reuses the same `Vec3` per room, so this allocates nothing.
- **Animation:** one `useFrame` loop mutates the Object3Ds directly, with no React render per frame.
  - On a sort change, each photo lifts off, follows a small arc with a stagger and lands with a damped wobble.
  - On first load, the photos drop onto the board in a cascade.
  - When `lastAddedRoomId` changes, that photo flies in from the desk (west), spins, pins itself and emits `bus.emit('sfx', { name: 'pin' })` when it lands.
  - When `hoveredId === 'photo:<id>'`, the photo lifts toward the viewer, scales up about 14% and straightens.
- **Interaction:**
  - Each photo carries `interactable({ id: 'photo:<id>', kind: 'photo', label: 'Read review: <name>', event: review:open })`.
  - Six paper tabs along the top edge use `interactable({ id: 'sort:<key>', kind: 'sort', label: 'Sort by <Label>', maxDistance: 7 })`. The board listens for `bus.on('interact')` and calls `setSort` when one is clicked.
  - The active tab is highlighted orange.
- **Extras:** a "Sort by:" sticky note, an "N rooms escaped!" counter note, an empty-state note when there are no rooms, and one AABB collider for the board.

## Simplifications
- When a sort changes, the group label cards pop in fresh instead of flying.
- The pin heads follow the hover lift (the red string moves by a few cm while a photo is hovered).
- Each photo has its own material and texture, so it costs its own draw calls (about 4 per photo). That is fine for 200 rooms on desktop. Instancing was not needed.
