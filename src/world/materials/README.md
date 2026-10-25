# Materials and Look (workstream 3)

One shared, stylized material per `MaterialId` (`src/contracts/materials.ts`), all `MeshStandardMaterial` so lights and shadows work. Base colours come straight from `PALETTE` / `LIGHT` in `src/contracts/style.ts`.

## Use

```ts
import { getMaterial, getTiledMaterial, useMaterial, getTexture } from '@/world/materials'

<mesh material={getMaterial('woodLight')} />                // shared, cached
<mesh material={getTiledMaterial('plaster', 4, 1)} />        // cached clone with its own texture repeat
const m = useMaterial('fabricTeal')                          // hook convenience (memoised)
const t = getTexture('paper')                                // raw procedural texture (or null)
```

- Never dispose a returned material or texture. Clone it for per-object tweaks (`getMaterial('paper').clone()`).
- Extra exports: `getStandardMaterial(id)` (typed as `MeshStandardMaterial`), `warmMaterials()` (build everything up front, e.g. behind the loading screen), `MATERIAL_COLORS`, `EMISSIVE` (intensity constants), `getBumpTexture`, `canvasAvailable`, `textureGenerationMs`, `textureTimings`, `TEXTURE_NAMES`.
- `MaterialShowcase` (`Showcase.tsx`) is a dev-only grid of every material. It is not mounted anywhere.

## Look

| Group | Notes |
| --- | --- |
| woodLight / woodDark | wood grain map, roughness 0.55-0.62 |
| woodFloor | staggered planks + bump; default repeat (16, 12.8) fits the 20 x 16 m floor plane (1.25 m tile, ~0.31 m planks) |
| plaster / plasterAccent / ceiling | faint seamless plaster blotch noise, repeat (3, 1.5) |
| fabrics | basket weave + bump, `flatShading` for the low-poly look |
| rug | full-colour woven rug (border, stripes, diamonds), clamped, not tiled: map it once over the rug's UVs. Colour turns white when the map exists |
| cork | speckle + bump; paper: fibres, double-sided; chalkboard: eraser smudges |
| metal / metalDark / brass | metalness 0.5-0.7 (moderate, reads without an env map) |
| leaf / pot | flat shaded; leaf double-sided |
| glass | transparent, opacity 0.22, depthWrite off |
| screen | dark base, teal emissive (1.2) with a scanline/vignette emissive map |
| emissiveWarm / emissiveTeal | emissive = colour, intensity 2.6 / 2.8 so they cross a luminance bloom threshold under tone mapping |
| redString / pinRed | saturated, small self-emissive so they stay red in dim light |

Detail maps are light greyscale and multiply the palette colour, so `material.color` always equals the palette value (except the rug, see above).

## Textures

Generated lazily on first request from canvas (256 px, planks and rug 512 px), cached, sRGB, mipmapped, RepeatWrapping. Total generation of all nine is ~75 ms in headless SwiftShader under heavy load (`textureTimings()` reports per texture).

In Vitest/jsdom (or anywhere without a 2D canvas) textures are `null` and materials fall back to plain colour.

## Simplifications

- No PBR normal/roughness maps; bump maps only on floor, fabrics, cork and rug.
- Texture repeat is per shared material. Use `getTiledMaterial` when a mesh's UV scale differs.
