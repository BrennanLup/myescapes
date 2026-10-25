# QA playtest report: My Escapes (round 1)

Date: 2026-10-25, `main` at `d59c9f2`. Harness: `qa/playtest.mjs`. Raw results: `qa/playtest-results.json`.

**How it ran:** `node qa/playtest.mjs` spawns `NO_OPEN=1 PORT=3330 DATA_DIR=<fresh temp dir> npm start` and waits for `/health` (3.0 s). It drives headless Chromium (SwiftShader) at desktop 1440x900 and mobile 390x844 (Pixel 7, touch). Input is real: `W` key on desktop, joystick pointer events on mobile, `E` or taps to interact, clicks on real buttons. Every anchor was reached by walking.

## Project checks
| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npx eslint .` | PASS (clean) |
| `npx vitest run` | PASS: 36 files, 393 tests |
| `npx playwright test` | PASS: 11 passed, 5 skipped by design |

## Measurements
| | Desktop 1440x900 | Mobile 390x844 |
| --- | --- | --- |
| Load to world ready (SwiftShader) | 15.3 s | 10.5 s |
| Transferred bytes | 1.79 MB (< 15 MB) | 1.80 MB |
| Draw calls per frame, medium / low | 135 / 107 | 127 / 99 |
| Triangles per frame, medium / low | 44.9k / 29.6k | 38.6k / 23.3k |
| Console errors / page errors / failed requests | 0 / 0 / 0 | 0 / 0 / 0 |

Software GL fps (about 1 fps) is not representative of a laptop GPU. Geometry is far below the 300 draw call / 500k triangle guide, so 60 fps on a mid laptop at medium is plausible. The remaining cost is fill rate.

## Pass/fail by step
| Step | Desktop | Mobile |
| --- | --- | --- |
| 1 Start with `npm start`, load, bytes | PASS | PASS |
| 1b Perf budgets / debug readout | budgets PASS, readout FAIL (#2) | same |
| 2 Gate auto-opens, solved through the UI, no gate after reload | PASS | PASS |
| 2b Hints after 2 misses, skip after the 3rd | PASS | PASS |
| 2c All 5 generators render, solve and fit | PASS | PASS |
| 3b Walk to all 7 anchors | PASS | PASS |
| 3c Push into walls and furniture, no clipping | PASS | PASS |
| 3d 10+ steps from the exact centre | FAIL S/E (#4) | FAIL S/E |
| 4a 3 reviews match the aimed room | PASS | PASS |
| 4b Sort changes regroup, animate, string re-ties | PASS | PASS |
| 5 Add entry (mock): pin lands, saved | PASS | FAIL (#1) |
| 6a Wish list add / reorder / done | PASS | PASS |
| 6b Year wrap, 8 cards | PASS | FAIL (#1) |

## Defects
1. **Major: mobile ghost click** (`src/interaction`). The tap that opens an overlay also clicks the element under the finger in that overlay.
2. **Minor: `?debug=1` readout shows 1 draw call** (`src/ui/shell/PerfMonitor.tsx`), because `gl.info` auto-resets on every render pass.
3. **Minor: the JS bundle is served uncompressed** (`server/`).
4. **Minor: the walk from the exact centre is blocked** south (door collider, 6.63 m) and east (floor lamp on the centre line, 5.65 m).
5. **Cosmetic: the review address repeats the city.**
6. **Cosmetic: the review gallery crops the seed photo's baked-in caption.**
7. **Minor: the chalkboard hover tint makes the list illegible.**
8. **Cosmetic: the gate reveal shows the raw "lock-and-key" slug.**
9. **Minor: the mock extractor misses crew from "Me, Sam and Priya played", turns "last Saturday" into today, and duplicates rating comments.**
10. **Cosmetic: on mobile the HUD column covers part of the view, and the help card touches the joystick.**
11. **Cosmetic: the open gate door overlaps the SOLVED TODAY sign.**
12. **Cosmetic: ambiguous wrap copy** ("Cities 2" over one city; "4 puzzles solved" next to chips that add up to 13).
13. **Cosmetic: `THREE.Clock` deprecation warning** from the dependency, not app code.

Fix-up rounds and re-test results are appended below.
