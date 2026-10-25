# Player Controller (workstream 8)

First-person controller with no visible avatar.

## Exports
- `PlayerController`: goes inside the Canvas (already mounted by `World.tsx`).
- `MobileControls`: DOM overlay (already mounted by `App.tsx`).

## Files
- `movement.ts`: pure maths. `stepMovement(state, input, dt, { boxes, radius, bounds })`, `resolveCollisions(pos, radius, boxes, bounds)`, `applyLook(...)`, `headBobOffset(...)`.
- `keyboard.ts`: held-key set to `MoveInput` (WASD, arrows, Shift), typing-target check.
- `joystick.ts`: finger offset to joystick vector (with a dead zone).
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

## Simplifications
- No running on touch: joystick speed scales with how far it is pushed, up to walk speed.
- No vertical movement, jumping or stairs. Eye height stays fixed (plus head bob).
