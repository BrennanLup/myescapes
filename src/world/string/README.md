# Red String (workstream 7)

`RedString` draws red string across the north-wall bulletin board, linking photos that share a group under the active sort.

## What it does
- Reads `useStore(s => s.boardPins)`. Within each group, pins are chained in `order`. A thinner "timeline" thread also links the first pin of each group in sequence. There are never links across groups (`links.ts`).
- Each string hangs as a parabola that sags by 4.5% of its span, capped at 9 cm (`sag.ts`). It runs 12 mm under and 12 mm behind each pin head, in front of the photo and the cork.
- Every frame it follows `runtime.pinPositions`, falling back to `target` when a pin has no live position. There are no React re-renders and no per-frame allocations: two preallocated meshes (live and untying) hold 400 links each, enough for 200 pins, and are rewritten in place (`geometry.ts`, `controller.ts`).
- Each link is a three-sided tube made of two halves. The halves meet while the string is tied and pull apart toward their pins when it unties, so one fixed topology covers drawing, hanging and untying.
- The radius grows with camera distance (5 mm up close, about 1.5 px wide from spawn) so the string stays readable without looking like rope up close.
- **Re-sort** (`sort:changed` or a store `sort` change): the old strings untie toward their pins, go slack and fade over 0.45 s. The new strings draw out from pin to pin, staggered, starting at 0.35 s and done by about 1.3 s. Each string is held taut while it draws, then twangs: a damped overshoot of the sag. `bus.emit('sfx', { name: 'string' })` fires once when the new strings start drawing. If the board publishes no new layout within 0.6 s, the current layout is re-tied.
- **New photo** (`entry:saved`): existing strings stay. The new photo's string waits until its live pin head is within 1.5 cm of its target (3 s timeout), then draws and plays the string sfx. Removed pins' strings untie.
- The string meshes ignore raycasts, so they never steal clicks from photos.

## Files
- `index.tsx`: the `RedString` component (materials, store/bus wiring, `useFrame`).
- `links.ts`, `sag.ts`, `timing.ts`: pure logic, unit-tested in `string.test.ts`.
- `geometry.ts`: the preallocated tube mesh writer.
- `controller.ts`: the animation state machine (no React).
- `DevPinFixture.tsx`: **dev only**, not imported anywhere. It publishes fake pins for 14 rooms and draws a cork panel, polaroids and pin heads. To try the string before the real board exists, mount `<DevPinFixture />` next to `<RedString />` in `World.tsx` for a moment.

## Simplifications
- Strings are smooth-shaded 3-sided tubes. This is cheap, and they look round enough at string thickness.
- The timeline thread uses the same red material, only thinner and saggier.
