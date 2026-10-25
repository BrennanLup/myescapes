# Memory Puzzle Gate (`src/gate`)

A small daily memory puzzle that greets you on entry, framed as a vintage safe door.

## Exports
- `GateDoor`: the 3D door at `ANCHORS.gateDoor` (south wall). It has a wooden door with raised panels, a brass safe dial, a keypad, a padlock on a hasp, a "Daily lock" sign and a warm sconce with a small point light. It is an interactable (`kind: 'gate'`, label "Today's lock" or "Solved today ✓", emits `gate:open`) and registers the AABB `gate:door`. Once today's lock is solved, the padlock opens and the door swings into the room. A painted hallway plane sits behind the door, so the opening never shows the void.
- `GateOverlay`: the DOM overlay.
- `useGateAutoOpen()`: called from App. When `dataStatus === 'ready'` and `worldReady` are both true, it emits `gate:open` once per page load (a module-level guard keeps StrictMode from opening it twice). It only does this if localStorage `myescapes.gate.lastSolved` is not today (local `YYYY-MM-DD`). It also installs `window.__ESCAPE_GATE__`.

## URL params
- `?gate=off`: never auto-open. `?gate=force`: open even if solved today.
- `?gateType=lock|cipher|sequence|search|recall`: force a generator.

## How a day's gate is built (`daily.ts`)
1. `selectPuzzle` gathers the puzzles from every review, keeps the `memorable` ones (or all of them if none are memorable), and picks one with an RNG seeded from the date. With no puzzles at all it uses a built-in generic padlock puzzle.
2. `pickGenerator` maps the puzzle type to a generator (seeded):
   - lock-and-key → lock
   - math → lock or sequence
   - logic → cipher or sequence
   - audio-visual → cipher
   - search and physical → search
   - unknown types → recall

   When at least 2 rooms exist, there is also a 20% chance of the recall question, for variety.
3. Generators (`generators.ts`) are pure and seeded. Each returns `{ prompt, data, answer, check(), hints[3] }`:
   - **lock**: a 3-4 digit code. Each digit comes from a clue: counting drawn icons (optionally ×2 or +n), a short arithmetic riddle, or the hour on a drawn clock face. Answer with the keypad or by typing.
   - **cipher**: a symbol key (the word's letters plus decoys) and a cozy word written in symbols. Typed answer, case-insensitive.
   - **sequence**: numbers (arithmetic, alternating, squares + offset, doubling/tripling, Fibonacci-like; typed answer) or a colour + shape pattern (multiple choice).
   - **search**: a generated SVG cozy room (shelves, books, plants, mugs, candles, frames, yarn) with 3-5 small brass keys, stars or hearts at seeded positions. Tap each one. A tap that misses counts as a miss.
   - **recall**: "Which room had this puzzle?" with up to 4 room options.

## Overlay flow (`machine.ts`, `GateOverlay.tsx`)
- A wrong answer shakes the frame, emits `gate:miss { misses }` and plays sfx `error`. Hints appear on their own from the 2nd miss onward. A "Hint" button reveals them early. "Skip for today" appears after the 3rd miss or once every hint is shown.
- Solving plays sfx `unlock`, stores today, shows the unlock animation, then reveals the room: the photo (`room.photos[0]`, falling back to `review.photos[0]` or a styled placeholder polaroid), the original puzzle description and the old `ratings.puzzles.comment`. "Step inside" emits `gate:solved { skipped: false, puzzleId }`.
- Skip stores today and emits `gate:solved { skipped: true, puzzleId }` straight away.
- Until it is solved or skipped, Esc is swallowed (a capture listener on window). If something else closes or replaces the overlay while the gate is locked, the hook reopens it.
- Clicking the door after today's gate is done shows the "Solved today ✓" reveal, with "Play again" and "Step inside" (Esc closes it).

## Test ids / hooks
`gate-overlay` (with `data-gate-kind`), `gate-answer`, `gate-submit`, `gate-hint`, `gate-skip`, `gate-continue`, `gate-target-<i>`, `gate-choice-<i>` (each has `data-choice-id`), `gate-reveal`, `gate-hints`.

`window.__ESCAPE_GATE__.answer()` returns a code or word for text puzzles, the choice id for choice puzzles (click `[data-choice-id="<answer>"]`), and the list of target ids for search (the id equals the index `i` in `gate-target-<i>`).

## Simplifications
- The gate is picked once per day per page load, from the data present when it first opens. An entry added mid-session doesn't swap it.
- The door opens a right angle, so the open leaf stands against its hinge side (world x of about +0.55) instead of sweeping across the doorway. Colliders (`colliders.ts`, pure): `gate:door` is a 0.12 m slab that hugs the wall across the casing, and `gate:door-leaf` (only while solved) wraps the open leaf. Both stay clear of the x = 0 line, so from the room centre you can walk 7.5 m south.
- No backdrop blur behind the overlay: it made software-WebGL screenshots time out.
