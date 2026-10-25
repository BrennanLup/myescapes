# Lighting (workstream 2)

`<Lighting />` (mounted by `World.tsx`) builds the whole light rig, the teal LED strip meshes and the app's only post-processing chain.

## Files
- `rig.ts`: pure `lightRig(quality)` returning light specs + post settings per preset, and `shadowCasterCount(rig)`. Unit-tested in `rig.test.ts`.
- `index.tsx`: `Lighting` turns the rig into three.js lights, fixes renderer settings.
- `LedStrips.tsx` / `strips.ts`: a thin glowing box along every `LED_STRIPS` segment, using a clone of `getMaterial('emissiveTeal')` with its emissive forced to `LIGHT.ledTeal` at HDR intensity so bloom catches it.
- `PostFx.tsx`: `EffectComposer` with Bloom (mipmap blur, luminance threshold 1.0 on linear HDR, so only emissives and bulbs glow), ACES Filmic `ToneMapping`, gentle `Vignette`. Do not add another composer anywhere.

## Rig
| Light | low | medium | high |
| --- | --- | --- | --- |
| Warm hemisphere fill | yes (brighter) | yes | yes |
| Point lamps at `LAMPS.floorLamp`, `deskLamp`, `pendantA`, `pendantB` | yes | yes | yes |
| Spot from `LAMPS.boardSpot` to the board centre | no shadow | shadow 1024 | shadow 2048 |
| Teal spill at the north LED strip | - | yes | yes |
| Cool dusk directional fill from the south windows | - | yes | yes |
| Teal spill at desk and shelf strips, cool point at west window | - | - | yes |
| Total | 6 | 8 | 11 |
| Post (bloom + tone mapping + vignette) | off (renderer ACES) | MSAA 4 | MSAA 8 |

Exactly one shadow caster (the board spot) at medium/high, none at low. Lamp pools use physical point lights with `decay: 2` and a finite `distance`.

## Notes
- Tone mapping happens once: while the composer is mounted, `@react-three/postprocessing` sets `renderer.toneMapping = NoToneMapping` and the `ToneMapping` effect applies ACES. At low (no composer) the renderer uses ACES itself.
- three 0.186 removed `PCFSoftShadowMap` (R3F still requests it and three warns). We switch to `PCFShadowMap`, which in 0.186 is the soft filtered path, and soften with `shadow.radius = 4`.
- Lamp bulb meshes belong to the prop owners. They should use `emissiveWarm` with an emissive intensity above 1 so they bloom.
- Meshes have to opt into `castShadow` / `receiveShadow` for the board-spot shadow to show.
