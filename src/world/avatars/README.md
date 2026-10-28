# Characters (Phase 3 workstream B)

Your character in the 3D room, and the same character for anyone else (other players, workstream C).

| File | What |
| --- | --- |
| `catalog.ts` | The wardrobe catalogue: skin tones, hair colours, fabric colours and items (hair, top, bottom, shoes, hat, accessory) with prices in keys; `Outfit`, `DEFAULT_OUTFIT`, `starterOutfit(seed)`, `normalizeOutfit`, `unownedItems`, `keyBalance`, `KEY_REWARDS`. Pure, imported by the server. |
| `animation.ts` | `poseAt({ time, phase, speed, action, lookPitch })`: joint angles for idle, walk (from speed) and the emotes `wave`, `cheer`, `dance`. `advancePhase`, `locomotionAction`. Pure. |
| `kit.ts` | Shared, cached geometries (`G`) and materials (`M(hex)`) for every character on screen. |
| `bake.ts` | `bakeCharacter`: merges a look's ~40 meshes into one per joint and finish (matte, satin, metal; vertex colours), with near/far versions where a joint has small details; `fadeCharacter` (private see-through copies). Pure three.js. |
| `occlusion.ts` | `blocksView` / `blocksPlayer`: is your character (an upright capsule) between the camera and the reticle's target, or another player? Pure. |
| `Character.tsx` | `<Character outfit motion? speed? action? shadows? {...groupProps} />`. |
| `LocalAvatar.tsx` | You: follows `playerView` (src/player/view.ts), visible only in third person once the camera is far enough out (`hideDistance(playerView.crane)`: 0.9 m, 0.6 m while the camera is craned over your head against a wall), and plays the emote you sent to the room. Fades to 40% (`FADE_OPACITY`) while it stands between the camera and what the reticle aims at, or a remote player (`remoteRoots`); `playerView.avatarOpacity` mirrors it. Mounted by `World.tsx`. |
| `RemotePlayers.tsx` | Other people in the room (workstream C): one `Character` each in their own look, moved from the interpolated poses in `src/net` every frame, with an @handle tag (a dot, gold for the host) and their latest chat line in a bubble (drei `Html`, fades out from 9 m, hidden past 16 m). Emotes play while they stand still. Real shadows only on High quality with a mouse (`remoteShadows`), otherwise one soft blob-shadow quad each; past 8 m (`DETAIL_DISTANCE`) their small face details are skipped. Mounted by `World.tsx`. |

## Character
- Built from primitives (capsules, spheres, boxes, cylinders, tori), about 40 small meshes, no textures and no downloaded model. Flat-shaded clothes, smooth skin, in the room's warm palette.
- Origin between the feet on the floor; faces local **-Z**, so `rotation-y={yaw}` uses the camera's yaw convention (`runtime.player.yaw`). Eyes at 1.6 m (`PLAYER.eyeHeight`).
- Joints: hips, knees, shoulders (swing and raise), elbows, head (pitch and roll), plus whole-body bob, lean, sway and twist. The walk cycle advances with distance walked (one cycle per 1.5 m), so feet don't slide at any speed.
- The group carries `userData.raycastIgnore`, so a character never blocks interaction.
- **Baked** (bake.ts): the JSX describes the look as small meshes; after each new look a layout effect hides them and adds one merged mesh per joint and finish under the same joint, so the animation still moves it. About 12 draw calls per character instead of ~42 (measured on the Pixel 7 profile, medium: own room 69 draws first person, 82 third person; a visitor adds about 11). Glowing parts (lantern, headphone accent) keep their own material. Rebaking takes a few milliseconds and only happens when the look changes.
- `motion.far = true` swaps the head (and key ring) to a baked version without the small details (ears, eyes, cheeks, nose, mouth). Parts flag them with `detailRef` (`userData.detail`).
- `motion.opacity` (0..1) fades the character with private transparent copies of its materials.
- Remote players' faint glow (`liftCharacter`) works on baked meshes by adding the vertex colour to the emissive in the shader.
- Geometries and materials are shared module-level caches (never disposed; bounded by the catalogue). Changing an outfit re-renders that one character; motion never re-renders.

### For other players (workstream C)
```tsx
const motion = useMemo<CharacterMotion>(() => ({ speed: 0, action: 'idle', lookPitch: 0 }), [])
useFrame(() => { motion.speed = interpolated.speed; motion.action = emote ?? locomotionAction(interpolated.speed) })
<Character outfit={outfit} motion={motion} position={[x, 0, z]} rotation-y={bodyYaw} />
```
Validate outfits received over the network with `OutfitSchema` (src/contracts/avatar.ts) or repair them with `normalizeOutfit`. The server helpers `outfitForUser` / `outfitsForUsers` (server/routes/avatar.lib.ts) return a user's saved look or their starter look. Your own state to broadcast is in `playerView` (mode, bodyYaw, speed) and `runtime.player` (eye position, yaw, pitch).

## Catalogue rules
- Ids are stored in the database: never rename or reuse one. Retire an item with `retired: true`.
- Every slot has free items and at least one item to unlock; hats and accessories can be empty.
- Keys: `KEY_REWARDS` = 20 welcome, 10 per room you are on (owner or accepted), 5 per solved Escape of the Day. The server counts them from your data each time (no stored balance), minus what you spent.
- No real money: there is no payment provider. Prices are in keys only.

## Tests
`catalog.test.ts` (ids, free choices, starter looks, normalising, ownership, keys), `animation.test.ts` (walk cycle, emotes, limits), `remote.test.ts` (shadow rule, detail distance, the shared blob shadow), `bake.test.ts` (merge counts, positions, colours, near/far, rebake, fading), `occlusion.test.ts` (segment distance, in-the-way rules). The camera maths are tested in `src/player/camera.test.ts`.
