# Room shell (`src/world/room`)

Exports `Room`: the 20 x 16 x 4 m room.

- **Floor**: one `woodFloor` plane. The `planks` texture draws the seams and staggered end joints; `index.tsx` uses `getTiledMaterial` so one tile covers 2.5 m x 1.25 m of the world-planar UVs (`UV_PER_METRE` = 0.5): honey planks ~0.31 m wide running east-west. Walls, ceiling, beams and trim get tiled clones the same way, so texture detail is at real-world scale.
- **Ceiling**: `ceiling` plane with three `woodDark` beams running east-west at z = -4, 0, 4 (the z = 0 beam sits over pendant A).
- **Walls**: 0.3 m thick boxes built outside the interior, cut around `WINDOWS` by `segmentWall` (no CSG). Two-tone: `plasterAccent` wainscot below 0.9 m, `plaster` above, cream chair rail, `baseboard` skirting and a two-step crown moulding. Baseboard and chair rail skip the gate door span on the south wall; no hole is cut for the door.
- **Windows**: `woodLight` reveal liner, casing, deep sill, mullions (two verticals on wide windows) and a see-through `glass` pane (the shared glass material is cloned and forced transparent).
- **Outside**: an open cylinder (radius 30 m, inside faces, unlit, `fog: false`) with a canvas dusk texture: peach horizon (`PALETTE.sky`) into rose and plum, stars, a moon (seen through the south-east window), and two layers of low-poly rooftops/pines with warm lit windows.
- **LED channels**: thin `metalDark` housings behind/above each `LED_STRIPS` line. Lighting owns the glow.
- **Colliders**: `room:wall:{north,south,east,west}`, 1 m thick, full height, outside the interior, overlapping at the corners.

Draw calls: about 11 (one merged geometry per material bucket + sky). UVs are world-planar at 0.5 per metre (a texture tiles every 2 m).

Shadows: everything except the glass/sky/housings receives shadows; only beams and window trim cast. Walls do not cast, to avoid shadow acne on large self-shadowing surfaces; flip `SHADOW_CASTERS` in `index.tsx` if lighting wants moonlight blocked by the walls.

Files: `layout.ts` (pure maths: segmentation, colliders, PRNG), `geometry.ts` (merged geometry), `sky.ts` (dusk texture), `index.tsx` (component), `room.test.ts`.
