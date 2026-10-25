# Audio (workstream 17)

Everything is synthesized live with the Web Audio API. There are no audio files, so nothing to license and nothing to download.

## Exports
- `AudioSystem`: renders nothing. App mounts it once. It stays silent until the first `user:gesture` and then creates the `AudioContext`. Later pointer/key presses resume a suspended context (iOS, tab switches).
- `VolumeToggle`: a round 48px HUD button (`data-testid="volume-toggle"`) that toggles `settings.muted`. Hovering with a mouse, or long-pressing (450 ms) on touch, opens a small volume slider popover (`volume-popover`, `volume-slider`) below and to the left of the button. Unmuting while the volume is 0 sets it to 0.5. **The shell (ws 19) should place it in the HUD**, ideally in a top-right corner.
- Also exported: `cueForEvent`, `stepIntervalMs` and `FootstepScheduler`, the pure logic.

## Sounds
| Trigger | Cue |
| --- | --- |
| `entry:saved`, `sfx: pin` | "tock" (triangle + sine knock + tick) |
| `review:open`, `sfx: paper` | rustle (band-passed noise bursts) |
| `sort:changed`, `sfx: string` | Karplus-Strong pluck with a slight pitch bend |
| `gate:solved` (not skipped), `sfx: unlock` | latch click-clack + C-major chime arpeggio |
| `interact`, `sfx: click` | tiny click |
| `gate:miss`, `sfx: error` | two soft low boops |
| `sfx: chalk` | jittery high noise scratch |
| `sfx: whoosh`, and `record/gate/wishlist/wrap/settings:open` | swept band-pass noise |
| `runtime.player.moving` (polled every 40 ms) | soft wooden thud, interval = 0.72 m stride / speed, clamped to 260 to 680 ms, ±8% pitch |

The ambient bed is a lowpassed pad of detuned triangles (Fmaj9, Em7, Dm9, Cmaj7, 9 s each, 3.5 s attack, 4.5 s release, scheduled with lookahead so it loops seamlessly), plus quiet looped rain noise and sparse vinyl crackle. It fades in over a few seconds.

## Levels
Master gain = `volume²` (0 when muted), applied with `setTargetAtTime` ramps and followed by a gentle compressor. The context suspends while the tab is hidden. A repeat of the same cue within 70 ms is dropped, for example when both `entry:saved` and `sfx: pin` fire.

## Notes
- With no AudioContext (jsdom, tests, very old browsers), every engine call is a no-op.
- For QA, `window.__ESCAPE_AUDIO__` exposes the engine (`started`, `context`, `play(cue)`).
- `sfx: footstep` also plays a step. If the player workstream emits it as well as setting `runtime.player.moving`, you will hear double steps, so it should use only `runtime.player`.
