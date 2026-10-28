# Materials and Look (workstream 3)

One shared PBR material per `MaterialId` (`src/contracts/materials.ts`). Every material is a `MeshStandardMaterial`; varnished wood, fabrics, ceramic and glass are `MeshPhysicalMaterial` (a subclass) for clearcoat / sheen. Base colours come straight from `PALETTE` / `LIGHT` in `src/contracts/style.ts`.

## Use

```ts
import { getMaterial, getTiledMaterial, useMaterial, getTexture } from '@/world/materials'

<mesh material={getMaterial('woodLight')} />                // shared, cached
<mesh material={getTiledMaterial('plaster', 4, 1)} />        // cached clone with its own texture repeat
const m = useMaterial('fabricTeal')                          // hook convenience (memoised)
const t = getTexture('paper')                                // raw procedural texture (or null)
```

- Never dispose a returned material or texture. Clone it for per-object tweaks (`getMaterial('paper').clone()`).
- `getTiledMaterial` re-repeats every texture slot (`map`, `normalMap`, `roughnessMap`, `bumpMap`); the clones share the source image, so the GPU upload happens once.
- Extra exports: `getStandardMaterial(id)` (typed as `MeshStandardMaterial`), `warmMaterials()` (build everything up front, e.g. behind the loading screen), `MATERIAL_COLORS`, `EMISSIVE` (intensity constants), `getNormalTexture`, `getRoughnessTexture`, `roughnessMapMean`, `getBumpTexture`, `canvasAvailable`, `textureGenerationMs`, `textureTimings`, `TEXTURE_NAMES`, `TEXTURE_ANISOTROPY`.
- `MaterialShowcase` (`Showcase.tsx`) is a dev-only grid of every material. It is not mounted anywhere.
- No material uses `flatShading`; geometry decides faceting.
- Metals, glass and varnish are tuned for a `scene.environment` (intensity ~0.4-0.6). Without one, metals read darker.

## Look

| Group | Maps | Notes |
| --- | --- | --- |
| woodFloor | planks: colour, normal 0.8, roughness | Physical, clearcoat 0.3 / 0.18. Mean roughness 0.42: varnish glossy along the grain, worn patches, scratches and seams rougher |
| woodLight / woodDark | woodGrain: colour, normal 0.45, roughness | Physical, clearcoat 0.35 / 0.22, mean roughness 0.5 / 0.44 |
| plaster / plasterAccent / ceiling | plaster: colour, normal 0.25-0.35, roughness | Troweled, mean roughness 0.86-0.95 |
| baseboard | plaster normal (0.12) only | Semi-gloss paint, roughness 0.42 |
| fabrics | fabric: colour, normal 0.7, roughness | Physical sheen 0.6 (tint = palette colour lifted 35% toward white), roughness 0.9 |
| rug | rug: full colour, normal 0.9 | Clamped, not tiled: map it once over the rug's UVs. Colour turns white when the map exists |
| cork | cork: colour, normal 0.9 | Granulated (~5 mm granules on the board) |
| paper / chalkboard | colour, normal, roughness | Paper double-sided; chalkboard dusty swipes are rougher |
| metal | brushed: colour, roughness | Metalness 0.9, mean roughness 0.34 |
| metalDark / brass | brushed roughness only | metalDark 0.65 / 0.48 (painted steel); brass 0.95 / 0.26 |
| ceramic | none | Physical, glossy glaze (roughness 0.22, clearcoat 0.6 / 0.06) |
| pot | clay: colour, normal 0.5, roughness | Unglazed terracotta |
| leaf | none | Roughness 0.48, double-sided, faint self-glow (0.06) for a translucent look |
| glass | none | Physical, transmission off, roughness 0.04, IOR 1.5, opacity 0.2, depthWrite off, envMapIntensity 1.2 |
| screen | screen (emissive) | Glossy (0.12), teal emissive 1.2 with a scanline/vignette emissive map |
| emissiveWarm / emissiveTeal | none | Emissive = colour, intensity 2.6 / 2.8 so they cross a luminance bloom threshold under tone mapping |
| redString / pinRed | none | Saturated, small self-emissive so they stay red in dim light |

Detail maps are light greyscale (planks faintly tinted per board) and multiply the palette colour, so `material.color` always equals the palette value (except the rug, see above).

Roughness maps store absolute roughness; each material sets `material.roughness = target / roughnessMapMean(texture)` so the average lands on the spec value. Without canvas the scalar is the target itself.

## Textures

All procedural, generated lazily on first request from canvas, deterministic (seeded PRNG), seamless (except the rug), cached. Each name yields a bundle made in one pass: sRGB detail map, tangent-space normal map (3x3 Sobel of the generator's height field, OpenGL +Y), linear roughness map. All get mipmaps, trilinear filtering and `anisotropy = 8` (three clamps to the GPU max).

| Texture | Size | Content |
| --- | --- | --- |
| planks | 1024 (roughness 512) | 6 boards per tile, staggered joints, per-board tone / tint / grain, cathedral rings, knots that bend the grain, pores, bevels and seams, wear, scratches. Tile = 2.5 m along x 1.25 m across (boards ~0.21 m wide). Default repeat (8, 12.8) fits the 20 x 16 m floor plane |
| woodGrain | 1024 (roughness 512) | 34 rings per tile with warp and a periodic cathedral arch, streaks, pores, two small knots |
| plaster | 512 | Soft blotches, burnished trowel ridges, sand |
| fabric | 512 | 2/2 twill, 4 px yarns with per-yarn tone, twist and fuzz |
| cork | 512 | Worley granules with crevices and pits. Default repeat (14, 4.5) suits the 8.8 x 2.8 m board |
| paper / chalk / clay / brushed | 512 (clay 256) | Fibres; eraser swipes and dust; grog speckle; brushed streaks |
| rug | 512 | Border, running-dog band, stripes, medallions, 3 px knotted pile, abrash, light wear |
| screen | 256 | Scanlines + vignette (emissive) |

Planks and woodGrain share their warp / streak / pore noise fields (sampled at different offsets), so the first of the two pays for them.

Generation time: `textureTimings()` (per texture, all three maps) and `textureGenerationMs()`. In headless Chromium on a loaded 4-core container (the old 256 px set took 76-114 ms there) the full set takes ~640-750 ms: woodGrain ~180-220 (including the shared wood fields), planks ~150-190, the 512 px textures 35-100 each. Expect about half that on an idle desktop.

In Vitest/jsdom (or anywhere without a 2D canvas) every getter returns null and materials fall back to plain colour.

## Simplifications

- No AO or displacement maps; cavities are baked into the colour maps.
- `getBumpTexture` builds the height map lazily (no material uses bump maps any more).
- Texture repeat is per shared material. Use `getTiledMaterial` when a mesh's UV scale differs.
