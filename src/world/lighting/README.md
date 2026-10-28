# Lighting (workstream 2)

`<Lighting />` (mounted by `World.tsx`) builds the whole light rig, the teal LED strip meshes, the room's atmosphere (environment map, light shafts, lamp haze, dust) and the app's only post-processing chain.

## Files
- `rig.ts`: pure `lightRig(quality)` returning light specs, post settings and atmosphere settings per preset, `shadowCasterCount(rig)` and the moon position (`MOON_POSITION`, `moonDirection()`). Unit-tested in `rig.test.ts`.
- `atmosphere.ts`: pure geometry for the moonlight shafts (`moonShafts()`: window opening to floor patch along the moonlight) and the dust zones (`shaftBounds`).
- `index.tsx`: `Lighting` turns the rig into three.js lights, fixes renderer settings.
- `Atmosphere.tsx`: the generated room environment map (drei `Environment` + `Lightformer`s: warm ceiling and floor bounce, dim walls, cool windows, lamp hot spots; rendered once), additive moonlight shaft volumes, haze cones under the pendants and drifting dust motes (own point shader).
- `LedStrips.tsx` / `strips.ts`: a thin glowing box along every `LED_STRIPS` segment, using a clone of `getMaterial('emissiveTeal')` with its emissive forced to `LIGHT.ledTeal` at HDR intensity so bloom catches it.
- `PostFx.tsx`: `EffectComposer` with N8AO ambient occlusion, Bloom (mipmap blur, luminance threshold 1.0 on linear HDR, so only emissives and bulbs glow), AgX `ToneMapping`, a small saturation/contrast grade, `Vignette` and faint film grain. Do not add another composer anywhere.

## Rig
| | low | medium | high |
| --- | --- | --- | --- |
| Warm hemisphere fill | 1.4 (carries the room) | 0.14 | 0.14 |
| Room environment map | - | 128 px, intensity 0.32 | 256 px, intensity 0.32 |
| Point lamps at `floorLamp`, `deskLamp`; spots under `pendantA`, `pendantB` | yes | yes | yes, pendant A shadow 1024 |
| Spot from `LAMPS.boardSpot` to the board centre | no shadow | shadow 1024 | shadow 2048 |
| Moonlight directional from the south-south-east | - | shadow 1024 | shadow 2048 |
| Teal spill at the north LED strip | - | yes | yes |
| Teal spill at desk and shelf strips, cool point at west window | - | - | yes |
| Moon shafts, pendant haze | - | yes | yes |
| Dust motes | - | 110 | 260 |
| Post | off (renderer ACES) | MSAA 2, AO half res | MSAA 4, AO full res |

Shadow casters: none at low, board spot + moon at medium, plus pendant A at high.

## Notes
- The moon sits at the sky texture's moon azimuth, raised to about 28 degrees. The room's walls and ceiling cast shadows (see `SHADOW_CASTERS` in `src/world/room`), so moonlight only lands through the window openings, with mullion shadows, exactly where the shaft volumes end.
- Nothing additive may produce Inf or NaN: the composer works in half-float HDR and the bloom's mip blur spreads one bad pixel over the whole screen (the canvas then shows the page background). That is why the dust is a custom shader rather than drei's `Sparkles` (which divides by the distance to the sprite centre) and why every `pow()` base in the shaft and haze shaders is clamped.
- Tone mapping happens once: while the composer is mounted, `@react-three/postprocessing` sets `renderer.toneMapping = NoToneMapping` and the `ToneMapping` effect applies AgX. At low (no composer) the renderer uses ACES itself.
- three 0.186 removed `PCFSoftShadowMap` (R3F still requests it and three warns). We switch to `PCFShadowMap`, which in 0.186 is the soft filtered path, and soften with `shadow.radius`.
- Lamp bulb meshes belong to the prop owners. They should use `emissiveWarm` with an emissive intensity above 1 so they bloom.
