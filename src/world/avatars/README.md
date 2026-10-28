# Characters (Phase 3 workstream B)

Your character in the 3D room, and the same character for anyone else (other players, workstream C).

| File | What |
| --- | --- |
| `catalog.ts` | The wardrobe catalogue: skin tones, hair colours, fabric colours and items (hair, top, bottom, shoes, hat, accessory) with prices in keys; `Outfit`, `DEFAULT_OUTFIT`, `starterOutfit(seed)`, `normalizeOutfit`, `unownedItems`, `keyBalance`, `KEY_REWARDS`. Pure, imported by the server. |
| `animation.ts` | `poseAt({ time, phase, speed, action, lookPitch })`: joint angles for idle, walk (from speed) and the emotes `wave`, `cheer`, `dance`. `advancePhase`, `locomotionAction`. Pure. |
| `kit.ts` | Shared, cached geometries (`G`) and materials (`M(hex)`) for every character on screen. |
| `Character.tsx` | `<Character outfit motion? speed? action? shadows? {...groupProps} />`. |
| `LocalAvatar.tsx` | You: follows `playerView` (src/player/view.ts), visible only in third person. Mounted by `World.tsx`. |

## Character
- Built from primitives (capsules, spheres, boxes, cylinders, tori), about 40 small meshes, no textures and no downloaded model. Flat-shaded clothes, smooth skin, in the room's warm palette.
- Origin between the feet on the floor; faces local **-Z**, so `rotation-y={yaw}` uses the camera's yaw convention (`runtime.player.yaw`). Eyes at 1.6 m (`PLAYER.eyeHeight`).
- Joints: hips, knees, shoulders (swing and raise), elbows, head (pitch and roll), plus whole-body bob, lean, sway and twist. The walk cycle advances with distance walked (one cycle per 1.5 m), so feet don't slide at any speed.
- The group carries `userData.raycastIgnore`, so a character never blocks interaction.
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
`catalog.test.ts` (ids, free choices, starter looks, normalising, ownership, keys), `animation.test.ts` (walk cycle, emotes, limits). The camera maths are tested in `src/player/camera.test.ts`.
