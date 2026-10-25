# Desk terminal (workstream 5)

`DeskProps` mounts the "log a new escape room" desk at `ANCHORS.desk` (west wall).

- **Furniture:** chunky honey-wood desk with drawer cabinet, gaming chair (teal + orange, pulled out and turned to the room), main monitor + angled side monitor ("crew chat"), keyboard, mouse, desk mat, podcast mic on a boom arm, PC tower with teal LED fan rings, mug, tiny cactus, sticky notes, and a desk lamp whose bulb sits exactly at `LAMPS.deskLamp` (derived via `deskWorldToLocal`, tested).
- **Terminal screen:** animated canvas texture (`terminal.ts`). `terminalFrame(t, hovered, roomCount)` is a pure function returning the lines, typed prompt (`> LOG A NEW ESCAPE ROOM`), cursor blink, button text and mic meter bars; `drawTerminal` paints it. The texture is only re-uploaded when the frame key changes (stepped at 8 fps). Used as map + emissive map with `toneMapped: false` so bloom picks it up.
- **Interaction:** the whole desk group is `interactable({ id: 'desk:terminal', kind: 'desk', event: record:open })`.
- **Hover glow:** when `hoveredId === 'desk:terminal'`, a damped 0..1 value boosts the screen emissive, brightens the LEDs and fades in an additive back-face teal rim around both monitors. The screen switches to `> READY TO RECORD`.
- **Colliders:** `desk:desk` and `desk:chair` (world AABBs from `deskColliders()`).
- **Draw calls:** static parts are merged into one geometry per material (`parts.ts`, ~17 meshes total incl. screens/LEDs/bulb/rim). All furniture casts and receives shadows.

Simplifications: the chair is static (doesn't swivel); the side monitor is a static canvas.
