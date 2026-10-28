# Player Controller (workstream 8, camera modes from Phase 3 B)

The player controller: first person (the default), or third person behind your character
(`src/world/avatars`). `V`, the HUD button or the phone's eye button switches; the choice is
remembered per device (`localStorage['myescapes.camera.v1']`).

## Exports
- `PlayerController`: goes inside the Canvas (already mounted by `World.tsx`).
- `RenderPause`: goes inside the room's Canvas (mounted by `World.tsx`). While a covering overlay is open (`PAUSING_OVERLAYS`: review, record, confirm, gate, wardrobe, wishlist, Wrapped; not Settings) the Canvas switches to `frameloop="demand"`, so the room stops drawing behind it; the canvas gets `data-render="paused"` (`"live"` otherwise) and the `?debug=1` readout says so. The animation clock is kept across the switch.
- `MobileControls`: DOM overlay (already mounted by `App.tsx`).

## Files
- `camera.ts`: pure third-person maths: `thirdPersonOffset`, `clearDistance` (segment vs collider boxes and the room interior), `followDistance`, `stepBodyYaw`, `rayStartDistance`, `pitchLimits`, `orbitPitch`, `THIRD_PERSON` tuning and the desktop/touch rigs. The per-frame helpers take `out` tuples so the controller allocates nothing while you move.
- `view.ts`: `useCameraMode` (reactive, persisted) and `playerView` (per-frame, non-reactive: blend, camera distance, ray start, feet, body yaw, speed).
- `movement.ts`: pure maths. `stepMovement(state, input, dt, { boxes, radius, bounds })`, `resolveCollisions(pos, radius, boxes, bounds)`, `applyLook(...)`, `headBobOffset(...)`.
- `keyboard.ts`: held-key set to `MoveInput` (WASD, arrows, Shift), typing-target check.
- `joystick.ts`: finger offset to joystick vector (with a dead zone).
- `RenderPause.tsx`: pauses the room's render loop behind full-screen overlays (QA r4).
- `PlayerController.tsx`: input listeners, pointer lock, per-frame update of `runtime.player` and the camera.
- `MobileControls.tsx`: virtual joystick and full-screen look surface.
- `qa-screenshots.mjs`: `node src/player/qa-screenshots.mjs http://localhost:4108 qa/screenshots` holds W on desktop and drives the joystick on mobile.

## Behaviour
- **Controls enabled** = `selectControlsEnabled` (no overlay and world ready). When controls turn off, all keys and pending look input are released. Keys are also released on window blur and when the tab is hidden.
- **Desktop look:** pressing on the canvas requests pointer lock. Lock state is mirrored into `store.pointerLocked`. If lock is unavailable or rejected (e.g. headless), click-and-drag on the canvas looks instead. Uses `settings.sensitivity` and `settings.invertY`. Pitch is clamped to +-85 degrees.
- **Movement:** WASD or arrows, Shift to run (`PLAYER.walkSpeed` / `runSpeed`). Speed-up and slow-down use exponential smoothing. Each frame is split into sub-steps of 1/60 s or less (frame time capped at 0.25 s), so movement doesn't depend on frame rate and the player can't tunnel through walls. Keys work without pointer lock. Keys are ignored while typing in inputs, textareas, selects or contenteditable elements.
- **Collision:** a circle of radius `max(PLAYER.radius, 0.3)` is pushed out of every collider whose Y range overlaps [0.1, 1.8]. Push-out runs up to 4 iterations, so the player slides along surfaces. Position is then hard-clamped inside the room interior.
- **Head bob:** only when `settings.headBob` is on. It is one small bump per 0.75 m step and fades with speed.
- **Runtime:** writes `runtime.player` (eye position, yaw, pitch, moving when speed > 0.3, speed) every frame, then copies it into the camera with rotation order `YXZ`. Consumes `runtime.pendingTeleport`; the teleport's y becomes the eye height. Direct writes to `runtime.player.position/yaw/pitch` from outside are picked up too (older screenshot scripts use them).
- **Touch:** turns on with `store.isTouch` or the first touch event (`setTouch(true)`). Shows a large translucent cream and orange joystick bottom-left, which writes `runtime.joystick`. Behind it is a full-screen `[data-look-surface]` that adds drag deltas to `runtime.lookDelta`. Multi-touch works because each pointer is tracked by id. The look surface never calls preventDefault or stopPropagation. Joystick events stop propagation so a thumb on the stick is never treated as a world tap. Hidden while an overlay is open or the world isn't ready.

## Third person
- **Camera:** looks the same way you look, from 3.1 m behind, 0.3 m above and 0.6 m to the right of the head (over the shoulder, so your head never sits on the reticle). On touch (`TOUCH_RIG`) it is centred, 3.6 m back and 1.45 m up, and looks about 10 degrees below your look pitch (`tilt`), so the character stands in the lower third (head about 65% down the screen, feet about 90%), well under the reticle, and the ceiling takes less of the screen. The interaction ray follows the camera's real direction. A room can pass its own rigs (`<PlayerController rigs={{ touch, desktop }} />`): the small Escape of the Day room brings the phone camera in to 2.5 m back, 0.8 m up, with no extra downward tilt (its own tuning).
- **Pitch:** third person narrows the look pitch to 55 degrees down / 50 up (`pitchLimits`, tightening during the blend). The camera's orbit pitch is limited further (`orbitPitch`) so it never drops more than 0.3 m below the head or into the ceiling margin; past that it only tilts. Closer than 0.9 m (a wall pulled it in) your character is hidden instead of filling the screen. Mouse or touch drag orbits it around you; WASD moves relative to the camera and your body turns smoothly to face where you walk (it stays put while you only look around).
- **Walls:** the segment from the head to the wanted camera spot is tested against every collider box (grown by 0.18 m) and the room interior (walls have window gaps). The camera snaps in at once when something is in the way and eases back out (rate 5/s). Boxes the head is already inside are ignored.
- **Backed into a wall or a corner (the crane):** when the full rig's spot would be squeezed under 1.25 m (`craneAmount`, fully at 0.55 m), the camera slides along the wall instead of collapsing into your head (`craneSpot`, `CRANE`): up over your head, up to 0.35 m towards the rig's shoulder (the other shoulder if a wall cuts that side short; centred on the phone rig), then back as far as the wall allows. It rises only as high as keeps your head on screen from that far back (at most 1 m, at least 0.25 m) and keeps your look pitch, tilting at most 25 degrees down, so the room ahead stays in view and the reticle never lands at your feet (QA r4). Pressed flat to a wall there is no room to show yourself: the view becomes a short over-the-shoulder view of the room. While craned your character shows from 0.45 m (`hideDistance`) rather than 0.9 m, since the camera is above the head. It eases in and out at 6/s, the spot itself is followed smoothly (a shoulder switch never pops), and it is only used when it shows more than the pulled-in spot. `playerView.crane` and `playerView.cameraPitch` expose it to tests.
- **Smooth follow:** the head pivot follows the character at rate 16/s (snaps after teleports over 2 m). Switching modes blends over 0.35 s; head bob only applies in first person.
- **Interaction:** the interaction ray starts at `playerView.rayStart`, the point on the view ray nearest your eyes, so reach is measured from your character in both modes and your own body never blocks it. The character is also `raycastIgnore`.
- `runtime.player` keeps meaning your eyes (position, yaw, pitch) in both modes; only the camera moves.

## Simplifications
- No running on touch: joystick speed scales with how far it is pushed, up to walk speed.
- No vertical movement, jumping or stairs. Eye height stays fixed (plus head bob).
