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

## Round 2

Date: 2026-10-25, `main` at `12a0b1e` (fix merges A-E for #1-#12). Harness: `qa/playtest.mjs` run as `QA_TAG=qa2 QA_PORT=3520 node qa/playtest.mjs desktop`, then `QA_PORT=3521 ... mobile`. Raw results: `qa/playtest-results-qa2-desktop.json`, `qa/playtest-results-qa2-mobile.json`. Screenshots: `qa/screenshots/qa2-<viewport>-<nn>-<step>.png` (256-colour palette; mobile downscaled to 585 px wide, as in round 1).

**Harness changes for round 2:** `QA_TAG` prefix for screenshots/results; `content-encoding` capture for `/`, JS and CSS plus explicit `Accept-Encoding: br / gzip / identity` probes of the JS bundle; new step `1c-hud-layout` (mobile: HUD row in the top 15 %, one line, fits the width; help card clear of the joystick and Tap button); gate reveal must show no raw slug; reviews must not repeat the city in the address line; the casual transcript ("Last Saturday ... Me, Sam and Priya played ... 88 overall, puzzles 90, setting 85") goes through `/api/extract` on both viewports and is typed into the UI on mobile, then crew, date, scores and comments are checked; wrap card texts are recorded. The 10-step check still requires the exact centre (`off = 0`) to reach 7.5 m. The mobile ghost-click checks tap the desk terminal and the wrap trophy directly in the 3D view (centre-screen tap while hovering them), not the Tap button.

One harness false positive was corrected after the run: the first version of the "one row" check also counted the DEMO MODE badge (a `<button>` on the title line). The criterion is now "row buttons' centres within 4 px", and the stored mobile result was re-evaluated with it (all centres at y = 76 px). The harness file holds the corrected check.

### Project checks
| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npx eslint .` | PASS (clean) |
| `npx vitest run` | PASS: 39 files, 446 tests (round 1: 36 / 393) |
| `E2E_PORT=3510 npx playwright test` | PASS: 12 passed, 6 skipped by design (includes the new mobile "tap a world object without clicking through" spec) |

### Measurements
| | Desktop 1440x900 | Mobile 390x844 |
| --- | --- | --- |
| `npm start` to `/health` (includes build + precompress) | 7.6 s | (same server process pattern) |
| Load to world ready (SwiftShader) | 14.0 s | 12.8 s |
| Transferred bytes | **0.41 MB** (round 1: 1.79 MB) | 0.41 MB |
| JS bundle on the wire | `br`, 360 KB (decoded 1.63 MB); `gzip` 456 KB when only gzip is accepted; identity 1.63 MB otherwise; `Vary: accept-encoding` | same |
| CSS | `br`, 10 KB | same |
| Draw calls per frame, medium / low (WebGL-counted) | 135 / 107 | 122 / 94 |
| Triangles per frame, medium / low | 44.9k / 29.6k | 38.3k / 23.0k |
| `?debug=1` readout | "135 draws 44.9k tris" (matches WebGL exactly) | "122 draws 38.3k tris" (matches) |
| Walk from exact centre N / S / E / W | 7.51 / 7.51 / 9.65 / 9.65 m | 7.51 / 7.51 / 9.65 / 9.65 m |
| Console errors / page errors / failed requests | 0 / 0 / 0 | 0 / 0 / 0 |

N and S stop at 7.51 m (board face and the gate door's collider): enough for 10 steps (7.5 m), with only 1 cm to spare.

### Pass/fail by step
| Step | Desktop | Mobile |
| --- | --- | --- |
| 1 `npm start`, load, bytes < 15 MB, JS br/gzip | PASS | PASS |
| 1b Perf budgets + `?debug=1` readout matches WebGL | PASS | PASS |
| 1c HUD layout (mobile top row, help card clear of the joystick) | PASS | PASS (re-evaluated, see above) |
| 2 Gate auto-opens, solved through the UI, label "Lock & key", no gate after reload | PASS | PASS |
| 2b Hints after 2 misses, skip after the 3rd | PASS | PASS |
| 2c All 5 generators render, solve and fit | PASS | PASS |
| 3a Look input (drag) | PASS | PASS |
| 3b Walk to all 7 anchors (no teleports), hover targets | PASS | PASS |
| 3c Push into 5 walls and 7 furniture colliders, no clipping | PASS | PASS |
| 3d 10+ steps from the **exact centre** in every direction | PASS | PASS |
| 4a 3 reviews match the aimed room; address does not repeat the city | PASS | PASS (2 by tapping the photo, 1 by the Tap button) |
| 4b 4 sort changes (HUD + in-world tabs): regroup, animate, string re-tie sfx | PASS | PASS |
| 5 Add entry (mock): no ghost tick on open, casual transcript crew/date/comments, save, pin lands, persists after reload | PASS | PASS (desk tapped directly) |
| 6a Wish list add / reorder / done / persisted | PASS | PASS |
| 6b Year wrap: starts on card 1, 8 cards, prev, HUD button | PASS | PASS (trophy tapped directly) |

### Round 1 defect status
| # | Defect | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Mobile ghost click | **Fixed** | Tapping the desk terminal opened the record overlay with 0 prompts ticked; tapping the trophy opened the wrap on "1 / 8". `qa2-mobile-29-record-overlay.png`, `qa2-mobile-40-wrap-card-1.png` |
| 2 | Debug readout shows 1 draw | **Fixed** | Readout equals the WebGL count at every preset. `qa2-desktop-07-debug-readout.png` |
| 3 | JS served uncompressed | **Fixed** | `content-encoding: br` (gzip fallback), 1.79 MB to 0.41 MB on the wire |
| 4 | Centre walk blocked S/E | **Fixed** | 7.51 / 7.51 / 9.65 / 9.65 m from (0, 0) on both viewports |
| 5 | Address repeats city | **Fixed** | "418 Bayview Wharf, San Francisco, CA". `qa2-desktop-18-review-1.png` |
| 6 | Gallery crops baked-in caption | **Fixed** | Seed photos are bare scenes, and the caption lives in the polaroid strip. `qa2-mobile-18-review-1.png` |
| 7 | Chalkboard hover illegible | **Fixed** | Rim-only outline, and the list stays readable while hovered. `qa2-desktop-36-wishlist-board.png`, `qa2-mobile-36-wishlist-board.png` |
| 8 | Raw "lock-and-key" slug | **Fixed** | Reveal chip reads "Lock & key". `qa2-desktop-03-gate-solved.png` |
| 9 | Mock extractor crew/date/comments | **Fixed** | crew `["Sam","Priya"]`, date 2026-10-24 (last Saturday; today is Sunday 25th), comments distinct per rating. See note N3 |
| 10 | Mobile HUD column / help card on joystick | **Fixed** | 7 buttons in one row at y 54-98 px; help card bottom 264 px vs joystick top 664 px (400 px gap). `qa2-mobile-06-hud-help-card.png` |
| 11 | Open gate door overlaps sign | **Fixed** | The sign hangs above the frame and the open leaf clears it. `qa2-desktop-11-anchor-gate-door.png`, `qa2-desktop-12-anchor-living-area.png` |
| 12 | Ambiguous wrap copy | **Fixed** | "4 of the 13 puzzles you solved were search"; Cities tile lists "San Francisco, Toronto". `qa2-desktop-44-wrap-card-5.png`, `qa2-desktop-47-wrap-card-8.png` |
| 13 | `THREE.Clock` deprecation warning | Not fixed (dependency; accepted) | Still the only console warning |

### Look and feel
The room still reads warm and cozy: honey floor, plum couch, striped rug, bean bags, a lit window and the hanging plant (`qa2-desktop-12-anchor-living-area.png`). Overlays share the paper and teal palette. On mobile the single top HUD row leaves the middle of the view clear. Overlays use the full width without horizontal overflow, and the polaroid gallery and review text are legible at 390 px.

### New defects / notes
No new functional defects. Cosmetic notes:

- **N1. Cosmetic: the interaction prompt covers the middle of the chalkboard list while it is hovered** (owner: `src/interaction` prompt placement). The pill sits just below the reticle: "E Open the wish list" on desktop, the large "Tap" button plus its label on mobile. Either one hides rows 4-6 of the list you are trying to read. To reproduce, stand at (6.5, -3) and look at the wishlist board. Suggestion: anchor the prompt below the hovered object's bounds for large flat boards. Screenshots: `qa2-desktop-36-wishlist-board.png`, `qa2-mobile-36-wishlist-board.png`.
- **N2. Cosmetic: the volume toggle is 48 px while the other HUD buttons are 44 px** (owner: `src/ui/shell` VolumeToggle). On the mobile row it sits 2 px higher and looks heavier. Screenshot: `qa2-mobile-06-hud-help-card.png`.
- **N3. Cosmetic: mock rating comments echo the score clause** ("I would rate it 88 overall", "puzzles 90", "setting 85") instead of being empty when the speaker gave no opinion (owner: `server/extract/mock.ts`). They are no longer duplicated, and only mock mode is affected.
- **N4. Cosmetic, debug-only: on mobile the `?debug=1` readout sits over the joystick's lower edge and over overlay footers** such as the confirm screen's Cancel button (`pointer-events: none`, so it does not block taps). Screenshot: `qa2-mobile-31-confirm-initial.png`.
- **N5. Repo hygiene:** fix rounds committed 17 full-resolution, unquantized PNGs (`qa/screenshots/fix-*.png`, `fixA-*`, `fixc-*`, 0.6-1.3 MB each, about 16 MB). Consider quantizing or dropping them.

**Round 2 verdict: all steps pass at both viewports, and all 12 actionable round-1 defects are fixed.**
