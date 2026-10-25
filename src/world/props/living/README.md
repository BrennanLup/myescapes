# Living props (Furniture Set A)

`LivingProps` mounts the cozy living corner and room dressing, all procedural low-poly primitives:

- **Living area** (`ANCHORS.livingArea`): layered woven rug with stripes, diamonds and fringe; a plum couch facing west (−X) with orange/teal/cream pillows and a knitted throw; orange and teal bean bags; a plum pouf; a coffee table with a cocoa mug, board game boxes, game pieces, a die, cards and a succulent; a round side table with books and a plant.
- **Bookshelf** (`ANCHORS.shelves`, east wall): a 3-bay, 4-level unit with about 130 books (varied sizes, a few leaning, flat stacks), vinyl sleeves, a record player with speakers, a globe, a puzzle box, a trophy, a cactus, a framed crew photo, baskets, and a pothos trailing over the top.
- **Lamps**: a floor lamp behind the couch's north arm (kept off the room's z = 0 centre line so the walk east from the centre is clear) whose drum-shade centre is exactly `LAMPS.floorLamp`, a paper-lantern pendant at `LAMPS.pendantA` and a cone pendant at `LAMPS.pendantB`. Shades and bulbs use `emissiveWarm` and never cast shadows, so the lighting workstream's lights can sit inside them.
- **Plants**: monsteras, snake plants and bushes in free corners and spots (see `FLOOR_PLANTS` in `layout.ts`), plus three hanging pothos (near the west window, near the south-east window, and above the corridor between the floor lamp and the wishlist).

## Files
- `layout.ts`: world-space positions and the `LIVING_COLLIDERS` list (pure data). Change placements here.
- `builder.ts`: `PartsBuilder` transforms primitives into world space and merges them into one geometry per (material, castShadow) bucket.
- `furniture.ts`, `shelf.ts`, `plants.ts`: the generators. `set.ts` assembles everything.
- `living.test.ts`: checks that colliders sit inside the room, keep 1.5 m paths from spawn to the board, desk, wishlist and door clear, stay off other anchors' footprints and don't overlap each other. It also checks lamp shade positions and the draw-call budget.

## Performance
29 merged meshes plus 1 `InstancedMesh` for 136 books and records (30 draw calls), well under the 60 draw-call target. Geometry is built once in `useMemo` and disposed on unmount.

## Colliders
`living:couch`, `living:beanbag-orange`, `living:beanbag-teal`, `living:pouf`, `living:coffee-table`, `living:side-table`, `living:floor-lamp`, `living:bookshelf`, `living:plant-*`. The rug and the hanging plants (above head height) have none.

## Simplifications
- `leafDark`, `vinyl` and the white book base are local clones of the shared `leaf`, `metalDark` and `paper` materials with a new colour, because the contract has no ids for them.
- These are decorative props only, not interactables.
- The shelf is centred on the anchor depth-wise, so its back sits about 3 cm from the east wall. It stands on 10 cm feet, so the under-shelf LED strip shows beneath it.
